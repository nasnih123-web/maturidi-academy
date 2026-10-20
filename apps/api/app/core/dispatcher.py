"""توزیع‌کنندهٔ رویدادهای دامنه — فاز ۲ (قرارداد §۴).

- تسک پس‌زمینهٔ asyncio (در lifespan استارت می‌خورد): رویدادهای
  `domain_events` با `processed_at IS NULL` را به‌ترتیب `created_at` می‌خواند،
  روی bus منتشر می‌کند و `processed_at` را ثبت می‌کند.
- شکست: شمارندهٔ `retry_count` بالا می‌رود و تلاش بعدی با backoff نمایی
  (حداکثر ۵ دقیقه) انجام می‌شود؛ بعد از ۵ شکست، `failed_at` ثبت می‌شود —
  یعنی dead-letter که ادمین در `/api/v1/admin/events/dead-letter` می‌بیند.
- `EventBus` انتزاع است: `RedisBus` (pub/sub واقعی) یا `InMemoryBus`
  (fallback خودکار وقتی Redis در دسترس نیست — با یک خط لاگ در startup).
- دروازهٔ WebSocket با `run_listener` روی bus مشترک می‌شود و هر پیام را به
  `realtime.broadcast_event` می‌دهد تا به کلاینت‌ها fan-out شود.
- Consumerها باید idempotent باشند (چک `event_id`) — قرارداد §۴.
"""
from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.database import SessionLocal, ensure_aware
from app.core.logging import logger
from app.core.realtime import broadcast_event
from app.models.models import DomainEvent

BUS_CHANNEL = "maturidi:events"
MAX_RETRIES = 5
MAX_BACKOFF_SECONDS = 300


def _utcnow() -> datetime:
    return datetime.now(UTC)


def serialize_event(event: DomainEvent) -> dict:
    """سریالایز یکنواخت رویداد برای bus و کلاینت WebSocket."""
    return {
        "event_id": str(event.event_id),
        "event_type": event.event_type,
        "aggregate_type": event.aggregate_type,
        "aggregate_id": event.aggregate_id,
        "payload": event.payload,
        "schema_version": event.schema_version,
        "source_client": event.source_client,
        "created_at": ensure_aware(event.created_at).isoformat(),
    }


class EventBus(ABC):
    """گذرگاه انتشار رویداد — Redis یا حافظه‌ای."""

    @abstractmethod
    async def publish(self, message: dict) -> None: ...

    @abstractmethod
    async def run_listener(
        self, callback: Callable[[dict], Awaitable[None]]
    ) -> None:
        """حلقهٔ بی‌پایان دریافت پیام — تا cancel شدن تسک ادامه دارد."""

    async def close(self) -> None:
        """پاکسازی منابع — پیش‌فرض هیچ‌کاری."""


