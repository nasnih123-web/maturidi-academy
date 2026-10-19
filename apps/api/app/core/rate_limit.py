"""محدودکنندهٔ نرخ توزیع‌شده — remediation-pass-2 Track 1 (§۷).

جایگزین `RateLimiter` حافظه‌ای (`app.core.security`) برای endpointهای حساس:
login، register، بازیابی رمز، تأیید OTP/2FA، عملیات ادمین و endpointهای
پرهزینهٔ AI/voice. حافظهٔ درون‌فرایندی بین instanceها مشترک نیست و زیر
ترافیک واقعی به‌راحتی دور زده می‌شود؛ این پیاده‌سازی روی Redis سوار است.

الگوریتم (بدون Lua — با دستورهای اتمیک استاندارد):
- `SET key 1 EX window NX` → اگر موفق بود، شمارنده ۱ است (TTL هم ست شد).
- وگرنه `INCR key` → شمارندهٔ فعلی؛ مجاز اگر `count <= limit`.

هر دو دستور به‌تنهایی اتمیک‌اند؛ ترکیبشان هم درست است چون فقط برندهٔ
`SET NX` شمارنده را از ۱ شروع می‌کند و TTL همیشه همراه همان دستور ست می‌شود.

رفتار Redis-down (مستند، §۷):
- endpointهای احرازهویتی (`auth=True`) در production → **fail-closed** (رد با 429).
- در dev/staging/test → fail-open با لاگ warning + محدودیت حافظه‌ای محلی
  (بهتر از کاملاً باز بودن).
- endpointهای غیراحرازهویتی → همیشه fallback حافظه‌ای با لاگ warning.

بازیابی پس از قطع (final remediation — Track 2):
- پس از هر خطای Redis، مُهر زمانی `_redis_dead_since` ثبت می‌شود؛ تا
  `redis_retry_cooldown_s` ثانیه بعد، limiter در حالت degraded می‌ماند
  (fail-closed برای auth در prod، وگرنه fallback حافظه‌ای).
- با گذشت cooldown، درخواستِ بعدی دوباره Redis را «پروب» می‌کند: اگر Redis
  برگشته باشد، شمارشِ معتبرِ Redis از سر گرفته می‌شود (نه stuck-open، نه
  stuck-closed)؛ اگر هنوز قطع باشد، cooldown تازه‌ای شروع می‌شود. کلیدهای
  Redis در دورهٔ قطع هرگز پاک نمی‌شوند، پس بهبودی نمی‌تواند سهمیه را ریست
  کند (no quota-reset exploit).

کلیدسازی: `rl:{namespace}:{key}`. برای endpointهای احرازهویتی کلید را
ترکیبی از شناسهٔ کاربر (اگر لاگین کرده) و IP بگذارید تا کاربران پشت یک NAT
همدیگر را قفل نکنند.

ضد جعل X-Forwarded-For: `get_client_ip` هدر را فقط وقتی می‌پذیرد که peer
مستقیم در `trusted_proxies` (تنظیمات) باشد؛ در غیر این صورت IP همان
`request.client.host` است.
"""
from __future__ import annotations

import ipaddress
import logging
import threading
import time
from collections import defaultdict, deque
from typing import Any, Callable

from fastapi import Request

logger = logging.getLogger("maturidi.rate_limit")


