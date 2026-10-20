"""remediation-pass-2 Track 1 — §۷: محدودکنندهٔ نرخ توزیع‌شده (Redis).

- سهمیه + انقضای پنجره با fakeredis (همان semantic دستورهای اتمیک واقعی)
- هم‌زنِ هم‌زمان: دقیقاً به‌اندازهٔ سقف اجازه، نه بیشتر (اتمیسیته)
- Redis-down: در dev/test → fallback حافظه‌ای (باز)؛ در prod + auth → fail-closed
- get_client_ip: جعل X-Forwarded-For فقط از پروکسی مورداعتماد پذیرفته می‌شود
- دکوراتور rate_limit روی endpoint واقعی → 429

یادداشت صداقت: سرور Redis واقعی در sandbox نیست؛ تست‌ها روی fakeredis
(همان دستورها: SET NX EX + INCR) و «Redis-down واقعی» (پورت بسته → خطای
اتصال حقیقی) اجرا می‌شوند. تست یکپارچگی با سرور واقعی Redis در Blocked است.
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.rate_limit import (
    DistributedRateLimiter,
    get_client_ip,
    rate_limit,
    trusted_proxy_set,
)


@pytest.fixture()
def fake_redis():
    from fakeredis.aioredis import FakeRedis

    return FakeRedis()


async def test_quota_and_window_expiry(fake_redis):
    rl = DistributedRateLimiter(fake_redis, fail_closed_auth=False)
    key = "t-quota"
    for _ in range(5):
        assert await rl.is_allowed(key, limit=5, window_s=60)
    assert not await rl.is_allowed(key, limit=5, window_s=60)
    # کلید جدا سهمیهٔ جدا دارد
    assert await rl.is_allowed("t-other", limit=5, window_s=60)


async def test_window_expiry_resets_quota(fake_redis):
    rl = DistributedRateLimiter(fake_redis, fail_closed_auth=False)
    key = "t-expiry"
    assert await rl.is_allowed(key, limit=2, window_s=1)
    assert await rl.is_allowed(key, limit=2, window_s=1)
    assert not await rl.is_allowed(key, limit=2, window_s=1)
    await asyncio.sleep(1.2)
    assert await rl.is_allowed(key, limit=2, window_s=1)


async def test_concurrent_requests_exact_quota(fake_redis):
    """۵۰ درخواست هم‌زمان با سقف ۱۰ → دقیقاً ۱۰ تا مجاز (اتمیسیتهٔ SET NX/INCR)."""
    rl = DistributedRateLimiter(fake_redis, fail_closed_auth=False)
    key = "t-conc"
    results = await asyncio.gather(
        *[rl.is_allowed(key, limit=10, window_s=60) for _ in range(50)]
    )
    assert sum(results) == 10, sum(results)


async def test_redis_down_fallback_dev_open():
    """Redis-down واقعی (پورت بسته): در dev/test → fallback حافظه‌ای، باز."""
    from redis import asyncio as aioredis

    client = aioredis.from_url(
        "redis://127.0.0.1:6399/0", socket_connect_timeout=1
    )
    rl = DistributedRateLimiter(client, fail_closed_auth=False)
    # خطای اتصال حقیقی — نه mock
    assert await rl.is_allowed("t-down", limit=3, window_s=60, auth=True)
    assert await rl.is_allowed("t-down", limit=3, window_s=60, auth=True)
    assert await rl.is_allowed("t-down", limit=3, window_s=60, auth=True)
    assert not await rl.is_allowed("t-down", limit=3, window_s=60, auth=True)


async def test_redis_down_fail_closed_prod_auth():
    """همان Redis-down ولی سیاست production: endpoint احرازهویتی → بسته (429 منطقی)."""
    from redis import asyncio as aioredis

    client = aioredis.from_url(
        "redis://127.0.0.1:6399/0", socket_connect_timeout=1
    )
    rl = DistributedRateLimiter(client, fail_closed_auth=True)
    assert await rl.is_allowed("t-down2", limit=3, window_s=60, auth=True) is False
    # غیراحرازهویتی همچنان fallback می‌گیرد
    assert await rl.is_allowed("t-down2", limit=3, window_s=60, auth=False) is True


async def test_no_redis_client_uses_memory():
    rl = DistributedRateLimiter(None, fail_closed_auth=False)
    assert await rl.is_allowed("t-mem", limit=1, window_s=60)
    assert not await rl.is_allowed("t-mem", limit=1, window_s=60)


def test_get_client_ip_ignores_spoofed_xff():
    """XFF جعلی از peer نامعتبر نادیده گرفته می‌شود."""
    from fastapi import Request

    scope = {
        "type": "http",
        "client": ("203.0.113.9", 1234),
        "headers": [(b"x-forwarded-for", b"1.2.3.4")],
    }
    req = Request(scope)
    assert get_client_ip(req, trusted_proxy_set("")) == "203.0.113.9"
    assert get_client_ip(req, trusted_proxy_set("10.0.0.1")) == "203.0.113.9"


def test_get_client_ip_trusted_proxy():
    from fastapi import Request

    scope = {
        "type": "http",
        "client": ("10.0.0.1", 1234),
        "headers": [(b"x-forwarded-for", b"1.2.3.4, 10.0.0.1")],
    }
    req = Request(scope)
    assert get_client_ip(req, trusted_proxy_set("10.0.0.1")) == "1.2.3.4"


def test_get_client_ip_invalid_xff_ignored():
    from fastapi import Request

    scope = {
        "type": "http",
        "client": ("10.0.0.1", 1234),
        "headers": [(b"x-forwarded-for", b"not-an-ip")],
    }
    req = Request(scope)
    assert get_client_ip(req, trusted_proxy_set("10.0.0.1")) == "10.0.0.1"


async def test_rate_limit_decorator_returns_429():
    """دکوراتور روی endpoint واقعی FastAPI: پس از سقف → 429."""
    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient

    from app.core import rate_limit as rl_mod
    from app.core.errors import register_error_handlers

    rl_mod.reset_rate_limiter_for_tests()
    # در تست، limiter سراسری fallback حافظه‌ای دارد (dev)
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/probe")
    @rate_limit(lambda req: "probe", limit=2, window_s=60)
    async def probe(request: Request):
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        assert (await c.get("/probe")).status_code == 200
        assert (await c.get("/probe")).status_code == 200
        r = await c.get("/probe")
        assert r.status_code == 429, r.text
        assert r.json()["error"]["code"] == "rate_limited"
    rl_mod.reset_rate_limiter_for_tests()