class InMemoryBus(EventBus):
    """fallback وقتی Redis نیست (dev/تست) — پیام‌ها durable نیستند، DB هست."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[dict] = asyncio.Queue()

    async def publish(self, message: dict) -> None:
        self._queue.put_nowait(message)

    async def run_listener(
        self, callback: Callable[[dict], Awaitable[None]]
    ) -> None:
        while True:
            message = await self._queue.get()
            try:
                await callback(message)
            except Exception:
                logger.exception("event bus callback failed")
            finally:
                self._queue.task_done()


class RedisBus(EventBus):
    def __init__(self, client, channel: str = BUS_CHANNEL) -> None:
        self._client = client
        self._channel = channel

    async def publish(self, message: dict) -> None:
        await self._client.publish(self._channel, json.dumps(message, ensure_ascii=False))

    async def run_listener(
        self, callback: Callable[[dict], Awaitable[None]]
    ) -> None:
        pubsub = self._client.pubsub()
        await pubsub.subscribe(self._channel)
        try:
            async for raw in pubsub.listen():
                if raw.get("type") != "message":
                    continue
                data = raw["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                try:
                    await callback(json.loads(data))
                except Exception:
                    logger.exception("event bus callback failed")
        finally:
            await pubsub.unsubscribe(self._channel)
            await pubsub.close()

    async def close(self) -> None:
        await self._client.aclose()


async def create_event_bus() -> EventBus:
    """تلاش برای Redis؛ در صورت شکست، fallback حافظه‌ای با لاگ هشدار."""
    settings = get_settings()
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, socket_connect_timeout=2)
        await client.ping()
        logger.info("event bus: redis (%s)", settings.redis_url)
        return RedisBus(client)
    except Exception as exc:
        logger.warning(
            "event bus: redis unavailable (%s) — using in-memory bus (dev fallback); "
            "events remain durable in domain_events table",
            exc,
        )
        return InMemoryBus()


def _backoff_eligible(event: DomainEvent, now: datetime) -> bool:
    """آیا زمان تلاش مجدد (backoff نمایی) رسیده است؟"""
    if event.retry_count <= 0:
        return True
    delay = min(2 ** event.retry_count, MAX_BACKOFF_SECONDS)
    return now >= ensure_aware(event.created_at) + timedelta(seconds=delay)


async def dispatch_once(
    session_factory: async_sessionmaker[AsyncSession],
    bus: EventBus,
) -> int:
    """یک دور polling — تعداد رویدادهای موفق را برمی‌گرداند (برای تست/مانیتور)."""
    processed = 0
    async with session_factory() as db:
        stmt = (
            select(DomainEvent)
            .where(DomainEvent.processed_at.is_(None), DomainEvent.failed_at.is_(None))
            .order_by(DomainEvent.created_at.asc())
        )
        events = list((await db.execute(stmt)).scalars().all())
        now = _utcnow()
        for event in events:
            if not _backoff_eligible(event, now):
                continue
            try:
                await bus.publish(serialize_event(event))
            except Exception:
                event.retry_count += 1
                if event.retry_count >= MAX_RETRIES:
                    event.failed_at = now
                    logger.error(
                        "event dead-lettered: %s (%s) after %d retries",
                        event.event_id, event.event_type, event.retry_count,
                    )
                else:
                    logger.warning(
                        "event publish failed (%s), retry %d/%d",
                        event.event_id, event.retry_count, MAX_RETRIES,
                    )
                await db.commit()
                continue
            event.processed_at = now
            await db.commit()
            processed += 1
    return processed


async def run_dispatcher(
    stop_event: asyncio.Event,
    session_factory: async_sessionmaker[AsyncSession],
    bus: EventBus,
    poll_interval: float = 1.0,
) -> None:
    """حلقهٔ اصلی dispatcher — تا set شدن stop_event ادامه دارد."""
    logger.info("event dispatcher started (poll_interval=%ss)", poll_interval)
    while not stop_event.is_set():
        try:
            await dispatch_once(session_factory, bus)
        except Exception:
            logger.exception("dispatcher cycle failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval)
        except TimeoutError:
            pass
    logger.info("event dispatcher stopped")


async def _bus_to_gateway(message: dict) -> None:
    await broadcast_event(message)


async def start_realtime(app: FastAPI) -> None:
    """راه‌اندازی bus + dispatcher + listener دروازه — در lifespan صدا زده می‌شود."""
    settings = get_settings()
    bus = await create_event_bus()
    app.state.event_bus = bus
    stop_event = asyncio.Event()
    app.state.dispatcher_stop = stop_event
    # تست‌ها می‌توانند app.state.session_factory را override کنند
    session_factory = getattr(app.state, "session_factory", None) or SessionLocal
    app.state.dispatcher_task = asyncio.create_task(
        run_dispatcher(stop_event, session_factory, bus, settings.dispatcher_poll_interval),
        name="event-dispatcher",
    )
    app.state.bus_listener_task = asyncio.create_task(
        bus.run_listener(_bus_to_gateway),
        name="event-bus-listener",
    )


async def stop_realtime(app: FastAPI) -> None:
    """توقف تمیز تسک‌ها و بستن bus — در shutdown صدا زده می‌شود."""
    stop_event = getattr(app.state, "dispatcher_stop", None)
    if stop_event is not None:
        stop_event.set()
    tasks = [
        getattr(app.state, "dispatcher_task", None),
        getattr(app.state, "bus_listener_task", None),
    ]
    for task in tasks:
        if task is not None:
            task.cancel()
    for task in tasks:
        if task is not None:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5)
            except (TimeoutError, asyncio.CancelledError):
                pass
            except Exception:
                logger.exception("error stopping realtime task")
    bus = getattr(app.state, "event_bus", None)
    if bus is not None:
        try:
            await bus.close()
        except Exception:
            logger.exception("error closing event bus")