class DistributedRateLimiter:
    """محدودکنندهٔ نرخ با پشتوانهٔ Redis + fallback حافظه‌ای."""

    def __init__(
        self,
        client: Any | None = None,
        *,
        namespace: str = "maturidi",
        fail_closed_auth: bool = True,
        redis_retry_cooldown_s: float = 30.0,
    ) -> None:
        self._client = client
        self._ns = namespace
        self._fail_closed_auth = fail_closed_auth
        self._redis_retry_cooldown_s = redis_retry_cooldown_s
        self._mem_hits: dict[str, deque[float]] = defaultdict(deque)
        self._mem_locked_until: dict[str, float] = {}
        self._mem_lock = threading.Lock()
        # مُهر زمانیِ آخرین خطای Redis؛ None یعنی Redis سالم فرض می‌شود.
        # (جایگزین پرچم بولیِ قبلی که پس از بهبودی Redis هرگز ریست نمی‌شد و
        # limiter را برای همیشه stuck-closed / stuck-degraded نگه می‌داشت.)
        self._redis_dead_since: float | None = None

    # -- fallback حافظه‌ای (همان معنای RateLimiter قبلی) --

    def _mem_is_allowed(self, key: str, limit: int, window_s: int) -> bool:
        now = time.time()
        with self._mem_lock:
            if self._mem_locked_until.get(key, 0) > now:
                return False
            dq = self._mem_hits[key]
            while dq and dq[0] <= now - window_s:
                dq.popleft()
            if len(dq) >= limit:
                self._mem_locked_until[key] = now + 900
                return False
            dq.append(now)
            return True

    def _mem_reset(self, key: str) -> None:
        with self._mem_lock:
            self._mem_hits.pop(key, None)
            self._mem_locked_until.pop(key, None)

    # -- مسیر اصلی --

    def _redis_key(self, key: str) -> str:
        return f"rl:{self._ns}:{key}"

    async def is_allowed(
        self, key: str, limit: int, window_s: int, *, auth: bool = False
    ) -> bool:
        """True یعنی درخواست مجاز است. `auth=True` برای endpointهای احرازهویتی."""
        client = self._client
        if client is not None and self._redis_dead_since is not None:
            # دورهٔ degraded پس از قطع: تا پایان cooldown به Redis دست نزن؛
            # بعدش یک پروب واقعی بزن تا بهبودی، شمارش معتبر را برگرداند.
            if time.monotonic() - self._redis_dead_since < self._redis_retry_cooldown_s:
                client = None
            else:
                self._redis_dead_since = None  # پروب؛ اگر شکست بخورد دوباره ست می‌شود
        if client is not None:
            try:
                rkey = self._redis_key(key)
                # برندهٔ SET NX شمارنده را از ۱ شروع می‌کند (با TTL اتمیک)
                first = await client.set(rkey, 1, ex=window_s, nx=True)
                if first:
                    return True
                count = await client.incr(rkey)
                return int(count) <= limit
            except Exception as exc:  # Redis down / خطای شبکه
                self._redis_dead_since = time.monotonic()
                logger.warning(
                    "rate-limit: redis unavailable (%s) — degraded mode", exc
                )
        else:
            # کلاینت Redis پیکربندی نشده یا در cooldown پس از قطع: حالت توسعه/تست
            pass
        if auth and self._fail_closed_auth:
            # §۷: در production نبودِ Redis نباید به‌معنای باز بودن درِ
            # احراز هویت باشد — fail-closed با 429.
            logger.error("rate-limit: auth endpoint denied (fail-closed, no redis)")
            return False
        return self._mem_is_allowed(key, limit, window_s)

    async def reset(self, key: str) -> None:
        self._mem_reset(key)
        if self._client is not None and self._redis_dead_since is None:
            try:
                await self._client.delete(self._redis_key(key))
            except Exception:
                pass

    def reset_for_tests(self) -> None:
        """فقط تست: حافظهٔ محلی را خالی و وضعیت Redis را سالم فرض می‌کند."""
        with self._mem_lock:
            self._mem_hits.clear()
            self._mem_locked_until.clear()
        self._redis_dead_since = None


_limiter: DistributedRateLimiter | None = None
_limiter_lock = threading.Lock()


def get_rate_limiter() -> DistributedRateLimiter:
    """نمونهٔ سراسری از روی تنظیمات (redis_url). ساخت کلاینت Redis lazy است —
    تا اولین دستور، اتصالی برقرار نمی‌شود؛ اگر سرور در دسترس نباشد،
    اولین خطا به fallback می‌رود (در dev/test) یا fail-closed (در prod/auth)."""
    global _limiter
    if _limiter is not None:
        return _limiter
    with _limiter_lock:
        if _limiter is not None:
            return _limiter
        from app.core.config import get_settings

        settings = get_settings()
        client = None
        if settings.redis_url:
            try:
                from redis import asyncio as aioredis

                client = aioredis.from_url(
                    settings.redis_url, socket_connect_timeout=2
                )
            except Exception as exc:  # پکیج redis نصب نیست
                logger.warning("rate-limit: redis package unavailable (%s)", exc)
        # fail-closed فقط در production؛ در dev/staging/test باز با fallback
        fail_closed = bool(
            getattr(settings, "rate_limit_fail_closed", True)
        ) and getattr(settings, "app_env", "dev") == "production"
        retry_s = float(getattr(settings, "rate_limit_redis_retry_s", 30.0) or 30.0)
        _limiter = DistributedRateLimiter(
            client, fail_closed_auth=fail_closed, redis_retry_cooldown_s=retry_s
        )
        return _limiter


def reset_rate_limiter_for_tests() -> None:
    global _limiter
    with _limiter_lock:
        _limiter = None


def get_client_ip(request: Request, trusted_proxies: set[str] | None = None) -> str | None:
    """IP واقعی کلاینت با محافظت در برابر جعل X-Forwarded-For.

    هدر XFF فقط وقتی پذیرفته می‌شود که peer مستقیم (request.client.host)
    در فهرست پروکسی‌های مورداعتماد باشد؛ وگرنه همان IP مستقیم برمی‌گردد.
    """
    peer = request.client.host if request.client else None
    if trusted_proxies and peer in trusted_proxies:
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            candidate = xff.split(",")[0].strip()
            try:
                ipaddress.ip_address(candidate)
                return candidate
            except ValueError:
                logger.warning("rate-limit: invalid XFF value ignored")
    return peer


