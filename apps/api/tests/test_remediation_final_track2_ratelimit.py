"""final remediation — Track 2 / Finding 5: بازیابی rate limiter پس از قطع Redis.

یافته: پرچم `_redis_dead` پس از اولین خطا هرگز ریست نمی‌شد؛ با بهبودی Redis،
limiter برای همیشه در حالت degraded می‌ماند: در prod روی مسیرهای auth
stuck-closed (رد دائمی) و روی مسیرهای غیراحرازهویتی stuck-degraded
(fallback حافظه‌ایِ تک‌فرایندی). اصلاح: cooldown + پروبِ واقعیِ Redis.

این تست‌ها با FlakyRedis اجرا می‌شوند — فیکی کنترل‌شونده فقط در مرز
کلاینت Redis (سوکت): همان semantic دستورهای واقعی (SET NX EX / INCR روی
fakeredis) و همان اکسپشن واقعیِ `redis.exceptions.ConnectionError` هنگام
قطع. منطق failover (try/except، cooldown، fail-closed) واقعاً ورزش داده
می‌شود؛ هیچ mockای رفتار امنیتی را پنهان نمی‌کند.
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.rate_limit import DistributedRateLimiter


class FlakyRedis:
    """فیگ کنترل‌شونده در مرز زیرساخت: fakeredis + خطای اتصال واقعی."""

    def __init__(self) -> None:
        from fakeredis.aioredis import FakeRedis
        from redis.exceptions import ConnectionError as RedisConnectionError

        self._real = FakeRedis()
        self._exc = RedisConnectionError
        self.down = False
        self.calls = 0  # تعداد تلاش‌های واقعی برای تماس با Redis

    async def _guard(self) -> None:
        self.calls += 1
        if self.down:
            raise self._exc("simulated redis outage")

    async def set(self, *args, **kwargs):
        await self._guard()
        return await self._real.set(*args, **kwargs)

    async def incr(self, *args, **kwargs):
        await self._guard()
        return await self._real.incr(*args, **kwargs)

    async def delete(self, *args, **kwargs):
        await self._guard()
        return await self._real.delete(*args, **kwargs)


COOLDOWN = 0.2


def _limiter(fake: FlakyRedis, *, fail_closed_auth: bool) -> DistributedRateLimiter:
    return DistributedRateLimiter(
        fake, fail_closed_auth=fail_closed_auth, redis_retry_cooldown_s=COOLDOWN
    )


async def test_outage_fail_closed_then_recovery_resumes_redis_counting():
    """قطع → auth در prod-policy بسته می‌ماند؛ پس از بهبودی، شمارشِ معتبرِ
    Redis از سر گرفته می‌شود: نه stuck-closed، نه ریست سهمیه."""
    fake = FlakyRedis()
    rl = _limiter(fake, fail_closed_auth=True)
    key = "t2-rec"

    # دو مصرفِ پیش از قطع (سقف ۳)
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True)
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True)

    # قطع: مسیر احرازهویتی بسته (fail-closed)، غیراحرازهویتی fallback
    fake.down = True
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True) is False
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=False) is True

    # بهبودی پس از cooldown: شمارش Redis ادامه می‌یابد (سومی مجاز، چهارمی رد)
    await asyncio.sleep(COOLDOWN + 0.15)
    fake.down = False
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True) is True
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True) is False


async def test_quota_not_reset_by_outage_recovery_cycle():
    """سهمیهٔ مصرف‌شده در Redis با چرخهٔ قطع/بهبودی ریست نمی‌شود
    (no quota-reset exploit)."""
    fake = FlakyRedis()
    rl = _limiter(fake, fail_closed_auth=True)
    key = "t2-noreset"

    for _ in range(3):
        assert await rl.is_allowed(key, limit=3, window_s=60, auth=True)
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True) is False

    fake.down = True
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True) is False
    await asyncio.sleep(COOLDOWN + 0.15)
    fake.down = False
    # سهمیه همچنان تمام‌شده است — قطع، شمارندهٔ Redis را پاک نکرده
    assert await rl.is_allowed(key, limit=3, window_s=60, auth=True) is False


async def test_no_probe_during_cooldown_probe_after():
    """در دورهٔ cooldown هیچ تماسی با Redis زده نمی‌شود؛ پس از آن پروب واقعی."""
    fake = FlakyRedis()
    rl = _limiter(fake, fail_closed_auth=True)
    key = "t2-cd"

    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True)
    n_after_ok = fake.calls

    fake.down = True
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is False
    n_after_fail = fake.calls
    assert n_after_fail == n_after_ok + 1

    # در cooldown: بدون پروب (calls ثابت)، همچنان fail-closed
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is False
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is False
    assert fake.calls == n_after_fail

    # پس از cooldown و با Redis سالم: پروب موفق و بازگشت به شمارش Redis
    await asyncio.sleep(COOLDOWN + 0.15)
    fake.down = False
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is True
    assert fake.calls > n_after_fail


async def test_still_down_after_cooldown_starts_new_cooldown():
    """اگر پس از cooldown هنوز قطع باشد، پروب شکست می‌خورد و cooldown تازه‌ای
    شروع می‌شود (نه تلاش بی‌وقفه، نه stuck)."""
    fake = FlakyRedis()
    rl = _limiter(fake, fail_closed_auth=True)
    key = "t2-retry"

    fake.down = True
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is False
    await asyncio.sleep(COOLDOWN + 0.15)
    # هنوز قطع است: پروب شکست می‌خورد → fail-closed + cooldown جدید
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is False
    n = fake.calls
    assert await rl.is_allowed(key, limit=5, window_s=60, auth=True) is False
    assert fake.calls == n  # cooldown جدید، بدون پروب


async def test_non_auth_recovers_to_redis_authority_no_stuck_open():
    """مسیر غیراحرازهویتی: در قطع، fallback حافظه‌ای (باز)؛ پس از بهبودی،
    مرجعیت به Redis برمی‌گردد — نه stuck-open روی fallback."""
    fake = FlakyRedis()
    rl = _limiter(fake, fail_closed_auth=False)
    key = "t2-noname"

    for _ in range(2):
        assert await rl.is_allowed(key, limit=2, window_s=60, auth=False)
    assert await rl.is_allowed(key, limit=2, window_s=60, auth=False) is False

    fake.down = True
    # degraded: fallback حافظه‌ایِ تازه‌نفس، باز است (سیاست مستند غیر-auth)
    assert await rl.is_allowed(key, limit=2, window_s=60, auth=False) is True

    await asyncio.sleep(COOLDOWN + 0.15)
    fake.down = False
    # بهبودی: شمارندهٔ Redis (که پر است) دوباره مرجع است
    assert await rl.is_allowed(key, limit=2, window_s=60, auth=False) is False


async def test_dev_open_still_recovers():
    """در dev/test (fail_closed_auth=False) مسیر auth در قطع بازِ fallback است
    و پس از بهبودی به Redis برمی‌گردد."""
    fake = FlakyRedis()
    rl = _limiter(fake, fail_closed_auth=False)
    key = "t2-dev"

    fake.down = True
    assert await rl.is_allowed(key, limit=1, window_s=60, auth=True) is True
    assert await rl.is_allowed(key, limit=1, window_s=60, auth=True) is False

    await asyncio.sleep(COOLDOWN + 0.15)
    fake.down = False
    # شمارندهٔ Redis جداست (در قطع دست‌نخورده ماند) → اولین مصرف مجاز
    assert await rl.is_allowed(key, limit=1, window_s=60, auth=True) is True
    assert await rl.is_allowed(key, limit=1, window_s=60, auth=True) is False
