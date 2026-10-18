"""کش درون‌فرایندی platform_settings با شمارندهٔ نسخه — فاز ۲.

**قانون hot-reload:** هر به‌روزرسانی تنظیمات، ورودی کش را باطل و شمارندهٔ نسخه
را بالا می‌برد؛ بنابراین کلیدهای AI و بقیه **بدون ری‌استارت** اعمال می‌شوند.
هر ماژولی که به تنظیمات نیاز دارد (مثل AI در فازهای بعد) باید از
`get_typed_setting(db, key)` بخواند، نه مستقیم از جدول.

- مقادیر در DB همیشه با envelope رمزنگاری‌شدهٔ فاز ۰ §۳ ذخیره می‌شوند.
- نوع هر کلید در SETTING_DEFS ثبت است: secret | string | localized | uuid.
- کش thread-safe است (threading.Lock) چون dispatcher و workerها ممکن است
  event loop جدا داشته باشند.
"""
from __future__ import annotations

import json
import threading
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.secrets import decrypt_value, encrypt_value
from app.models.models import PlatformSetting

# رجیستری کلیدهای مجاز تنظیمات پلتفرم — فقط همین کلیدها از API ادمین قابل نوشتن‌اند
SETTING_DEFS: dict[str, dict] = {
    "ai.model": {"type": "string", "sensitive": False, "label": "مدل AI"},
    "ai.api_key": {"type": "secret", "sensitive": True, "label": "کلید API هوش مصنوعی"},
    "ai.fallback_model": {"type": "string", "sensitive": False, "label": "مدل جایگزین"},
    "telegram.bot_token": {"type": "secret", "sensitive": True, "label": "توکن بات تلگرام"},
    "telegram.channel": {"type": "string", "sensitive": False, "label": "کانال تلگرام"},
    "payment.zarinpal_key": {"type": "secret", "sensitive": True, "label": "کلید زرین‌پال"},
    "payment.idpay_key": {"type": "secret", "sensitive": True, "label": "کلید آیدی‌پی"},
    "map.key": {"type": "secret", "sensitive": True, "label": "کلید نقشه"},
    "email.smtp_password": {"type": "secret", "sensitive": True, "label": "رمز SMTP ایمیل"},
    "sms.api_key": {"type": "secret", "sensitive": True, "label": "کلید API پیامک"},
    "branding.app_display_name": {"type": "localized", "sensitive": False, "label": "نام نمایشی اپ"},
    "branding.app_icon_media_id": {"type": "uuid", "sensitive": False, "label": "آیکون اپ"},
    "branding.app_splash_media_id": {"type": "uuid", "sensitive": False, "label": "اسپلش اپ"},
}

_MISS = object()
_cache: dict[str, str] = {}
_cache_lock = threading.Lock()
_version: int = 0


def get_settings_version() -> int:
    """شمارندهٔ نسخه — با هر به‌روزرسانی یکی بالا می‌رود."""
    with _cache_lock:
        return _version


def bump_settings_version(keys: list[str] | None = None) -> int:
    """باطل‌سازی کش + افزایش نسخه — بعد از commit موفقِ به‌روزرسانی صدا زده شود."""
    global _version
    with _cache_lock:
        if keys:
            for k in keys:
                _cache.pop(k, None)
        else:
            _cache.clear()
        _version += 1
        return _version


def reset_settings_cache() -> None:
    """فقط برای تست — کش و نسخه را به حالت اول برمی‌گرداند."""
    global _version
    with _cache_lock:
        _cache.clear()
        _version = 0


async def get_setting(db: AsyncSession, key: str, default: str | None = None) -> str | None:
    """مقدار رمزگشایی‌شدهٔ خام (رشته). برای localized یک JSON رشته‌ای برمی‌گردد."""
    with _cache_lock:
        hit = _cache.get(key, _MISS)
    if hit is not _MISS:
        return hit  # type: ignore[return-value]
    row = await db.get(PlatformSetting, key)
    if row is None:
        return default
    value = decrypt_value(row.value)
    with _cache_lock:
        _cache[key] = value
    return value


async def get_typed_setting(db: AsyncSession, key: str, default: Any = None) -> Any:
    """مقدار با نوع درست: localized → dict، بقیه → str."""
    raw = await get_setting(db, key)
    if raw is None:
        return default
    meta = SETTING_DEFS.get(key, {})
    if meta.get("type") == "localized":
        return json.loads(raw)
    return raw


async def stage_setting(db: AsyncSession, key: str, plaintext: str) -> None:
    """نوشتن (upsert) بدون commit — سرویس ادمین تراکنش را مدیریت می‌کند."""
    settings = get_settings()
    await db.merge(
        PlatformSetting(
            key=key,
            value=encrypt_value(plaintext),
            encryption_key_version=settings.encryption_key_version,
        )
    )


def encode_setting_value(setting_type: str, value: Any) -> str:
    """اعتبارسنجی + تبدیل مقدار ورودی API به رشتهٔ قابل رمزنگاری."""
    if setting_type == "localized":
        if not isinstance(value, dict) or not value:
            raise ValueError("localized value must be a non-empty object")
        for lang, text in value.items():
            if not isinstance(text, str):
                raise ValueError(f"localized[{lang}] must be a string")
        return json.dumps(value, ensure_ascii=False)
    if setting_type == "uuid":
        if value in (None, ""):
            return ""
        uuid.UUID(str(value))  # اعتبارسنجی فرمت
        return str(value)
    if not isinstance(value, str):
        raise ValueError("value must be a string")
    return value


def decode_setting_value(setting_type: str, plaintext: str) -> Any:
    if setting_type == "localized":
        return json.loads(plaintext)
    return plaintext


def is_sensitive(key: str) -> bool:
    return bool(SETTING_DEFS.get(key, {}).get("sensitive"))
