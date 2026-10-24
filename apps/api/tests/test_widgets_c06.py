"""تست‌های C-06: شمارندهٔ مصرف ویجت (F2) و کش آیهٔ روز (F1).

F2: validate_key دیگر روی هر رندر به دیتابیس نمی‌نویسد — شمارش در
شمارنده (Redis/in-process) است و flush دوره‌ای به دیتابیس می‌رساند؛
سهمیه از شمارندهٔ زنده اعمال می‌شود.
F1: آیهٔ روز در روز ثابت کش می‌شود و شکست provider شصت ثانیه
negative-cache می‌شود (بدون طوفان retry روی provider).
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.errors import APIError
from app.models.models import ApiKey
from app.modules.api_keys import counter as counter_mod
from app.modules.api_keys import service as keys_service
from app.modules.widgets import service as widgets_service

pytestmark = pytest.mark.asyncio

import uuid as _uuid


def _raw_key() -> str:
    return "c06-" + _uuid.uuid4().hex[:24]


@pytest.fixture(autouse=True)
def _inprocess_counter():
    counter_mod.set_usage_counter_for_test(counter_mod.InProcessUsageCounter())
    yield
    counter_mod.set_usage_counter_for_test(None)


async def _make_key(db, raw: str, *, quota: int = 100) -> ApiKey:
    row = ApiKey(
        key_hash=keys_service._hash_key(raw),
        key_prefix=raw[:8],
        name="c06-test",
        scopes=["ayah-of-day"],
        rate_limit_per_min=1000,
        quota_monthly=quota,
        used_this_month=0,
        quota_period=keys_service._period_now(),
        is_active=True,
    )
    db.add(row)
    await db.commit()
    return row


# ---------------------------------------------------------------------------
# F2 — شمارنده
# ---------------------------------------------------------------------------


async def test_counter_hit_seed_and_refund():
    c = counter_mod.InProcessUsageCounter()
    assert await c.hit("h1", "2026-10", seed=10) == 11
    assert await c.hit("h1", "2026-10", seed=10) == 12  # seed فقط اولین بار
    await c.refund("h1", "2026-10")
    assert await c.hit("h1", "2026-10", seed=0) == 12
    pending = await c.drain_pending()
    assert pending["h1"][1] == 2  # 3 hit - 1 refund
    assert await c.drain_pending() == {}  # drain خالی شد


async def test_validate_key_no_db_write_until_flush(db_session):
    raw = _raw_key()
    row = await _make_key(db_session, raw)
    for _ in range(3):
        await keys_service.validate_key(db_session, raw, scope="ayah-of-day")
    await db_session.refresh(row)
    assert row.used_this_month == 0  # هیچ write-per-renderای رخ نداد
    n = await counter_mod.flush_usage_counters(db_session)
    assert n == 1
    await db_session.refresh(row)
    assert row.used_this_month == 3
    assert row.last_used_at is not None


async def test_quota_enforced_from_live_counter_before_flush(db_session):
    raw = _raw_key()
    row = await _make_key(db_session, raw, quota=2)
    await keys_service.validate_key(db_session, raw, scope="ayah-of-day")
    await keys_service.validate_key(db_session, raw, scope="ayah-of-day")
    with pytest.raises(APIError) as exc:
        await keys_service.validate_key(db_session, raw, scope="ayah-of-day")
    assert exc.value.status_code == 429
    # hit ردشده refund شد: flush فقط ۲ مصرف واقعی را می‌نویسد
    await counter_mod.flush_usage_counters(db_session)
    await db_session.refresh(row)
    assert row.used_this_month == 2


class _FakeRedis:
    """کلاینت Redis جعلیِ dict-backed برای تست RedisUsageCounter."""

    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}

    async def set(self, key, value, nx=False):
        if nx and key in self.kv:
            return None
        self.kv[key] = str(value)
        return True

    async def incr(self, key):
        self.kv[key] = str(int(self.kv.get(key, "0")) + 1)
        return int(self.kv[key])

    async def decr(self, key):
        self.kv[key] = str(int(self.kv.get(key, "0")) - 1)
        return int(self.kv[key])

    async def hincrby(self, name, field, amount):
        h = self.hashes.setdefault(name, {})
        h[field] = str(int(h.get(field, "0")) + amount)
        return int(h[field])

    async def hset(self, name, mapping):
        self.hashes.setdefault(name, {}).update(
            {k: str(v) for k, v in mapping.items()}
        )

    async def hgetall(self, name):
        return dict(self.hashes.get(name, {}))

    async def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)
            self.hashes.pop(k, None)


async def test_redis_counter_seed_incr_drain():
    fake = _FakeRedis()
    c = counter_mod.RedisUsageCounter(fake)
    assert await c.hit("h9", "2026-10", seed=41) == 42
    assert await c.hit("h9", "2026-10", seed=41) == 43
    pending = await c.drain_pending()
    assert pending["h9"][0] == "2026-10"
    assert pending["h9"][1] == 2
    assert pending["h9"][2] > 0  # last_used ثبت شده است


# ---------------------------------------------------------------------------
# F1 — کش آیهٔ روز
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _ayah_inprocess_cache():
    widgets_service._ayah_mem_cache.clear()
    widgets_service._ayah_redis_tried = True
    widgets_service._ayah_redis_client = None
    yield
    widgets_service._ayah_mem_cache.clear()


async def test_ayah_of_day_cached_within_day(db_session):
    calls = 0

    async def bundle_fn(db, surah, ayah):
        nonlocal calls
        calls += 1
        return {"text": "آیه", "surah": surah, "ayah": ayah}

    out1 = await widgets_service.ayah_of_day(db_session, bundle_fn=bundle_fn)
    out2 = await widgets_service.ayah_of_day(db_session, bundle_fn=bundle_fn)
    assert calls == 1  # فراخوانی دوم از کش آمد
    assert out1 == out2


async def test_ayah_of_day_negative_cache_bounds_retries(db_session):
    calls = 0

    async def failing_fn(db, surah, ayah):
        nonlocal calls
        calls += 1
        raise RuntimeError("provider down")

    for _ in range(3):
        with pytest.raises(APIError) as exc:
            await widgets_service.ayah_of_day(db_session, bundle_fn=failing_fn)
        assert exc.value.status_code == 502
    assert calls == 1  # در پنجرهٔ negative-cache، provider دوباره زده نشد


async def test_widget_key_row_type(db_session):
    """کمکی: ردیف ساخته‌شده از جنس درست است (پایش رگرسیون fixture)."""
    row = await _make_key(db_session, _raw_key())
    found = (
        await db_session.execute(
            select(ApiKey).where(ApiKey.key_hash == row.key_hash)
        )
    ).scalar_one()
    assert found.name == "c06-test"
