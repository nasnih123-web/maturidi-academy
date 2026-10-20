"""اتصال حساب تلگرام (Telethon) از داخل CRM — فاز ۱۱ (ADR-0008).

جریان دومرحله‌ای (اسپک فاز ۱۱ — پاسخ به «نه اسکریپت دستی»):
  ۱) request_code {phone} → Telethon کد ورود می‌فرستد؛ phone_code_hash
     رمزنگاری‌شده در platform_settings می‌ماند (TTL ده دقیقه).
  ۲) confirm_code {phone, code, password?} → sign_in کامل؛ StringSession
     رمزنگاری‌شده در telegram.session ذخیره می‌شود.

§۳: کلید رمزنگاری از env می‌آید، هرگز از DB. §۱۴: مقدار session هرگز در
audit old/new values نیست — فقط {"field": "telegram_session", "changed": true}.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.logging import logger
from app.core.platform_settings import (
    bump_settings_version,
    get_setting,
    stage_setting,
)
from app.models.models import PlatformSetting, User

from . import telethon_client as mtproto

PENDING_TTL_SECONDS = 600
_PHONE_RE = re.compile(r"^\+?[0-9]{5,20}$")


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _mask_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) <= 4:
        return "****"
    return f"+{digits[:-4].replace(digits[:-4], '*' * len(digits[:-4]))}{digits[-4:]}"


async def _write_settings(db: AsyncSession, values: dict[str, str | None]) -> None:
    """upsert چند کلید + commit + باطل‌سازی کش (hot-reload)."""
    for key, plaintext in values.items():
        if plaintext is None:
            row = await db.get(PlatformSetting, key)
            if row is not None:
                await db.delete(row)
        else:
            await stage_setting(db, key, plaintext)
    await db.commit()
    bump_settings_version(list(values.keys()))


async def _telethon_creds(db: AsyncSession) -> tuple[int, str]:
    api_id_raw = await get_setting(db, "telegram.api_id")
    api_hash = await get_setting(db, "telegram.api_hash")
    if not api_id_raw or not api_hash:
        raise APIError(
            422,
            "telegram_not_configured",
            "api_id/api_hash تلگرام در تنظیمات پلتفرم ثبت نشده است",
        )
    try:
        api_id = int(api_id_raw.strip())
    except ValueError:
        raise APIError(422, "telegram_bad_api_id", "api_id تلگرام نامعتبر است")
    return api_id, api_hash.strip()


def _validate_phone(phone: str) -> str:
    phone = (phone or "").strip().replace(" ", "")
    if not _PHONE_RE.match(phone):
        raise APIError(422, "bad_phone", "شمارهٔ تلفن نامعتبر است")
    return phone


async def request_code(
    db: AsyncSession,
    *,
    phone: str,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """قدم ۱: ارسال کد ورود به شمارهٔ کاربر."""
    phone = _validate_phone(phone)
    api_id, api_hash = await _telethon_creds(db)

    client = mtproto.create_client(None, api_id, api_hash)
    try:
        await client.connect()
        if await client.is_user_authorized():
            raise APIError(409, "telegram_already_connected", "حساب تلگرام قبلاً متصل است")
        sent = await client.send_code_request(phone)
        phone_code_hash = getattr(sent, "phone_code_hash", None)
        if not phone_code_hash:
            raise APIError(502, "telegram_code_failed", "ارسال کد ورود ناموفق بود")
    finally:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    expires_at = _utcnow() + timedelta(seconds=PENDING_TTL_SECONDS)
    await _write_settings(
        db,
        {
            "telegram.pending_phone": phone,
            "telegram.pending_phone_code_hash": phone_code_hash,
            "telegram.pending_expires_at": expires_at.isoformat(),
        },
    )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.connect.request_code",
        entity_type="telegram_connection",
        entity_id="primary",
        new_values={"phone_masked": _mask_phone(phone), "code_sent": True},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    return {"phone_masked": _mask_phone(phone), "expires_in": PENDING_TTL_SECONDS}


async def confirm_code(
    db: AsyncSession,
    *,
    phone: str,
    code: str,
    password: str | None = None,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """قدم ۲: تکمیل ورود و ذخیرهٔ session رمزنگاری‌شده."""
    phone = _validate_phone(phone)
    code = (code or "").strip()
    if not code:
        raise APIError(422, "bad_code", "کد ورود نامعتبر است")

    pending_phone = await get_setting(db, "telegram.pending_phone")
    phone_code_hash = await get_setting(db, "telegram.pending_phone_code_hash")
    expires_raw = await get_setting(db, "telegram.pending_expires_at")
    try:
        expires_at = datetime.fromisoformat(expires_raw) if expires_raw else None
    except ValueError:
        expires_at = None
    if (
        not pending_phone
        or not phone_code_hash
        or pending_phone != phone
        or expires_at is None
        or expires_at < _utcnow()
    ):
        raise APIError(
            422, "code_expired_or_invalid",
            "کد ورود منقضی یا نامعتبر است؛ دوباره درخواست بدهید",
        )

    api_id, api_hash = await _telethon_creds(db)
    client = mtproto.create_client(None, api_id, api_hash)
    try:
        await client.connect()
        try:
            await client.sign_in_with_code(phone, code, phone_code_hash)
        except mtproto.SessionPasswordNeeded:
            if not password:
                raise APIError(
                    422, "password_required",
                    "این حساب رمز دومرحله‌ای دارد؛ password را هم بفرستید",
                )
            await client.sign_in_with_password(password)
        session_str = client.save_session()
        if not session_str:
            raise APIError(502, "telegram_session_failed", "ذخیرهٔ session ناموفق بود")
    finally:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    # §۱۴: مقدار session هرگز در audit نیست — فقط changed:true
    await _write_settings(
        db,
        {
            "telegram.session": session_str,
            "telegram.phone_masked": _mask_phone(phone),
            "telegram.pending_phone": None,
            "telegram.pending_phone_code_hash": None,
            "telegram.pending_expires_at": None,
        },
    )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.connect.confirm_code",
        entity_type="telegram_connection",
        entity_id="primary",
        new_values={
            "field": "telegram_session",
            "changed": True,
            "phone_masked": _mask_phone(phone),
        },
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    logger.info("telegram account connected")
    return {"connected": True, "phone_masked": _mask_phone(phone)}


async def status(db: AsyncSession) -> dict:
    """وضعیت اتصال — بدون افشای هیچ secret."""
    session = await get_setting(db, "telegram.session")
    phone_masked = await get_setting(db, "telegram.phone_masked")
    if session:
        return {"connected": True, "phone_masked": phone_masked}
    return {"connected": False, "phone_masked": None}


async def disconnect(
    db: AsyncSession,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    await _write_settings(
        db,
        {
            "telegram.session": None,
            "telegram.phone_masked": None,
            "telegram.pending_phone": None,
            "telegram.pending_phone_code_hash": None,
            "telegram.pending_expires_at": None,
        },
    )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.connect.disconnect",
        entity_type="telegram_connection",
        entity_id="primary",
        new_values={"field": "telegram_session", "changed": True, "connected": False},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    return {"connected": False}


async def load_session(db: AsyncSession) -> str | None:
    """خواندن session رمزگشایی‌شده — فقط برای مصرف داخلی سرویس درون‌ریزی."""
    return await get_setting(db, "telegram.session")
