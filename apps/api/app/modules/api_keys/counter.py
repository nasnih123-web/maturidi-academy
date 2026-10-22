"""شمارندهٔ مصرف کلیدهای ویجت — Redis با flush دوره‌ای (C-06 / F2).

پیش از C-06، validate_key روی هر رندر ویجت یک UPDATE + COMMIT روی
ردیف ApiKey می‌زد (write-per-render). حالا شمارش در Redis است
(INCR اتمیک؛ seed از مقدار durable دیتابیس در اولین hit دوره) و یک
flush دوره‌ای (هر ۶۰ ثانیه از lifespan اپ) دلتاها را به دیتابیس
می‌نویسد. اگر Redis در دسترس نباشد، شمارندهٔ buffered درون‌پروسه‌ای
با همان معنای flush جایگزین می‌شود — در هیچ مسیری write-per-render
به دیتابیس نداریم.

معنا: سهمیه (quota) از روی شمارندهٔ زنده چک می‌شود (نه مقدار عقبِ
دیتابیس)؛ hit ردشده با refund خنثی می‌شود تا فقط مصرف واقعی بشمارد.
پنجرهٔ ریسک: کرش پروسه بین دو flush حداکثر ۶۰ ثانیه شمارشِ
flush‌نشده را از دست می‌دهد (شمارش از مقدار durable دیتابیس دوباره
seed می‌شود) — مصالحهٔ مستند همین finding.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Protocol

logger = logging.getLogger("app.api_keys.counter")

try:  # redis وابستگی واقعی است (arq)؛ این alias فقط برای except امن است
    from redis.exceptions import RedisError as _RedisError
except ImportError:  # pragma: no cover
    class _RedisError(Exception):  # type: ignore[no-redef]
        pass

FLUSH_INTERVAL_SECONDS = 60.0
_COUNT_PREFIX = "widget_usage"
_PENDING_KEY = "widget_usage:pending"
_LAST_USED_KEY = "widget_usage:last_used"


def _count_key(key_hash: str, period: str) -> str:
    return f"{_COUNT_PREFIX}:{key_hash}:{period}"


class UsageCounter(Protocol):
    async def hit(self, key_hash: str, period: str, *, seed: int) -> int:
        """یک مصرف ثبت کن و مجموع زندهٔ دوره را برگردان."""
        ...

    async def refund(self, key_hash: str, period: str) -> None:
        """خنثی‌کردن یک hit (مثلاً وقتی سهمیه رد شد و مصرف نباید بشمارد)."""
        ...

    async def drain_pending(self) -> dict[str, tuple[str, int, float]]:
        """دلتاهای flush‌نشده: key_hash → (period, delta, last_used_ts)."""
        ...


class InProcessUsageCounter:
    """fallback درون‌پروسه‌ای (dev / نبود Redis) — buffered، بدون DB."""

    def __init__(self) -> None:
        self._totals: dict[tuple[str, str], int] = {}
        self._pending: dict[str, tuple[str, int, float]] = {}
        self._lock = asyncio.Lock()

    async def hit(self, key_hash: str, period: str, *, seed: int) -> int:
        async with self._lock:
            k = (key_hash, period)
            if k not in self._totals:
                self._totals[k] = seed
            self._totals[k] += 1
            total = self._totals[k]
            p_period, p_delta, _ = self._pending.get(key_hash, (period, 0, 0.0))
            self._pending[key_hash] = (p_period, p_delta + 1, time.time())
            return total

    async def refund(self, key_hash: str, period: str) -> None:
        async with self._lock:
            k = (key_hash, period)
            if k in self._totals:
                self._totals[k] -= 1
            if key_hash in self._pending:
                p_period, p_delta, ts = self._pending[key_hash]
                self._pending[key_hash] = (p_period, p_delta - 1, ts)

    async def drain_pending(self) -> dict[str, tuple[str, int, float]]:
        async with self._lock:
            out = {k: v for k, v in self._pending.items() if v[1] != 0}
            self._pending = {}
            return out


class RedisUsageCounter:
    """شمارندهٔ Redis — INCR اتمیک + hash دلتاهای pending برای flush."""

    def __init__(self, client) -> None:
        self._client = client

    async def hit(self, key_hash: str, period: str, *, seed: int) -> int:
        ck = _count_key(key_hash, period)
        # seed فقط وقتی کلید نیست (SET NX) تا شمارش از مقدار durable ادامه یابد
        await self._client.set(ck, seed, nx=True)
        total = int(await self._client.incr(ck))
        await self._client.hincrby(_PENDING_KEY, key_hash, 1)
        await self._client.hset(
            _LAST_USED_KEY, {key_hash: f"{period}|{time.time()}"}
        )
        return total

    async def refund(self, key_hash: str, period: str) -> None:
        await self._client.decr(_count_key(key_hash, period))
        await self._client.hincrby(_PENDING_KEY, key_hash, -1)

    async def drain_pending(self) -> dict[str, tuple[str, int, float]]:
        raw = await self._client.hgetall(_PENDING_KEY)
        last = await self._client.hgetall(_LAST_USED_KEY)
        await self._client.delete(_PENDING_KEY)
        out: dict[str, tuple[str, int, float]] = {}
        for key_hash, delta in (raw or {}).items():
            kh = key_hash.decode() if isinstance(key_hash, bytes) else key_hash
            d = int(delta)
            if d == 0:
                continue
            stamp = (last or {}).get(kh) or (last or {}).get(key_hash)
            period, ts = "", 0.0
            if stamp:
                s = stamp.decode() if isinstance(stamp, bytes) else stamp
                period, _, ts_s = s.partition("|")
                try:
                    ts = float(ts_s)
                except ValueError:
                    ts = 0.0
            out[kh] = (period, d, ts)
        return out


_counter: UsageCounter | None = None
_counter_lock = asyncio.Lock()


async def get_usage_counter() -> UsageCounter:
    """singleton تنبل: اول Redis (با ping)، وگرنه in-process با لاگ هشدار."""
    global _counter
    if _counter is not None:
        return _counter
    async with _counter_lock:
        if _counter is not None:
            return _counter
        from app.core.config import get_settings

        settings = get_settings()
        try:
            import redis.asyncio as aioredis

            client = aioredis.from_url(
                settings.redis_url, socket_connect_timeout=2
            )
            await client.ping()
            _counter = RedisUsageCounter(client)
            logger.info("widget usage counter: redis")
        except (ImportError, OSError, ValueError, _RedisError) as exc:
            logger.warning(
                "widget usage counter: redis unavailable (%s) — in-process "
                "buffered fallback (flush still applies)",
                exc,
            )
            _counter = InProcessUsageCounter()
        return _counter


def set_usage_counter_for_test(counter: UsageCounter | None) -> None:
    global _counter
    _counter = counter


async def flush_usage_counters(db) -> int:
    """دلتاهای pending را به ردیف‌های ApiKey اعمال کن. -> تعداد ردیف‌های به‌روز."""
    from sqlalchemy import select

    from app.models.models import ApiKey

    counter = await get_usage_counter()
    pending = await counter.drain_pending()
    if not pending:
        return 0
    updated = 0
    for key_hash, (period, delta, last_ts) in pending.items():
        row = (
            await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
        ).scalar_one_or_none()
        if row is None:
            continue
        if period and row.quota_period != period:
            row.quota_period = period
            row.used_this_month = delta
        else:
            row.used_this_month = (row.used_this_month or 0) + delta
        if last_ts:
            row.last_used_at = datetime.fromtimestamp(last_ts, tz=UTC)
        updated += 1
    if updated:
        await db.commit()
    return updated


async def run_usage_flush_loop() -> None:
    """حلقهٔ flush دوره‌ای — از lifespan اپ API اجرا می‌شود (C-06)."""
    from sqlalchemy.exc import SQLAlchemyError

    from app.core.database import SessionLocal

    while True:
        try:
            await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
            async with SessionLocal() as db:
                n = await flush_usage_counters(db)
                if n:
                    logger.info("widget usage flush: %s keys persisted", n)
        except asyncio.CancelledError:
            raise
        except (SQLAlchemyError, OSError, RuntimeError):
            logger.warning("widget usage flush failed", exc_info=True)
