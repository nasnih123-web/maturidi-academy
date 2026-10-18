"""سرویس ادمین — تنظیمات پلتفرم (hot-reload) و dead-letter رویدادها (فاز ۲).

امنیت (فاز ۰ §۳ و §۱۴):
- مقادیر حساس فقط به‌صورت envelope رمزنگاری‌شده در DB — هرگز plaintext.
- در پاسخ GET، کلیدهای حساس mask می‌شوند ("***")؛ در audit log فقط
  {"changed": True} ثبت می‌شود، هرگز مقدار واقعی.
- هر نوشتن حساس → domain_event + audit log (قانون لایه‌بندی).
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.database import ensure_aware
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import (
    SETTING_DEFS,
    bump_settings_version,
    decode_setting_value,
    encode_setting_value,
    get_settings_version,
    get_setting,
    is_sensitive,
    stage_setting,
)
from app.models.models import DomainEvent, PlatformSetting, User
from app.modules.admin.schemas import DeadLetterEventOut

MASKED = "***"

# ---------------------------------------------------------------------------
# آپلود فونت سفارشی (میل‌استون polish، تسک Track A شمارهٔ ۳)
# قرارداد §۷: اعتبارسنجی پسوند + magic-byte + سقف حجم. فایل‌ها زیر دایرکتوری
# static سرو می‌شوند (/static — در main.py mount شده).
# ---------------------------------------------------------------------------

# ریشهٔ static — apps/api/static (تک منبع حقیقت؛ main.py هم از همین می‌خواند)
STATIC_DIR = Path(__file__).resolve().parents[3] / "static"

FONT_LOCALES = ("fa", "ar", "en")
# پسوند → magic bytes اول فایل (قرارداد §۷ — پسوند به‌تنهایی قابل جعل است)
FONT_MAGIC: dict[str, bytes] = {
    ".woff2": b"wOF2",
    ".woff": b"wOFF",
    ".ttf": b"\x00\x01\x00\x00",
}
FONT_MAX_BYTES = 5 * 1024 * 1024  # ۵ مگابایت


def _font_key(locale: str) -> str:
    return f"fonts.{locale}"


def _slugify_family(family: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", family.strip().lower()).strip("-")
    return slug[:60] or "font"


async def upload_font(
    db: AsyncSession,
    user: User,
    locale: str,
    family: str,
    content: bytes,
    filename: str | None,
    ip: str | None,
    user_agent: str | None,
) -> dict:
    """اعتبارسنجی + ذخیرهٔ فونت و ثبت در fonts.<locale>."""
    locale = (locale or "").strip().lower()
    if locale not in FONT_LOCALES:
        raise APIError(400, "invalid_locale", "لوکیل باید یکی از fa/ar/en باشد")
    family = (family or "").strip()
    if not family or len(family) > 120:
        raise APIError(400, "invalid_font_family", "نام فونت باید ۱ تا ۱۲۰ نویسه باشد")

    ext = Path(filename or "").suffix.lower()
    magic = FONT_MAGIC.get(ext)
    if magic is None:
        raise APIError(
            400,
            "invalid_font_extension",
            "پسوند فونت باید یکی از woff2/woff/ttf باشد",
            {"allowed": sorted(FONT_MAGIC)},
        )
    if len(content) > FONT_MAX_BYTES:
        raise APIError(
            413,
            "font_too_large",
            "حجم فونت نباید بیش از ۵ مگابایت باشد",
            {"max_bytes": FONT_MAX_BYTES},
        )
    if len(content) < 4 or content[:4] != magic:
        raise APIError(400, "invalid_font_file", "محتوای فایل با پسوند اعلام‌شده سازگار نیست")

    safe_name = f"{_slugify_family(family)}-{uuid.uuid4().hex[:8]}{ext}"
    target = STATIC_DIR / "fonts" / locale
    target.mkdir(parents=True, exist_ok=True)
    (target / safe_name).write_bytes(content)

    url = f"/static/fonts/{locale}/{safe_name}"
    key = _font_key(locale)
    value = {"family": family, "url": url}
    await stage_setting(db, key, encode_setting_value("json", value, key))

    await emit_event(
        db,
        aggregate_type="platform",
        aggregate_id="settings",
        event_type="platform.settings_updated",
        payload={"keys": [key], "updated_by": str(user.id), "action": "font_upload"},
        source_client="crm",
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="admin",
        action="platform.font_upload",
        entity_type="platform_setting",
        entity_id=key,
        new_values={"family": family, "url": url},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    version = bump_settings_version([key])
    return {"locale": locale, "family": family, "url": url, "version": version}


async def delete_font(
    db: AsyncSession,
    user: User,
    locale: str,
    ip: str | None,
    user_agent: str | None,
) -> dict:
    """برگرداندن فونت به داخلی (fonts.<locale> = null) + حذف فایل."""
    locale = (locale or "").strip().lower()
    if locale not in FONT_LOCALES:
        raise APIError(400, "invalid_locale", "لوکیل باید یکی از fa/ar/en باشد")

    key = _font_key(locale)
    raw = await get_setting(db, key)
    if raw:
        try:
            current = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            current = None
        url = (current or {}).get("url") or ""
        prefix = f"/static/fonts/{locale}/"
        if url.startswith(prefix):
            name = url[len(prefix):]
            # محافظت در برابر path traversal — فقط نام فایل ساده
            if name and "/" not in name and "\\" not in name and not name.startswith("."):
                (STATIC_DIR / "fonts" / locale / name).unlink(missing_ok=True)

    await stage_setting(db, key, encode_setting_value("json", None, key))
    await emit_event(
        db,
        aggregate_type="platform",
        aggregate_id="settings",
        event_type="platform.settings_updated",
        payload={"keys": [key], "updated_by": str(user.id), "action": "font_delete"},
        source_client="crm",
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="admin",
        action="platform.font_delete",
        entity_type="platform_setting",
        entity_id=key,
        new_values={"reverted_to_builtin": True},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    version = bump_settings_version([key])
    return {"locale": locale, "family": None, "url": None, "version": version}


async def list_settings(db: AsyncSession) -> dict:
    """همهٔ کلیدهای ثبت‌شده — حساس‌ها mask شده."""
    rows = {
        r.key: r
        for r in (await db.execute(select(PlatformSetting))).scalars().all()
    }
    items = []
    for key in sorted(SETTING_DEFS):
        meta = SETTING_DEFS[key]
        row = rows.get(key)
        sensitive = bool(meta.get("sensitive"))
        value: Any = None
        if row is not None:
            raw = await get_setting(db, key)
            value = MASKED if sensitive else decode_setting_value(meta["type"], raw or "")
        items.append(
            {
                "key": key,
                "value": value,
                "masked": sensitive,
                "type": meta["type"],
                "updated_at": ensure_aware(row.updated_at) if row else None,
            }
        )
    return {"settings": items, "version": get_settings_version()}


async def update_settings(
    db: AsyncSession,
    user: User,
    data: dict[str, Any],
    ip: str | None,
    user_agent: str | None,
) -> dict:
    """به‌روزرسانی تنظیمات + bump نسخهٔ hot-reload (بدون نیاز به ری‌استارت)."""
    changed: list[str] = []
    audit_new: dict[str, Any] = {}
    for key, raw_value in data.items():
        meta = SETTING_DEFS.get(key)
        if meta is None:
            raise APIError(400, "unknown_setting", f"کلید ناشناخته: {key}")
        if meta.get("sensitive") and raw_value == MASKED:
            continue  # بدون تغییر
        try:
            plaintext = encode_setting_value(meta["type"], raw_value, key)
        except ValueError as exc:
            raise APIError(400, "invalid_setting_value", f"{key}: {exc}")
        await stage_setting(db, key, plaintext)
        changed.append(key)
        audit_new[key] = (
            {"changed": True}
            if is_sensitive(key)
            else decode_setting_value(meta["type"], plaintext)
        )

    if not changed:
        return {"updated": [], "version": get_settings_version()}

    await emit_event(
        db,
        aggregate_type="platform",
        aggregate_id="settings",
        event_type="platform.settings_updated",
        payload={"keys": changed, "updated_by": str(user.id)},
        source_client="crm",
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="admin",
        action="platform.settings_update",
        entity_type="platform_setting",
        entity_id=",".join(changed),
        new_values=audit_new,  # حساس‌ها قبلاً به {"changed": True} تبدیل شده‌اند
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    version = bump_settings_version(changed)
    return {"updated": changed, "version": version}


async def list_dead_letter(db: AsyncSession, limit: int = 50) -> dict:
    """رویدادهایی که بعد از ۵ شکست به dead-letter رفته‌اند — قابل مشاهدهٔ ادمین."""
    total = (
        await db.execute(
            select(func.count()).select_from(DomainEvent).where(DomainEvent.failed_at.is_not(None))
        )
    ).scalar_one()
    stmt = (
        select(DomainEvent)
        .where(DomainEvent.failed_at.is_not(None))
        .order_by(DomainEvent.failed_at.desc())
        .limit(limit)
    )
    events = (await db.execute(stmt)).scalars().all()
    return {
        "events": [
            DeadLetterEventOut(
                event_id=str(e.event_id),
                event_type=e.event_type,
                aggregate_type=e.aggregate_type,
                aggregate_id=e.aggregate_id,
                payload=e.payload,
                schema_version=e.schema_version,
                created_at=ensure_aware(e.created_at),
                retry_count=e.retry_count,
                failed_at=ensure_aware(e.failed_at) if e.failed_at else None,
            )
            for e in events
        ],
        "total": total,
    }


async def retry_dead_letter(
    db: AsyncSession,
    user: User,
    event_id: uuid.UUID,
    ip: str | None,
    user_agent: str | None,
) -> DomainEvent:
    """بازگرداندن یک رویداد dead-letter به چرخهٔ dispatch."""
    event = await db.get(DomainEvent, event_id)
    if event is None:
        raise APIError(404, "not_found", "رویداد یافت نشد")
    if event.failed_at is None:
        raise APIError(400, "not_dead_letter", "این رویداد در dead-letter نیست")
    event.failed_at = None
    event.retry_count = 0
    await emit_event(
        db,
        aggregate_type="platform",
        aggregate_id=str(event.event_id),
        event_type="platform.event_requeued",
        payload={"event_type": event.event_type, "requeued_by": str(user.id)},
        source_client="crm",
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="admin",
        action="platform.event_requeue",
        entity_type="domain_event",
        entity_id=str(event.event_id),
        new_values={"failed_at": None, "retry_count": 0},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    return event