def trusted_proxy_set(raw: str | None) -> set[str]:
    out: set[str] = set()
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ipaddress.ip_address(part)
            out.add(part)
        except ValueError:
            logger.warning("rate-limit: invalid trusted proxy ignored: %s", part)
    return out


def rate_limit(
    key_fn: Callable[[Request], str],
    *,
    limit: int,
    window_s: int,
    auth: bool = False,
    error_code: str = "rate_limited",
    message: str = "تعداد درخواست بیش از حد مجاز است",
):
    """دکوراتور FastAPI برای endpointهای حساس (ادمین، AI/voice پرهزینه، ...).

    مثال:
        @router.post("/admin/purge")
        @rate_limit(lambda req: f"admin:{req.state.user_id}", limit=10, window_s=60)
        async def purge(...): ...

    نکتهٔ پیاده‌سازی: چون ماژول‌ها `from __future__ import annotations` دارند،
    annotationها رشته‌اند و FastAPI آن‌ها را در `__globals__` تابع می‌گشاید؛
    wrapper باید hintهای resolveشدهٔ تابع اصلی را یدک بکشد وگرنه
    Pydantic با ForwardRefِ حل‌نشده می‌شکند.

    ریشهٔ باگ 422 (final remediation — Track 2): اگر hintها قابل resolve
    نباشند و بی‌صدا به annotationهای رشته‌ایِ حل‌نشده برگردیم، FastAPI آن‌ها
    را در `__globals__` همین ماژول (`app.core.rate_limit`) — نه ماژولِ
    endpoint — می‌گشاید؛ با ForwardRefِ حل‌نشده، پارامتر (مثلاً body) بد
    دسته‌بندی می‌شود و هر درخواست 422 می‌گیرد بی‌آنکه مسیر 429 دیده شود.
    پس: اول `typing.get_type_hints` در globals خودِ تابع؛ اگر شکست خورد
    (مثلاً importِ محلیِ داخل تابعِ تست)، هر annotation جداگانه در globals
    تابع و سپس در globals همین ماژول resolve می‌شود؛ نامی که هیچ‌جا حل
    نشود، همان لحظهٔ دکوراسیون RuntimeError صریح می‌دهد (fail-fast).
    قرارداد API برای endpointهای سالم هیچ تغییری نمی‌کند.
    """
    import inspect
    import typing
    from functools import wraps

    from app.core.errors import APIError

    def _resolve_hints(fn) -> dict:
        """hintهای تابع endpoint در namespace درست.

        برمی‌گرداند: dict نام → تایپِ resolveشده (شامل 'return').
        namespace ترکیبی است: globals ماژولِ endpoint مقدم است؛ globals
        همین ماژول فقط برای سازگاری با رفتار قبلی اضافه می‌شود (پیش‌تر
        FastAPI رشته‌ها را در همین namespace می‌گشود — مثلاً `Request` در
        تست‌ها). نامی که هیچ‌جا حل نشود → RuntimeError صریح، تا به 422ِ
        خاموشِ runtime تبدیل نشود.
        """
        fn_ns = getattr(fn, "__globals__", None) or {}
        merged = {**globals(), **fn_ns}
        try:
            return typing.get_type_hints(fn, globalns=merged, localns=None)
        except Exception as exc:
            raise RuntimeError(
                "@rate_limit: cannot resolve annotation "
                f"in {getattr(fn, '__qualname__', fn)!r} "
                "— FastAPI would misbind the parameter (HTTP 422 on "
                "every request) because the wrapper resolves annotations "
                f"in the decorator's module, not the endpoint's module: {exc}"
            ) from exc

    def decorator(fn):
        resolved_hints = _resolve_hints(fn)
        try:
            sig = inspect.signature(fn)
            params = [
                p.replace(annotation=resolved_hints.get(p.name, p.annotation))
                for p in sig.parameters.values()
            ]
            resolved_sig = sig.replace(parameters=params)
        except Exception:
            resolved_sig = None

        @wraps(fn)
        async def wrapper(*args, **kwargs):
            request: Request | None = kwargs.get("request")
            if request is None:
                for a in args:
                    if isinstance(a, Request):
                        request = a
                        break
            key = key_fn(request) if request is not None else "unknown"
            if not await get_rate_limiter().is_allowed(
                key, limit, window_s, auth=auth
            ):
                raise APIError(429, error_code, message)
            return await fn(*args, **kwargs)

        if resolved_hints:
            wrapper.__annotations__ = dict(resolved_hints)
        if resolved_sig is not None:
            wrapper.__signature__ = resolved_sig
        return wrapper

    return decorator
