"""سرویس کلیدهای API — فاز ۱۱ (ADR-0008).

امنیت:
- فقط هش SHA-256 کلید در DB است؛ کلید خام فقط لحظهٔ ساخت دیده می‌شود.
- احراز هویت ویجت با هدر X-API-Key یا ?api_key= — بدون کوکی/credential.
- rate limit: token-bucket درون‌حافظه‌ای (per key, per minute) + شمارندهٔ
  سهمیهٔ ماهانه در DB (دورهٔ YYYY-MM).
- scope: نام ویجت باید در scopes کلید باشد (یا "*").
"""
from __future__ import annotations

import hashlib
import html
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.models.models import ApiKey, User

from .schemas import WIDGET_SCOPES

# token-bucket درون‌حافظه‌ای: key_hash → [شروع پنجره، شمارش]
# (تک‌نمونه‌ای؛ در استقرار چندنمونه‌ای، حدِ هر نمونه اعمال می‌شود — در ADR ثبت شد)
_rate_buckets: dict[str, list[float]] = {}
_rate_lock = threading.Lock()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _period_now() -> str:
    now = _utcnow()
    return f"{now.year:04d}-{now.month:02d}"


def _check_rate_limit(key_hash: str, per_min: int) -> None:
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate_buckets.get(key_hash)
        if bucket is None or now - bucket[0] >= 60.0:
            _rate_buckets[key_hash] = [now, 1.0]
            return
        if bucket[1] >= per_min:
            raise APIError(
                429, "rate_limited",
                "سقف درخواست در دقیقه برای این کلید تمام شده است",
                details={"retry_after": int(60 - (now - bucket[0]))},
            )
        bucket[1] += 1.0


def reset_rate_limits() -> None:
    """فقط برای تست."""
    with _rate_lock:
        _rate_buckets.clear()


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
    _check_rate_limit(key.key_hash, key.rate_limit_per_min or 60)

    period = _period_now()
    if key.quota_period != period:
        key.quota_period = period
        key.used_this_month = 0
    if (key.used_this_month or 0) >= (key.quota_monthly or 0):
        raise APIError(
            429, "quota_exceeded", "سهمیهٔ ماهانهٔ این کلید تمام شده است",
            details={"quota_monthly": key.quota_monthly},
        )
    key.used_this_month = (key.used_this_month or 0) + 1
    key.last_used_at = _utcnow()
    await db.commit()
    return key


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


def build_embed_snippet(widget: str, raw_key: str, *, base_url: str = "") -> str:
    """کد HTML جاسازی ویجت — iframe بدون نیاز به JS (ساده و امن)."""
    if widget not in WIDGET_SCOPES:
        raise APIError(422, "unknown_widget", f"ویجت ناشناخته: {widget}")
    title = _WIDGET_TITLES[widget]
    base = _safe_base_url(base_url)
    if widget == "prayer-times":
        # مختصات را صاحب سایت در src می‌گذارد
        src = (
            f"{base}/api/v1/widgets/prayer-times?api_key={raw_key}"
            "&lat={LAT}&lng={LNG}"
        )
        extra = "<!-- به‌جای {LAT} و {LNG} مختصات شهر را بگذارید، مثلاً lat=35.72&lng=51.33 -->"
    else:
        src = f"{base}/api/v1/widgets/{widget}?api_key={raw_key}"
        extra = ""
    return (
        f"<!-- ویجت آکادمی ماتریدی — {title} -->\n"
        f"{extra}\n"
        f'<iframe src="{src}" title="{title}" '
        f'style="border:0;width:100%;max-width:420px;height:320px" '
        f'loading="lazy" referrerpolicy="no-referrer"></iframe>'
    )
