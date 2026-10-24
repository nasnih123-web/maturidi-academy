"""FIX2-05 — نبود Redis بیرون از dev نباید بی‌صدا به InMemoryBus بیفتد.

قرارداد:
- staging/production: create_event_bus در startup raise می‌کند
  (fail-fast) — degradation نامرئی رویدادها ممنوع.
- dev: fallback حافظه‌ای با لاگ هشدار می‌ماند (رفتار قبلی).
"""
from __future__ import annotations

import pytest

from app.core import dispatcher
from app.core.config import get_settings
from app.core.dispatcher import InMemoryBus, create_event_bus


def _kill_redis(monkeypatch) -> None:
    def _boom(*a, **k):
        raise ConnectionError("no redis here")

    monkeypatch.setattr("redis.asyncio.from_url", _boom)


def _set_env(monkeypatch, app_env: str) -> None:
    monkeypatch.setattr(get_settings(), "app_env", app_env)


@pytest.mark.parametrize("app_env", ["production", "staging"])
async def test_event_bus_failfast_outside_dev(monkeypatch, app_env):
    _set_env(monkeypatch, app_env)
    _kill_redis(monkeypatch)
    with pytest.raises(RuntimeError, match="in-memory fallback is dev-only"):
        await create_event_bus()


async def test_event_bus_dev_fallback_kept(monkeypatch):
    _set_env(monkeypatch, "dev")
    _kill_redis(monkeypatch)
    bus = await create_event_bus()
    assert isinstance(bus, InMemoryBus)


async def test_event_bus_production_uses_redis_when_available(monkeypatch):
    """fail-fast فقط برای شکست است؛ Redis سالم در production عادی کار می‌کند."""
    import fakeredis.aioredis as fake_aioredis

    _set_env(monkeypatch, "production")
    fake = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr("redis.asyncio.from_url", lambda *a, **k: fake)
    bus = await create_event_bus()
    assert isinstance(bus, dispatcher.RedisBus)
    await bus.close()
