"""سقف اتصال زندهٔ حفاظ — limiter توزیع‌شده روی Redis (P1-3).

وضعِ پیشین: `LiveStreamLimiter` در `hifz_ws_contract.py` کاملاً
درون‌فرایندی است؛ با N worker/replica سقفِ مؤثر N×۴ (کل) و N×۱
(به‌ازای کاربر) می‌شود، چون هر فرایند نمونهٔ خودش را دارد.

این ماژول سقفِ مشترک را می‌سازد — یک ZSET با lease:

- کلید واحد `hifz:live:sessions`؛ عضو = `"{user_id}:{session_id}"`
  (`session_id` همان `attempt_id` اتصال WS است)؛ امتیاز = انقضای
  lease به میلی‌ثانیهٔ epoch.
- چرا ZSET نه شمارندهٔ `INCR/DECR`: شمارنده با crash فرایند (بدون
  `release`) برای همیشه نشتی می‌دهد؛ ZSET با امتیاز انقضا، اسلاتِ
  مرده را خودبه‌خود آزاد می‌کند.
- acquire اتمیک است (اسکریپت Lua: جاروی منقضی‌ها + شمارش کل و
  کاربر + ZADD در یک دستور)؛ دو worker هم‌زمان نمی‌توانند هر دو
  «جا هست» ببینند. heartbeat با `ZADD … XX` فقط lease عضوِ
  هنوزموجود را تازه می‌کند — هرگز نشستِ آزادشده را زنده نمی‌کند.

فعال‌سازی (هر سه، نه یکی — وگرنه limiter توزیع‌شده ساخته نمی‌شود):
  (الف) پلاگین Redis در Railway ساخته و `REDIS_URL` روی api + همهٔ
  workerها ست شود؛ (ب) `APP_ENV=production`؛ (ج) تست‌های
  `tests/test_hifz_p1_345.py` ��بز باشند. بدون (الف)/(ب)، دروازه
  (`LiveStreamLimiterGateway`) همان limiter درون‌فرایندیِ فعلی را
  به کار می‌برد و رفتار امروز بی‌تغییر می‌ماند؛ در آن حالت قیدِ
  سفت «دقیقاً ۱ replica و ۱ worker» برقرار است
  (docs/ops/railway-deployment.md).

رفتار هنگام قطع Redis (تصمیم طراحی، مستند):
- اتصال‌های زندهٔ موجود قطع نمی‌شوند (حافظه را از قبل گرفته‌اند؛
  کشتنشان هیچ حافظه‌ای آزاد نمی‌کند). heartbeat فقط warning لاگ
  می‌خورد و دوباره تلاش می‌کند.
- اتصال‌های تازه در production رد می‌شوند (fail-closed) با
  `LiveAcquire.UNAVAILABLE` → روتر با `hifz_live_unavailable` و
  بستن ۴۴۰۹ جواب می‌دهد؛ در dev/test به limiter درون‌فرایندی
  برمی‌گردند (رفتار امروز).
- پس از بهبودی، شمارشِ معتبر Redis از سر گرفته می‌شود؛ کلیدهای
  lease در دورهٔ قطع هرگز پاک نمی‌شوند، پس بهبودی سهمیه را ریست
  نمی‌کند؛ leaseهای منقضی‌شده در اولین acquire بعدی جارو می‌شوند.

نکتهٔ تست: fakeredis (بدون lupa) دستور `EVAL` را پشتیبانی نمی‌کند؛
مسیر Lua فقط روی Redis واقعی می‌رود و در صورت `ResponseError`
(«unknown command eval») به مسیر fallback می‌رود: همان دستورها با
`asyncio.Lock` همین فرایند (برای تست/توسعه) — اتمی‌بودنِ
میان‌فرایندی فقط روی مسیر Lua تضمین می‌شود. این fallback هرگز در
production استفاده نمی‌شود چون Redis واقعی `EVAL` دارد.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from enum import Enum
from typing import Any
from uuid import UUID

logger = logging.getLogger("maturidi.hifz_live_limiter")

HIFZ_LIVE_REDIS_KEY = "hifz:live:sessions"

# پیش‌فرض‌ها = مقدارهای فعلیِ hifz_ws_contract.py (۱ به‌ازای کاربر،
# ۴ کل روی جعبهٔ ۱ گیگابایتی)؛ از env قابل بازنویسی‌اند (config.py).
DEFAULT_MAX_PER_USER = 1
DEFAULT_MAX_TOTAL = 4
DEFAULT_LEASE_S = 60
DEFAULT_HEARTBEAT_S = 20


class LiveAcquire(str, Enum):
    """نتیجهٔ تلاش برای گرفتن اسلات اتصال زنده."""

    OK = "ok"
    TOO_MANY = "too_many"  # سقف پر است
    UNAVAILABLE = "unavailable"  # زیرساخت (Redis) قطع است — fail-closed


# -- Lua اتمیک: جاروی منقضی‌ها + شمارش + ZADD در یک دستور ----------
# ARGV: 1=now_ms, 2=max_per_user, 3=max_total, 4=user_prefix,
#       5=lease_ms, 6=session_id. نتیجه: 1 قبول، 0 رد.
_LUA_ACQUIRE = (
    "redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1]) "
    "if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end "
    "local members = redis.call('ZRANGEBYLEX', KEYS[1], "
    "'[' .. ARGV[4] .. ':', '[' .. ARGV[4] .. ':\\255') "
    "if #members >= tonumber(ARGV[2]) then return 0 end "
    "redis.call('ZADD', KEYS[1], ARGV[1] + tonumber(ARGV[5]), "
    "ARGV[4] .. ':' .. ARGV[6]) "
    "return 1"
)

# ARGV: 1=new_expiry_ms, 2=member. فقط اگر عضو هنوز هست تازه می‌شود.
_LUA_HEARTBEAT = (
    "if redis.call('ZSCORE', KEYS[1], ARGV[2]) then "
    "return redis.call('ZADD', KEYS[1], 'XX', ARGV[1], ARGV[2]) end "
    "return 0"
)


def _member(user_id: UUID, session_id: UUID) -> str:
    return f"{user_id}:{session_id}"


class DistributedLiveStreamLimiter:
    """سقف اتصال زندهٔ مشترک روی یک کلاینت Redis (async)."""

    def __init__(
        self,
        client: Any,
        *,
        max_per_user: int = DEFAULT_MAX_PER_USER,
        max_total: int = DEFAULT_MAX_TOTAL,
        lease_s: int = DEFAULT_LEASE_S,
        key: str = HIFZ_LIVE_REDIS_KEY,
    ) -> None:
        self._client = client
        self._max_per_user = max_per_user
        self._max_total = max_total
        self._lease_ms = int(lease_s * 1000)
        self._key = key
        # قفلِ مسیر fallback (فقط وقتی EVAL نیست — تست با fakeredis)؛
        # مسیر Lua به این قفل نیاز ندارد چون خودش اتمیک است.
        self._fallback_lock = asyncio.Lock()

    # -- مسیر Lua --

    async def _lua_acquire(self, member: str, user_id: UUID, now_ms: int) -> bool:
        result = await self._client.eval(
            _LUA_ACQUIRE,
            1,
            self._key,
            now_ms,
            self._max_per_user,
            self._max_total,
            str(user_id),
            self._lease_ms,
            member.split(":", 1)[1],
        )
        return int(result) == 1

    async def _lua_heartbeat(self, member: str, now_ms: int) -> bool:
        result = await self._client.eval(
            _LUA_HEARTBEAT, 1, self._key, now_ms + self._lease_ms, member
        )
        return int(result) == 1

    # -- مسیر fallback (بدون EVAL — فقط تست/توسعه) --

    async def _fallback_acquire(
        self, member: str, user_id: UUID, now_ms: int
    ) -> bool:
        async with self._fallback_lock:
            await self._client.zremrangebyscore(self._key, 0, now_ms)
            total = await self._client.zcard(self._key)
            if int(total) >= self._max_total:
                return False
            prefix = str(user_id)
            members = await self._client.zrangebylex(
                self._key, f"[{prefix}:", f"[{prefix}:\xff"
            )
            if len(members) >= self._max_per_user:
                return False
            await self._client.zadd(self._key, {member: now_ms + self._lease_ms})
            return True

    async def _fallback_heartbeat(self, member: str, now_ms: int) -> bool:
        async with self._fallback_lock:
            score = await self._client.zscore(self._key, member)
            if score is None:
                return False
            await self._client.zadd(
                self._key, {member: now_ms + self._lease_ms}, xx=True
            )
            return True

    @staticmethod
    def _eval_unsupported(exc: Exception) -> bool:
        return (
            exc.__class__.__name__ in ("ResponseError", "RedisError")
            and "eval" in str(exc).lower()
        ) or "unknown command" in str(exc).lower()

    # -- API عمومی --

    async def try_acquire(
        self, user_id: UUID, session_id: UUID, *, now_ms: int | None = None
    ) -> bool:
        """True یعنی اسلات گرفته شد (lease ثبت شد)؛ False یعنی سقف پر است.

        acquire تکراری برای همان نشست، عضو را تازه می‌کند نه تکثیر
        (همان member دوباره ZADD می‌شود). خطای اتصال Redis به
        فراخواننده می‌رسد تا دروازه fail-closed/fallback را اعمال کند.
        """
        now = int(time.time() * 1000) if now_ms is None else now_ms
        member = _member(user_id, session_id)
        try:
            return await self._lua_acquire(member, user_id, now)
        except Exception as exc:
            if self._eval_unsupported(exc):
                logger.debug("hifz live limiter: EVAL unsupported, fallback path")
                return await self._fallback_acquire(member, user_id, now)
            raise

    async def release(self, user_id: UUID, session_id: UUID) -> None:
        """آزادسازی اسلات (best-effort — خطا به فراخواننده می‌رسد)."""
        await self._client.zrem(self._key, _member(user_id, session_id))

    async def heartbeat(
        self, user_id: UUID, session_id: UUID, *, now_ms: int | None = None
    ) -> bool:
        """تازه‌کردن lease؛ False یعنی عضو دیگر نیست (آزاد شده/منقضی)."""
        now = int(time.time() * 1000) if now_ms is None else now_ms
        member = _member(user_id, session_id)
        try:
            return await self._lua_heartbeat(member, now)
        except Exception as exc:
            if self._eval_unsupported(exc):
                return await self._fallback_heartbeat(member, now)
            raise

    async def active_total(self) -> int:
        await self._client.zremrangebyscore(self._key, 0, int(time.time() * 1000))
        return int(await self._client.zcard(self._key))

    async def active_for(self, user_id: UUID) -> int:
        prefix = str(user_id)
        members = await self._client.zrangebylex(
            self._key, f"[{prefix}:", f"[{prefix}:\xff"
        )
        return len(members)

    async def release_all_for_user(self, user_id: UUID) -> int:
        """آزادسازی همهٔ اسلات‌های یک کاربر (برای purge داده — P1-5).

        برمی‌گرداند: تعداد اسلات‌های آزادشده.
        """
        prefix = str(user_id)
        members = await self._client.zrangebylex(
            self._key, f"[{prefix}:", f"[{prefix}:\xff"
        )
        if not members:
            return 0
        removed = await self._client.zrem(self._key, *members)
        return int(removed)


class _InProcessFallbackLimiter:
    """limiter درون‌فرایندیِ حداقلی — فقط وقتی دروازهٔ سراسری پیش از
    hifz_ws_contract ساخته شود (در عمل روتر همیشه اول ws_contract را
    وارد می‌کند و نمونهٔ واقعیِ `live_stream_limiter` را می‌دهد)."""

    def __init__(
        self, *, max_per_user: int = DEFAULT_MAX_PER_USER, max_total: int = DEFAULT_MAX_TOTAL
    ) -> None:
        self._max_per_user = max_per_user
        self._max_total = max_total
        self._per_user: dict[UUID, int] = {}
        self._total = 0
        self._lock = asyncio.Lock()

    async def try_acquire(self, user_id: UUID) -> bool:
        async with self._lock:
            if self._total >= self._max_total:
                return False
            if self._per_user.get(user_id, 0) >= self._max_per_user:
                return False
            self._per_user[user_id] = self._per_user.get(user_id, 0) + 1
            self._total += 1
            return True

    async def release(self, user_id: UUID) -> None:
        async with self._lock:
            current = self._per_user.get(user_id, 0)
            if current <= 0:
                return
            if current == 1:
                del self._per_user[user_id]
            else:
                self._per_user[user_id] = current - 1
            self._total -= 1

    def active_total(self) -> int:
        return self._total

    def active_for(self, user_id: UUID) -> int:
        return self._per_user.get(user_id, 0)

    async def release_all(self, user_id: UUID) -> int:
        async with self._lock:
            n = self._per_user.pop(user_id, 0)
            self._total -= n
            return n


class LiveStreamLimiterGateway:
    """دروازهٔ سقف زنده: Redis وقتی هست، درون‌فرایندی وقتی نیست.

    - `redis_client=None` → همیشه محلی (رفتار امروز).
    - Redis هست ولی قطع است → تا پایان cooldown به Redis دست نمی‌زند؛
      بعدش یک پروب واقعی می‌زند (الگوی rate_limit.py: cooldown/probe).
    - در حالت fail-closed (فقط production): اتصالِ تازه هنگام قطع
      `UNAVAILABLE` می‌گیرد؛ در dev/test به محلی برمی‌گردد.
    - اتصال‌های موجود هرگز از این‌جا قطع نمی‌شوند؛ heartbeat فقط
      warning لاگ می‌خورد.
    """

    def __init__(
        self,
        *,
        local: Any,
        redis_client: Any | None = None,
        fail_closed: bool = False,
        retry_cooldown_s: float = 30.0,
        max_per_user: int = DEFAULT_MAX_PER_USER,
        max_total: int = DEFAULT_MAX_TOTAL,
        lease_s: int = DEFAULT_LEASE_S,
    ) -> None:
        self._local = local
        self._dist = (
            DistributedLiveStreamLimiter(
                redis_client,
                max_per_user=max_per_user,
                max_total=max_total,
                lease_s=lease_s,
            )
            if redis_client is not None
            else None
        )
        self._fail_closed = fail_closed
        self._retry_cooldown_s = retry_cooldown_s
        self._redis_dead_since: float | None = None
        # session_id (str) → "redis" | "local"؛ release باید به همان
        # پشتوانه‌ای برود که acquire از آن گرفته بود.
        self._granted: dict[str, str] = {}
        self._granted_lock = asyncio.Lock()

    @property
    def distributed(self) -> bool:
        """True یعنی Redis پیکربندی شده (نه این‌که حتماً سالم است)."""
        return self._dist is not None

    @property
    def fail_closed(self) -> bool:
        return self._fail_closed

    def _redis_in_cooldown(self) -> bool:
        if self._redis_dead_since is None:
            return False
        if time.monotonic() - self._redis_dead_since < self._retry_cooldown_s:
            return True
        self._redis_dead_since = None  # پایان cooldown → پروب بعدی
        return False

    async def _acquire_local(self, user_id: UUID, session_id: UUID) -> LiveAcquire:
        ok = await self._local.try_acquire(user_id)
        if not ok:
            return LiveAcquire.TOO_MANY
        async with self._granted_lock:
            self._granted[str(session_id)] = "local"
        return LiveAcquire.OK

    async def try_acquire(self, user_id: UUID, session_id: UUID) -> LiveAcquire:
        if self._dist is None:
            return await self._acquire_local(user_id, session_id)
        if self._redis_in_cooldown():
            if self._fail_closed:
                logger.warning(
                    "hifz live limiter: redis down (cooldown) — new stream rejected (fail-closed)"
                )
                return LiveAcquire.UNAVAILABLE
            return await self._acquire_local(user_id, session_id)
        try:
            ok = await self._dist.try_acquire(user_id, session_id)
        except Exception as exc:  # noqa: BLE001 — قطع Redis: fail-closed/fallback
            self._redis_dead_since = time.monotonic()
            logger.warning("hifz live limiter: redis unavailable (%s)", exc)
            if self._fail_closed:
                return LiveAcquire.UNAVAILABLE
            return await self._acquire_local(user_id, session_id)
        if not ok:
            return LiveAcquire.TOO_MANY
        async with self._granted_lock:
            self._granted[str(session_id)] = "redis"
        return LiveAcquire.OK

    async def release(self, user_id: UUID, session_id: UUID) -> None:
        """آزادسازی اسلاتِ یک نشست — best-effort، هرگز استثنا نمی‌دهد."""
        async with self._granted_lock:
            backend = self._granted.pop(str(session_id), None)
        try:
            if backend == "redis" and self._dist is not None:
                await self._dist.release(user_id, session_id)
            elif backend == "local":
                await self._local.release(user_id)
            elif backend is None:
                # نشستِ ناشناخته (مثلاً پس از ری‌استارت فرایند):
                # هر دو پشتوانه را best-effort آزاد کن.
                if self._dist is not None:
                    try:
                        await self._dist.release(user_id, session_id)
                    except Exception:
                        logger.debug(
                            "hifz live limiter: fallback release failed",
                            exc_info=True,
                        )
                await self._local.release(user_id)
        except Exception:
            logger.warning("hifz live limiter: release failed", exc_info=True)

    async def heartbeat(self, user_id: UUID, session_id: UUID) -> bool:
        """تازه‌کردن lease نشستِ Redis؛ برای نشستِ محلی همیشه True.

        False یعنی عضو دیگر در Redis نیست (آزاد/منقضی) یا Redis قطع
        است — فراخواننده اتصال را قطع نمی‌کند، فقط لاگ می‌خورد.
        """
        async with self._granted_lock:
            backend = self._granted.get(str(session_id))
        if backend != "redis" or self._dist is None:
            return True
        try:
            return await self._dist.heartbeat(user_id, session_id)
        except Exception as exc:  # noqa: BLE001 — قطع Redis: اتصال می‌ماند
            self._redis_dead_since = time.monotonic()
            logger.warning("hifz live limiter: heartbeat failed (%s)", exc)
            return False

    async def release_all_for_user(self, user_id: UUID) -> int:
        """آزادسازی همهٔ اسلات‌های یک کاربر (محلی + Redis) — برای
        purge داده (P1-5). برمی‌گرداند: تعداد اسلات‌های آزادشده."""
        n = 0
        release_all = getattr(self._local, "release_all", None)
        if callable(release_all):
            try:
                n += int(await release_all(user_id))
            except Exception:
                logger.warning("hifz live limiter: local release-all failed", exc_info=True)
        if self._dist is not None:
            try:
                n += await self._dist.release_all_for_user(user_id)
            except Exception:
                logger.warning(
                    "hifz live limiter: redis release-all failed", exc_info=True
                )
        # توجه: ورودی‌های _granted با کلید session_id نگه داشته می‌شوند،
        # نه user_id؛ پس این‌جا پاک نمی‌شوند — release تکیِ بعدیِ هر
        # نشست، آزادسازیِ دوباره را بی‌اثر انجام می‌دهد و lease منقضی
        # هم خودبه‌خود جارو می‌شود.
        return n

    def active_total_local(self) -> int:
        """شمارشِ محلی (برای دیده‌بانی) — شمارش Redis جدا خوانده می‌شود."""
        try:
            return int(self._local.active_total())
        except Exception:  # noqa: BLE001 — دیده‌بانی هرگز نمی‌شکند
            return 0

    def reset_for_tests(self) -> None:
        """فقط تست: وضعیت قطع Redis را سالم فرض می‌کند."""
        self._redis_dead_since = None
        self._granted.clear()


async def live_lease_heartbeat(
    gateway: LiveStreamLimiterGateway,
    user_id: UUID,
    session_id: UUID,
    *,
    interval_s: float | None = None,
) -> None:
    """حلقهٔ heartbeat یک اتصال زنده — تا لغو، هر interval_s یک‌بار.

    interval پیش‌فرض از `hifz_live_heartbeat_s` در تنظیمات می‌آید.
    لغو (CancelledError) دوباره بالا می‌رود تا finallyِ فراخواننده
    تسک را تمام کند؛ heartbeat ناموفق هرگز اتصال را نمی‌بندد.
    """
    if interval_s is None:
        from app.core.config import get_settings

        interval_s = float(get_settings().hifz_live_heartbeat_s)
    while True:
        await asyncio.sleep(interval_s)
        ok = await gateway.heartbeat(user_id, session_id)
        if not ok:
            logger.warning(
                "hifz live limiter: lease heartbeat missed for user=%s session=%s",
                user_id,
                session_id,
            )


_gateway: LiveStreamLimiterGateway | None = None
_gateway_lock = threading.Lock()


def get_live_stream_limiter(local: Any | None = None) -> LiveStreamLimiterGateway:
    """نمونهٔ سراسری دروازه از روی تنظیمات.

    Redis فقط وقتی ساخته می‌شود که `APP_ENV=production` باشد — همان
    پیش‌شرط فعال‌سازی (provisioning + production + REDIS_URL)؛ در
    dev/test دروازه همیشه محلی است و هیچ اتصالی به Redis باز نمی‌شود.
    `local` را `hifz_ws_contract` (نمونهٔ سراسری `live_stream_limiter`)
    می‌دهد؛ اگر پیش از آن ساخته شود، fallback درون‌فرایندیِ حداقلی
    به کار می‌رود.
    """
    global _gateway
    if _gateway is not None:
        return _gateway
    with _gateway_lock:
        if _gateway is not None:
            return _gateway
        from app.core.config import get_settings

        settings = get_settings()
        local_backend = local or _InProcessFallbackLimiter(
            max_per_user=int(getattr(settings, "hifz_live_max_per_user", 1)),
            max_total=int(getattr(settings, "hifz_live_max_total", 4)),
        )
        client = None
        is_prod = getattr(settings, "app_env", "dev") == "production"
        if is_prod and getattr(settings, "redis_url", ""):
            try:
                from redis import asyncio as aioredis

                client = aioredis.from_url(
                    settings.redis_url, socket_connect_timeout=2
                )
            except Exception as exc:  # noqa: BLE001 — پکیج redis نصب نیست
                logger.warning("hifz live limiter: redis package unavailable (%s)", exc)
        fail_closed = bool(
            getattr(settings, "hifz_live_fail_closed", True)
        ) and is_prod
        _gateway = LiveStreamLimiterGateway(
            local=local_backend,
            redis_client=client,
            fail_closed=fail_closed,
            retry_cooldown_s=float(
                getattr(settings, "rate_limit_redis_retry_s", 30.0) or 30.0
            ),
            max_per_user=int(getattr(settings, "hifz_live_max_per_user", 1)),
            max_total=int(getattr(settings, "hifz_live_max_total", 4)),
            lease_s=int(getattr(settings, "hifz_live_lease_s", 60)),
        )
        return _gateway


def reset_live_stream_limiter_for_tests() -> None:
    """فقط تست: نمونهٔ سراسری را خالی می‌کند تا تست بعدی تازه بسازد."""
    global _gateway
    with _gateway_lock:
        _gateway = None
