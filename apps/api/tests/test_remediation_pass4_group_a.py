"""Remediation Pass 4 — Group A regression tests.

A1 distributed per-minute limit, A2 browser-host guard, A4 Redis TTL
race, A5 query-key rejection + embed token, A6 counter recovery,
C7 memory sliding window (fixed in the same limiter file).
Each test fails against the pre-Pass-4 behavior and passes after.
"""
from __future__ import annotations

import time
import uuid

import pytest
from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis

from app.core.errors import APIError
from app.core.rate_limit import DistributedRateLimiter
from app.core.storage import _is_browser_unreachable_host
from app.models.models import ApiKey
from app.modules.api_keys import counter as counter_mod
from app.modules.api_keys import service as keys_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _inprocess_counter():
    counter_mod.set_usage_counter_for_test(counter_mod.InProcessUsageCounter())
    yield
    counter_mod.set_usage_counter_for_test(None)
    keys_service.set_rate_limiter_for_test(None)
    keys_service.reset_rate_limits()


async def _make_key(db_session, raw: str, *, per_min: int = 1000, quota: int = 10000):
    row = ApiKey(
        key_hash=keys_service._hash_key(raw),
        key_prefix=raw[:8],
        name="pass4-a",
        scopes=["ayah-of-day", "prayer-times"],
        rate_limit_per_min=per_min,
        quota_monthly=quota,
        used_this_month=0,
        quota_period=keys_service._period_now(),
        is_active=True,
    )
    db_session.add(row)
    await db_session.commit()
    return row


# ---------------------------------------------------------------- A1
async def test_a1_two_limiter_instances_share_per_minute_quota(db_session):
    raw = "pass4-a1-" + uuid.uuid4().hex[:16]
    await _make_key(db_session, raw, per_min=6)
    server = FakeServer()
    rl_a = DistributedRateLimiter(FakeRedis(server=server), fail_closed_auth=False)
    rl_b = DistributedRateLimiter(FakeRedis(server=server), fail_closed_auth=False)
    allowed = 0
    for limiter in [rl_a, rl_b] * 5:  # 10 attempts alternating instances
        keys_service.set_rate_limiter_for_test(limiter)
        try:
            await keys_service.validate_key(db_session, raw, scope="ayah-of-day")
            allowed += 1
        except APIError as exc:
            assert exc.status_code == 429
    assert allowed == 6, "per-minute quota must be the sum across instances, not 6+6"


# ---------------------------------------------------------------- A2
@pytest.mark.parametrize(
    "host,expected",
    [
        ("10.0.0.5", True),
        ("10.255.255.255", True),
        ("172.16.0.1", True),
        ("172.31.255.255", True),
        ("192.168.1.1", True),
        ("127.0.0.1", True),
        ("127.9.9.9", True),
        ("0.0.0.0", True),
        ("169.254.10.20", True),
        ("224.0.0.1", True),
        ("100.64.0.1", True),
        ("::1", True),
        ("fe80::1", True),
        ("fc00::1", True),
        ("fd00::abcd", True),
        ("::ffff:10.0.0.1", True),
        ("localhost", True),
        ("localhost.", True),
        ("minio", True),
        ("foo.internal", True),
        ("foo.local", True),
        ("8.8.8.8", False),
        ("1.1.1.1", False),
        ("s3.amazonaws.com", False),
        ("files.example.com", False),
        ("2001:4860:4860::8888", False),
    ],
)
def test_a2_browser_host_guard_table(host, expected):
    assert _is_browser_unreachable_host(host) is expected


# ---------------------------------------------------------------- A4
class _EvalStub:
    """Redis stub implementing Lua INCR+PEXPIRE atomically."""

    def __init__(self):
        self.data: dict[str, tuple[int, float | None]] = {}

    async def eval(self, script, numkeys, key, pexpire_ms):
        assert "INCR" in script and "PEXPIRE" in script
        value, exp = self.data.get(key, (0, None))
        value += 1
        if value == 1:
            exp = time.time() + pexpire_ms / 1000.0
        self.data[key] = (value, exp)
        return value


async def test_a4_lua_counter_has_ttl_from_first_increment():
    rl = DistributedRateLimiter(_EvalStub(), fail_closed_auth=False)
    assert await rl.is_allowed("k", limit=5, window_s=60)
    assert await rl.is_allowed("k", limit=5, window_s=60)
    value, exp = rl._client.data["rl:maturidi:k"]
    assert value == 2
    assert exp is not None and exp > time.time()


class _NoEvalRacyStub:
    """SET NX fails, then the key expires before INCR (the A4 race),
    recreating it without a TTL — the repair must set one."""

    def __init__(self):
        self.ttl_value: int | None = None
        self.pexpired: int | None = None

    async def eval(self, *args, **kwargs):
        raise type("ResponseError", (Exception,), {})("unknown command 'eval'")

    async def set(self, key, value, ex=None, nx=False):
        return None  # key "exists" at SET time

    async def incr(self, key):
        self.ttl_value = -1  # recreated without TTL
        return 1

    async def ttl(self, key):
        return self.ttl_value

    async def pexpire(self, key, ms):
        self.pexpired = ms
        self.ttl_value = ms // 1000
        return True


