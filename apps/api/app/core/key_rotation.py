"""مهاجرت تدریجی envelopeها به نسخهٔ جاری کلید — M-05.

دو مخزن envelope در سیستم هست: ردیف‌های `platform_settings` (هر مقدار
با envelope ذخیره شده) و `users.totp_secret` (رشتهٔ JSON از envelope).
این helper هر دو را اسکن می‌کند و هرچه نسخه‌اش قدیمی است با کلید جاری
دوباره رمز می‌کند؛ مقدار جاری دست نمی‌خورد. خطای رمزگشایی (کلید گمشده)
شمرده و گزارش می‌شود — هرگز بی‌صدا رد نمی‌شود.

نکتهٔ امنیتی (قرارداد §۱۴): هیچ plaintext یا مادهٔ کلیدی در خروجی و
لاگ این ماژول نیست — فقط شمارنده‌ها.
"""
from __future__ import annotations

import json

from cryptography.fernet import InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import logger
from app.core.secrets import envelope_version, reencrypt_envelope
from app.models.models import PlatformSetting, User


async def reencrypt_all(db: AsyncSession) -> dict:
    """چرخش تدریجی همهٔ envelopeهای ذخیره‌شده به نسخهٔ کلید جاری.

    خروجی: شمارنده‌های {settings_rotated, settings_current,
    totp_rotated, totp_current, unreadable} — بدون هیچ مقداری.
    commit با caller است.
    """
    current = get_settings().encryption_key_version
    out = {
        "current_version": current,
        "settings_rotated": 0,
        "settings_current": 0,
        "totp_rotated": 0,
        "totp_current": 0,
        "unreadable": 0,
    }

    rows = (await db.execute(select(PlatformSetting))).scalars().all()
    for row in rows:
        try:
            if envelope_version(row.value) == current:
                out["settings_current"] += 1
                continue
            rotated = reencrypt_envelope(row.value)
        except (ValueError, KeyError, TypeError, InvalidToken):
            out["unreadable"] += 1
            logger.warning(
                "key rotation: setting %s unreadable (missing old key?)",
                row.key,
            )
            continue
        if rotated is not None:
            row.value = rotated
            row.encryption_key_version = current
            out["settings_rotated"] += 1

    users = (
        await db.execute(select(User).where(User.totp_secret.is_not(None)))
    ).scalars().all()
    for user in users:
        try:
            envelope = json.loads(user.totp_secret or "")
            if envelope_version(envelope) == current:
                out["totp_current"] += 1
                continue
            rotated = reencrypt_envelope(envelope)
        except (ValueError, KeyError, TypeError, InvalidToken):
            out["unreadable"] += 1
            logger.warning(
                "key rotation: totp envelope of user %s unreadable", user.id
            )
            continue
        if rotated is not None:
            user.totp_secret = json.dumps(rotated)
            out["totp_rotated"] += 1

    await db.flush()
    return out
