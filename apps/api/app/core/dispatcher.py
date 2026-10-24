"""توزیع‌کنندهٔ رویدادهای دامنه — فاز ۲ (قرارداد §۴).

- تسک پس‌زمینهٔ asyncio (در lifespan استارت می‌خورد): رویدادهای
  `domain_events` با `processed_at IS NULL` را در batchهای حداکثر ۲۰۰تایی
  با claim اتمیک می‌گیرد (M-04 — ADR-0035: FOR UPDATE SKIP LOCKED روی
  PostgreSQL، UPDATE گارددار قابل‌حمل روی بقیه؛ claim منقضی قابل‌گرفتنِ
  مجدد است)، روی bus منتشر می‌کند و `processed_at` را ثبت می‌کند؛ پس هر
  رویداد دقیقاً توسط یک dispatcher منتشر می‌شود.
- شکست: شمارندهٔ `retry_count` بالا می‌رود و تلاش بعدی با backoff نمایی
  (حداکثر ۵ دقیقه) انجام می‌شود؛ بعد از ۵ شکست، `failed_at` ثبت می‌شود —
  یعنی dead-letter که ادمین در `/api/v1/admin/events/dead-letter` می‌بیند.
- `EventBus` انتزاع است: `RedisBus` (pub/sub واقعی) یا `InMemoryBus`
  (fallback فقط در dev/test وقتی Redis در دسترس نیست — با یک خط لاگ در
  startup؛ در staging/production نبود Redis یعنی fail-fast — FIX2-05).
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
    """تلاش برای Redis؛ شکست آن بیرون از dev یعنی fail-fast (FIX2-05).

    در dev/test fallback حافظه‌ای با لاگ هشدار می‌ماند. در staging و
    production اما InMemoryBus ساکت یعنی رویدادها فقط در همان پردازه
    fan-out می‌شوند و بقیهٔ workerها/سرویس‌ها هرگز نمی‌بینندشان — یک
    degradation نامرئی. پس در startup raise می‌شود تا استقرار معیوب
    همان لحظه معلوم شود، نه با گم‌شدن رویداد در عمل.
    """
    settings = get_settings()
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, socket_connect_timeout=2)
        await client.ping()
        logger.info("event bus: redis (%s)", settings.redis_url)
        return RedisBus(client)
    except Exception as exc:
        if not settings.is_dev:
            logger.critical(
                "event bus: redis unavailable in env=%s (%s) — refusing to "
                "start with a silent in-memory fallback",
                settings.app_env,
                exc,
            )
            raise RuntimeError(
                f"event bus: redis unavailable in env={settings.app_env}; "
                "in-memory fallback is dev-only (FIX2-05)"
            ) from exc
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


#: سقف batch هر دور dispatcher (M-04)
CLAIM_BATCH = 200
#: عمر claim؛ dispatcher مرده رویداد را برای همیشه قفل نمی‌کند
CLAIM_TTL_SECONDS = 120


def _default_worker_id() -> str:
    import os
    import socket
    import uuid

    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def _claim_predicate(now: datetime):
    """رویدادِ قابل‌گرفتن: پردازش‌نشده، fail‌نشده، بی-claim یا claim منقضی."""
    stale_before = now - timedelta(seconds=CLAIM_TTL_SECONDS)
    return (
        DomainEvent.processed_at.is_(None),
        DomainEvent.failed_at.is_(None),
        (DomainEvent.claimed_at.is_(None)) | (DomainEvent.claimed_at < stale_before),
    )


async def _claim_batch(
    db: AsyncSession, worker_id: str, now: datetime
) -> list[DomainEvent]:
    """گرفتن اتمیک یک batch — PostgreSQL: FOR UPDATE SKIP LOCKED؛
    بقیه (SQLite و…): UPDATE گارددار با همان predicate (قابل‌حمل).

    روی مسیر قابل‌حمل، اگر نویسندهٔ رقیب قفل دیتابیس را گرفته باشد
    (database is locked)، این دور خالی برمی‌گردد تا دور بعد دوباره
    تلاش شود — semantics صادقانهٔ at-most-one-claim حفظ می‌شود چون
    UPDATE فقط روی ردیف‌های هنوز-بی‌claim اثر می‌گذارد.
    """
    from sqlalchemy import update
    from sqlalchemy.exc import OperationalError

    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        stmt = (
            select(DomainEvent)
            .where(*_claim_predicate(now))
            .order_by(DomainEvent.created_at.asc())
            .limit(CLAIM_BATCH)
            .with_for_update(skip_locked=True)
        )
        events = list((await db.execute(stmt)).scalars().all())
        for event in events:
            event.claimed_by = worker_id
            event.claimed_at = now
        await db.commit()
        return events

    candidate_ids = list(
        (
            await db.execute(
                select(DomainEvent.event_id)
                .where(*_claim_predicate(now))
                .order_by(DomainEvent.created_at.asc())
                .limit(CLAIM_BATCH)
            )
        ).scalars().all()
    )
    if not candidate_ids:
        return []
    try:
        claimed_ids = list(
            (
                await db.execute(
                    update(DomainEvent)
                    .where(
                        DomainEvent.event_id.in_(candidate_ids),
                        *_claim_predicate(now),
                    )
                    .values(claimed_by=worker_id, claimed_at=now)
                    .returning(DomainEvent.event_id)
                )
            ).scalars().all()
        )
        await db.commit()
    except OperationalError:
        await db.rollback()
        logger.warning("dispatcher claim lost a lock race; retrying next cycle")
        return []
    if not claimed_ids:
        return []
    rows = (
        await db.execute(
            select(DomainEvent).where(DomainEvent.event_id.in_(claimed_ids))
        )
    ).scalars().all()
    by_id = {e.event_id: e for e in rows}
    return [by_id[i] for i in claimed_ids if i in by_id]


async def dispatch_once(
    session_factory: async_sessionmaker[AsyncSession],
    bus: EventBus,
    worker_id: str | None = None,
) -> int:
    """یک دور polling با claim دسته‌ای — تعداد رویدادهای موفق (M-04).

    هر رویداد را دقیقاً یک dispatcher می‌گیرد (claim اتمیک)؛ انتشار
    خارج از تراکنش claim انجام می‌شود و processed_at + آزادسازی
    claim به‌ازای هر رویداد commit می‌شود.
    """
    worker = worker_id or _default_worker_id()
    processed = 0
    async with session_factory() as db:
        now = _utcnow()
        events = await _claim_batch(db, worker, now)
        for event in events:
            if not _backoff_eligible(event, now):
                # هنوز نوبت retry نرسیده: claim را آزاد کن تا قفل نماند
                event.claimed_by = None
                event.claimed_at = None
                await db.commit()
                continue
            try:
                await bus.publish(serialize_event(event))
            except Exception:
                event.retry_count += 1
                event.claimed_by = None
                event.claimed_at = None
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
            event.claimed_by = None
            event.claimed_at = None
            await db.commit()
            processed += 1
    return processed


async def _refresh_outbox_metrics(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """تازه‌سازی gaugeهای outbox برای /metrics (m-02) — هر دور یک کوئری سبک."""
    from sqlalchemy import func

    from app.core.metrics import METRICS

    async with session_factory() as db:
        pending, oldest = (
            await db.execute(
                select(func.count(), func.min(DomainEvent.created_at)).where(
                    DomainEvent.processed_at.is_(None),
                    DomainEvent.failed_at.is_(None),
                )
            )
        ).one()
        dead = (
            await db.execute(
                select(func.count()).where(DomainEvent.failed_at.is_not(None))
            )
        ).scalar() or 0
    age = 0.0
    if oldest is not None:
        age = max(0.0, (_utcnow() - ensure_aware(oldest)).total_seconds())
    METRICS.set_outbox_stats(int(pending or 0), age, int(dead))


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
            await _refresh_outbox_metrics(session_factory)
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