async def test_a4_fallback_repairs_ttl_after_expiry_race():
    stub = _NoEvalRacyStub()
    rl = DistributedRateLimiter(stub, fail_closed_auth=False)
    assert await rl.is_allowed("k", limit=5, window_s=60)
    assert stub.pexpired == 60000, "TTL-less counter must be repaired, not left to persist"


# ---------------------------------------------------------------- C7
def test_c7_memory_window_recovers_after_window_not_900s(monkeypatch):
    rl = DistributedRateLimiter(None, fail_closed_auth=False)
    now = [1000.0]
    monkeypatch.setattr(time, "time", lambda: now[0])
    import asyncio

    async def run():
        for _ in range(3):
            assert await rl.is_allowed("k", limit=3, window_s=60)
        assert not await rl.is_allowed("k", limit=3, window_s=60)
        now[0] += 61  # past the 60s window, far before the old 900s lock
        assert await rl.is_allowed("k", limit=3, window_s=60)

    asyncio.run(run())


# ---------------------------------------------------------------- A5
async def test_a5_query_key_rejected_and_embed_token_works(tc):
    raw = "pass4-a5-" + uuid.uuid4().hex[:16]
    async with tc["maker"]() as db:
        row = ApiKey(
            key_hash=keys_service._hash_key(raw),
            key_prefix=raw[:8],
            name="pass4-a5",
            scopes=["ayah-of-day"],
            rate_limit_per_min=1000,
            quota_monthly=10000,
            used_this_month=0,
            quota_period=keys_service._period_now(),
            is_active=True,
        )
        db.add(row)
        await db.commit()
        key_id = row.id
    client = tc["client"]
    # raw key in the query string must NOT authenticate
    r = await client.get(f"/api/v1/widgets/ayah-of-day?api_key={raw}")
    assert r.status_code == 401
    # header key still works
    r = await client.get(
        "/api/v1/widgets/ayah-of-day", headers={"X-API-Key": raw}
    )
    assert r.status_code != 401, r.text
    # embed token works, is scoped, and contains no raw key
    token = keys_service.issue_embed_token(key_id, "ayah-of-day")
    assert raw not in token
    r = await client.get(f"/api/v1/widgets/ayah-of-day?embed_token={token}")
    assert r.status_code != 401, r.text
    r = await client.get(f"/api/v1/widgets/prayer-times?embed_token={token}&lat=35.7&lng=51.4")
    assert r.status_code == 401, "token for one widget must not open another"
    # revoked key kills the token
    async with tc["maker"]() as db:
        row = await db.get(ApiKey, key_id)
        row.is_active = False
        await db.commit()
    r = await client.get(f"/api/v1/widgets/ayah-of-day?embed_token={token}")
    assert r.status_code == 401


# ---------------------------------------------------------------- A6
class _FakeRedisForCounter:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}

    async def ping(self):
        return True

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
        self.hashes.setdefault(name, {}).update({k: str(v) for k, v in mapping.items()})

    async def hgetall(self, name):
        return dict(self.hashes.get(name, {}))

    async def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)
            self.hashes.pop(k, None)


async def test_a6_counter_recovers_to_redis_on_flush(db_session, monkeypatch):
    raw = "pass4-a6-" + uuid.uuid4().hex[:16]
    row = await _make_key(db_session, raw)
    # in-process fallback with 3 pending hits
    counter_mod.set_usage_counter_for_test(counter_mod.InProcessUsageCounter())
    counter = await counter_mod.get_usage_counter()
    for _ in range(3):
        await counter.hit(row.key_hash, keys_service._period_now(), seed=0)
    # pretend the fallback is old enough to re-probe, and Redis is back
    counter_mod._counter_failed_since = time.monotonic() - 3600
    fake = _FakeRedisForCounter()

    async def _fake_try():
        return counter_mod.RedisUsageCounter(fake)

    monkeypatch.setattr(counter_mod, "_try_redis_counter", _fake_try)
    n = await counter_mod.flush_usage_counters(db_session)
    assert n == 1
    await db_session.refresh(row)
    assert row.used_this_month == 3
    assert isinstance(await counter_mod.get_usage_counter(), counter_mod.RedisUsageCounter)

async def test_a6_redis_midflight_failure_does_not_500(db_session):
    raw = "pass4-a6b-" + uuid.uuid4().hex[:16]
    await _make_key(db_session, raw)

    class _DyingCounter:
        async def hit(self, *a, **k):
            raise RuntimeError("redis died")

        async def refund(self, *a, **k):
            return None

        async def drain_pending(self):
            return {}

    counter_mod.set_usage_counter_for_test(_DyingCounter())
    # validate_key must fall back to in-process, not raise 500
    await keys_service.validate_key(db_session, raw, scope="ayah-of-day")
    assert isinstance(await counter_mod.get_usage_counter(), counter_mod.InProcessUsageCounter)
