"""سرویس کلیدهای API — فاز ۱۱ (ADR-0008).

امنیت:
- فقط هش SHA-256 کلید در DB است؛ کلید خام فقط لحظهٔ ساخت دیده می‌شود.
- احراز هویت ویجت فقط با هدر X-API-Key، یا با توکن embed امضاشده
  (Pass 4 / A5: کلید خام هرگز در query string نمی‌آید).
- rate limit: محدودکنندهٔ توزیع‌شده (Redis، Pass 4 / A1) per key,
  per minute + شمارندهٔ سهمیهٔ ماهانه (دورهٔ YYYY-MM). وقتی Redis
  در دسترس نباشد، limiter به fallback حافظه‌ایِ محدود (نه نامحدود)
  می‌رود و هشدار لاگ می‌کند — در آن حالت، سقف، سقفِ هر پردازه است
  و ادعای توزیع‌شده ندارد.
- scope: نام ویجت باید در scopes کلید باشد (یا "*").
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.models.models import ApiKey, User

from .schemas import WIDGET_SCOPES

# Pass 4 / A1: limiter قابل تزریق برای تست (دو نمونه روی یک بک‌اند
# مشترک). None یعنی limiter سراسری (Redis در صورت پیکربندی).
_rate_limiter_for_test = None

logger = logging.getLogger(__name__)



def set_rate_limiter_for_test(limiter) -> None:
    global _rate_limiter_for_test
    _rate_limiter_for_test = limiter


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _period_now() -> str:
    now = _utcnow()
    return f"{now.year:04d}-{now.month:02d}"


async def _check_rate_limit(key_hash: str, per_min: int) -> None:
    """Pass 4 / A1: سقف دقیقه‌ای روی limiter توزیع‌شده.

    کلید limiter با hash کلید ساخته می‌شود (نه کلید خام — در لاگ/
    Redis نشت نمی‌کند). در صورت نبود Redis، limiter خودش به
    fallback حافظه‌ایِ محدود می‌رود (با لاگ warning) — هرگز نامحدود
    نیست، ولی در آن حالت توزیع‌شده هم نیست.
    """
    from app.core.rate_limit import get_rate_limiter

    limiter = _rate_limiter_for_test or get_rate_limiter()
    allowed = await limiter.is_allowed(
        f"api_key_per_min:{key_hash}", per_min, 60, auth=False
    )
    if not allowed:
        raise APIError(
            429, "rate_limited",
            "سقف درخواست در دقیقه برای این کلید تمام شده است",
            details={"retry_after": 60},
        )


def reset_rate_limits() -> None:
    """فقط برای تست: حالت limiter تزریق‌شده و سراسری را پاک کن."""
    if _rate_limiter_for_test is not None:
        _rate_limiter_for_test.reset_for_tests()
    try:
        from app.core.rate_limit import reset_rate_limiter_for_tests

        reset_rate_limiter_for_tests()
    except Exception:  # noqa: BLE001 — reset تست نباید تست را بکشد
        logger.debug("reset_rate_limits: global limiter reset skipped")


# ---------------------------------------------------------------------------
# توکن embed امضاشده (Pass 4 / A5)
# ---------------------------------------------------------------------------
# چرا: iframe نمی‌تواند هدر سفارشی بفرستد، پس حذفِ ?api_key= بدون
# جایگزین، همهٔ embedها را می‌شکست. جایگزین، توکنِ امضاشدهٔ
# تک‌ویجتی است — نه کلید خام:
# - payload: {kid: شناسهٔ عمومی کلید, w: ویجت, exp: انقضا}
# - امضا: HMAC با کلید امضای storage (همان ریشهٔ signed URLها،
#   نه JWT) — چرخش کلید، توکن‌های قدیمی را با همان مکانیزم
#   previous-key می‌پذیرد تا انقضایشان.
# - لغو: با revoke کلید، توکن هم می‌میرد (lookup روی ردیف ApiKey).
# - دامنه: فقط همان یک ویجت؛ توکن یک ویجت روی ویجت دیگر کار نمی‌کند.
# - انقضا: پیش‌فرض ۳۶۵ روز (snippet استاتیک است)؛ پس از انقضا باید
#   از endpoint embed-snippet توکن تازه گرفت.
EMBED_TOKEN_TTL_DAYS = 365


def issue_embed_token(key_id: uuid.UUID, widget: str, *, days: int = EMBED_TOKEN_TTL_DAYS) -> str:
    from app.core.config import get_settings
    from app.core.storage import storage_signing_keys

    payload = {
        "kid": str(key_id),
        "w": widget,
        "exp": int(time.time()) + days * 86400,
    }
    raw = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    sig = hmac.new(
        storage_signing_keys(get_settings())[0].encode(),
        raw.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{raw}.{sig}"


def verify_embed_token(token: str, widget: str) -> uuid.UUID | None:
    """توکن معتبر → شناسهٔ کلید؛ در غیر این صورت None (بدون افشای دلیل)."""
    try:
        raw, sig = token.rsplit(".", 1)
        from app.core.config import get_settings
        from app.core.storage import storage_signing_keys

        keys = storage_signing_keys(get_settings())
        if not any(
            hmac.compare_digest(
                hmac.new(k.encode(), raw.encode(), hashlib.sha256).hexdigest(), sig
            )
            for k in keys
        ):
            return None
        payload = json.loads(
            base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        )
        if payload.get("w") != widget:
            return None
        if int(payload.get("exp", 0)) <= int(time.time()):
            return None
        return uuid.UUID(str(payload["kid"]))
    except Exception:  # noqa: BLE001 - توکن بدشکل = نامعتبر، بدون نشت دلیل
        return None


def _out(key: ApiKey) -> dict:
    return {
        "id": key.id,
        "name": key.name,
        "key_prefix": key.key_prefix,
        "scopes": key.scopes or [],
        "rate_limit_per_min": key.rate_limit_per_min,
        "quota_monthly": key.quota_monthly,
        "used_this_month": key.used_this_month,
        "quota_period": key.quota_period,
        "is_active": key.is_active,
        "abuse_flag": key.abuse_flag,
        "last_used_at": key.last_used_at,
        "created_at": key.created_at,
        "revoked_at": key.revoked_at,
    }


async def create_key(
    db: AsyncSession, data: dict, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    raw = f"mk_{secrets.token_urlsafe(32)}"
    key = ApiKey(
        key_hash=_hash_key(raw),
        key_prefix=raw[:8],
        name=data["name"],
        scopes=list(data.get("scopes") or []),
        rate_limit_per_min=data.get("rate_limit_per_min", 60),
        quota_monthly=data.get("quota_monthly", 10000),
        used_this_month=0,
        quota_period=_period_now(),
        is_active=True,
        created_by=actor.id,
    )
    db.add(key)
    await db.flush()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="api_keys.create",
        entity_type="api_key",
        entity_id=str(key.id),
        # §۱۴: هش هم ثبت نمی‌شود — فقط prefix برای شناسایی
        new_values={"name": key.name, "key_prefix": key.key_prefix,
                     "scopes": key.scopes},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(key)
    out = _out(key)
    out["key"] = raw  # فقط همین یک‌بار!
    return out


async def list_keys(db: AsyncSession) -> tuple[list[dict], int]:
    total = (await db.execute(select(func.count()).select_from(ApiKey))).scalar_one()
    rows = (
        await db.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))
    ).scalars().all()
    return [_out(k) for k in rows], total


async def get_key(db: AsyncSession, key_id: uuid.UUID) -> dict:
    key = await db.get(ApiKey, key_id)
    if key is None:
        raise APIError(404, "api_key_not_found", "کلید یافت نشد")
    return _out(key)


async def update_key(
    db: AsyncSession, key_id: uuid.UUID, data: dict, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    key = await db.get(ApiKey, key_id)
    if key is None:
        raise APIError(404, "api_key_not_found", "کلید یافت نشد")
    old = {"is_active": key.is_active, "scopes": key.scopes}
    for field in ("name", "scopes", "rate_limit_per_min", "quota_monthly",
                  "is_active", "abuse_flag"):
        if field in data and data[field] is not None:
            setattr(key, field, data[field])
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="api_keys.update",
        entity_type="api_key",
        entity_id=str(key.id),
        old_values=old,
        new_values={"is_active": key.is_active, "scopes": key.scopes,
                     "abuse_flag": key.abuse_flag},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(key)
    return _out(key)


async def revoke_key(
    db: AsyncSession, key_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    key = await db.get(ApiKey, key_id)
    if key is None:
        raise APIError(404, "api_key_not_found", "کلید یافت نشد")
    key.is_active = False
    key.revoked_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="api_keys.revoke",
        entity_type="api_key",
        entity_id=str(key.id),
        new_values={"is_active": False, "key_prefix": key.key_prefix},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(key)
    return _out(key)


async def usage_stats(db: AsyncSession, key_id: uuid.UUID) -> dict:
    key = await db.get(ApiKey, key_id)
    if key is None:
        raise APIError(404, "api_key_not_found", "کلید یافت نشد")
    remaining = max(0, (key.quota_monthly or 0) - (key.used_this_month or 0))
    return {
        "id": key.id,
        "name": key.name,
        "key_prefix": key.key_prefix,
        "quota_period": key.quota_period,
        "used_this_month": key.used_this_month,
        "quota_monthly": key.quota_monthly,
        "quota_remaining": remaining,
        "rate_limit_per_min": key.rate_limit_per_min,
        "last_used_at": key.last_used_at,
        "is_active": key.is_active,
        "abuse_flag": key.abuse_flag,
    }


async def validate_key(
    db: AsyncSession, raw_key: str | None, *, scope: str
) -> ApiKey:
    """اعتبارسنجی کلید ویجت: وجود، فعال‌بودن، scope، rate-limit، سهمیه.

    خطاها با پاکت یکدست §۱: 401 (نامعتبر)، 403 (scope)، 429 (rate/quota).
    """
    if not raw_key:
        raise APIError(401, "api_key_required", "کلید API لازم است")
    key = (
        await db.execute(select(ApiKey).where(ApiKey.key_hash == _hash_key(raw_key)))
    ).scalar_one_or_none()
    if key is None or not key.is_active or key.revoked_at is not None:
        raise APIError(401, "api_key_invalid", "کلید API نامعتبر است")
    if key.abuse_flag:
        raise APIError(403, "api_key_abused", "این کلید به‌دلیل سوءاستفاده مسدود شده است")
    scopes = key.scopes or []
    if scope not in scopes and "*" not in scopes:
        raise APIError(
            403, "api_key_scope_denied",
            f"این کلید به ویجت «{scope}» دسترسی ندارد",
            details={"scope": scope},
        )
    await _apply_rate_and_quota(db, key)
    return key


async def validate_embed_token(
    db: AsyncSession, token: str | None, *, scope: str
) -> ApiKey:
    """اعتبارسنجی توکن embed (Pass 4 / A5) — همان scope/rate/quota
    کلید خام، ولی بدون این‌که کلید خام در URL باشد."""
    if not token:
        raise APIError(401, "api_key_required", "کلید API لازم است")
    key_id = verify_embed_token(token, scope)
    if key_id is None:
        raise APIError(401, "api_key_invalid", "کلید API نامعتبر است")
    key = await db.get(ApiKey, key_id)
    if key is None or not key.is_active or key.revoked_at is not None:
        raise APIError(401, "api_key_invalid", "کلید API نامعتبر است")
    if key.abuse_flag:
        raise APIError(403, "api_key_abused", "این کلید به‌دلیل سوءاستفاده مسدود شده است")
    scopes = key.scopes or []
    if scope not in scopes and "*" not in scopes:
        raise APIError(
            403, "api_key_scope_denied",
            f"این کلید به ویجت «{scope}» دسترسی ندارد",
            details={"scope": scope},
        )
    await _apply_rate_and_quota(db, key)
    return key


async def _apply_rate_and_quota(db: AsyncSession, key: ApiKey) -> None:
    await _check_rate_limit(key.key_hash, key.rate_limit_per_min or 60)

    # C-06/F2: شمارش مصرف دیگر write-per-render روی دیتابیس نیست —
    # شمارندهٔ Redis (یا fallback درون‌پروسه‌ای) با flush دوره‌ای.
    # سهمیه از شمارندهٔ زنده چک می‌شود؛ hit ردشده refund می‌شود.
    # Pass 4 / A6: مرگ Redis در میانهٔ hit دیگر ۵۰۰ نمی‌دهد —
    # به fallback درون‌پروسه‌ایِ محدود (با بهبودی در flush بعدی) می‌رویم.
    from .counter import get_usage_counter, switch_to_inprocess_after_redis_failure

    period = _period_now()
    seed = (key.used_this_month or 0) if key.quota_period == period else 0
    counter = await get_usage_counter()
    try:
        total = await counter.hit(key.key_hash, period, seed=seed)
    except Exception:  # noqa: BLE001 - مرگ Redis در میانهٔ hit = fallback
        counter = await switch_to_inprocess_after_redis_failure()
        total = await counter.hit(key.key_hash, period, seed=seed)
    if total > (key.quota_monthly or 0):
        await counter.refund(key.key_hash, period)
        raise APIError(
            429, "quota_exceeded", "سهمیهٔ ماهانهٔ این کلید تمام شده است",
            details={"quota_monthly": key.quota_monthly},
        )


# ---------------------------------------------------------------------------
# مولد کد embed
# ---------------------------------------------------------------------------


_WIDGET_TITLES = {
    "prayer-times": "اوقات شرعی",
    "ayah-of-day": "آیهٔ روز",
    "latest-fatwa": "آخرین فتوا",
    "zakat-mini": "محاسبهٔ زکات",
}


def _safe_base_url(base_url: str) -> str:
    """اعتبارسنجی + escape پایهٔ URL برای کد embed.

    یافتهٔ امنیتی فاز ۱۷ (SEC-17-04): base_url ورودیِ کاربر بود و بدون هیچ
    اعتبارسنجی/escape داخل صفت src قرار می‌گرفت (attribute-breakout → XSS
    در کدی که قرار است در سایت‌های ثالث الصاق شود). حالا فقط http(s) یا
    خالی پذیرفته است و خروجی escape می‌شود.
    """
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return ""
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise APIError(
            422, "invalid_base_url", "base_url باید یک نشانی معتبر http(s) باشد"
        )
    return html.escape(base, quote=True)


def build_embed_snippet(widget: str, embed_token: str, *, base_url: str = "") -> str:
    """کد HTML جاسازی ویجت — iframe بدون نیاز به JS (ساده و امن).

    Pass 4 / A5: پارامتر دوم دیگر کلید خام نیست، توکن embed
    امضاشده است (`?embed_token=`) — کلید خام هرگز در snippet/URL
    قرار نمی‌گیرد. برای سازگاری با تست‌های قدیمی، مقدار
    `"__API_KEY__"` (placeholder) همان‌طور که هست در URL می‌ماند
    و صاحب سایت باید آن را با توکن واقعی جایگزین کند.
    """
    if widget not in WIDGET_SCOPES:
        raise APIError(422, "unknown_widget", f"ویجت ناشناخته: {widget}")
    title = _WIDGET_TITLES[widget]
    base = _safe_base_url(base_url)
    if widget == "prayer-times":
        # مختصات را صاحب سایت در src می‌گذارد
        src = (
            f"{base}/api/v1/widgets/prayer-times?embed_token={embed_token}"
            "&lat={LAT}&lng={LNG}"
        )
        extra = "<!-- به‌جای {LAT} و {LNG} مختصات شهر را بگذارید، مثلاً lat=35.72&lng=51.33 -->"
    else:
        src = f"{base}/api/v1/widgets/{widget}?embed_token={embed_token}"
        extra = ""
    return (
        f"<!-- ویجت آکادمی ماتریدی — {title} -->\n"
        f"{extra}\n"
        f'<iframe src="{src}" title="{title}" '
        f'style="border:0;width:100%;max-width:420px;height:320px" '
        f'loading="lazy" referrerpolicy="no-referrer"></iframe>'
    )
