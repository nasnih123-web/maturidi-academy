"""تست‌های M-04 (ADR-0035): claim دسته‌ای dispatcher و باس Redis.

- batch حداکثر CLAIM_BATCH رویداد می‌گیرد (LIMIT 200).
- دو dispatcher هم‌زمان روی یک DB فایلی: هر رویداد دقیقاً یک‌بار.
- claim منقضی (worker مرده) توسط dispatcher دیگر گرفته می‌شود.
- انتخاب adapter: Redis در دسترس → RedisBus؛ نبود → InMemoryBus.
- fan-out روی RedisBus با fakeredis واقعی (pub/sub).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import dispatcher
from app.core.database import Base
from app.core.dispatcher import (
    CLAIM_BATCH,
    EventBus,
    InMemoryBus,
    RedisBus,
    create_event_bus,
    dispatch_once,
)
from app.models.models import DomainEvent


class CountingBus(EventBus):
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def publish(self, message: dict) -> None:
        self.messages.append(message)

    async def run_listener(self, callback) -> None:  # pragma: no cover
        raise asyncio.CancelledError


@pytest.fixture()
async def file_db(tmp_path):
    """DB فایلی واقعی (نه :memory:) تا دو session factory مستقل
    دقیقاً مثل دو پروسهٔ dispatcher روی یک فایل کار کنند."""
    url = f"sqlite+aiosqlite:///{tmp_path}/events.db"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _seed_events(factory, n: int) -> list[uuid.UUID]:
    ids = []
    async with factory() as db:
        for i in range(n):
            ev = DomainEvent(
                event_type="test.tick",
                aggregate_type="test",
                aggregate_id=str(i),
                payload={"i": i},
            )
            db.add(ev)
            await db.flush()
            ids.append(ev.event_id)
        await db.commit()
    return ids


async def test_claim_batch_limit(file_db):
    await _seed_events(file_db, CLAIM_BATCH + 50)
    bus = CountingBus()
    first = await dispatch_once(file_db, bus, worker_id="w1")
    assert first == CLAIM_BATCH
    second = await dispatch_once(file_db, bus, worker_id="w1")
    assert second == 50
    published = [m["event_id"] for m in bus.messages]
    assert len(published) == len(set(published)) == CLAIM_BATCH + 50


async def test_two_dispatchers_exactly_once(file_db):
    ids = await _seed_events(file_db, 120)
    bus_a, bus_b = CountingBus(), CountingBus()
    results = await asyncio.gather(
        dispatch_once(file_db, bus_a, worker_id="worker-A"),
        dispatch_once(file_db, bus_b, worker_id="worker-B"),
        return_exceptions=True,
    )
    errors = [r for r in results if isinstance(r, Exception)]
    assert not errors, errors
    published = [m["event_id"] for m in bus_a.messages + bus_b.messages]
    assert len(published) == len(set(published)), "انتشار تکراری رخ داد"
    assert set(published) == {str(i) for i in ids}
    async with file_db() as db:
        remaining = (
            await db.execute(
                select(DomainEvent).where(DomainEvent.processed_at.is_(None))
            )
        ).scalars().all()
    assert remaining == []


async def test_expired_claim_is_reclaimable(file_db):
    ids = await _seed_events(file_db, 3)
    async with file_db() as db:
        ev = (await db.execute(select(DomainEvent))).scalars().first()
        ev.claimed_by = "dead-worker"
        ev.claimed_at = datetime.now(UTC) - timedelta(
            seconds=dispatcher.CLAIM_TTL_SECONDS + 60
        )
        await db.commit()
        dead_id = str(ev.event_id)
    bus = CountingBus()
    processed = await dispatch_once(file_db, bus, worker_id="alive")
    assert processed == 3
    assert dead_id in [m["event_id"] for m in bus.messages]
    assert {str(i) for i in ids} == {m["event_id"] for m in bus.messages}


async def test_fresh_claim_blocks_other_dispatcher(file_db):
    await _seed_events(file_db, 2)
    async with file_db() as db:
        for ev in (await db.execute(select(DomainEvent))).scalars().all():
            ev.claimed_by = "busy-worker"
            ev.claimed_at = datetime.now(UTC)
        await db.commit()
    bus = CountingBus()
    assert await dispatch_once(file_db, bus, worker_id="other") == 0
    assert bus.messages == []


# ------------------------------------------------------------- event bus

async def test_create_event_bus_prefers_redis(monkeypatch):
    import fakeredis.aioredis as fake_aioredis

    fake = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(
        "redis.asyncio.from_url", lambda *a, **k: fake
    )
    bus = await create_event_bus()
    assert isinstance(bus, RedisBus)
    await bus.close()


async def test_create_event_bus_falls_back_without_redis(monkeypatch):
    def _boom(*a, **k):
        raise ConnectionError("no redis here")

    monkeypatch.setattr("redis.asyncio.from_url", _boom)
    bus = await create_event_bus()
    assert isinstance(bus, InMemoryBus)


async def test_redis_bus_fanout_with_fakeredis():
    import fakeredis.aioredis as fake_aioredis

    client = fake_aioredis.FakeRedis(decode_responses=True)
    bus = RedisBus(client)
    received: list[dict] = []
    done = asyncio.Event()

    async def _cb(message: dict) -> None:
        received.append(message)
        done.set()

    task = asyncio.create_task(bus.run_listener(_cb))
    try:
        await asyncio.sleep(0.3)  # subscribe برقرار شود
        await bus.publish({"event_id": "x1", "event_type": "test.tick"})
        await asyncio.wait_for(done.wait(), timeout=5)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await client.aclose()
    assert received and received[0]["event_id"] == "x1"
