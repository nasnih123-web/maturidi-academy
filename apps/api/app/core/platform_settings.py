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
import time
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
    # --- میل‌استون polish (Track A): تنظیمات قابل‌کنترل از CRM ---
    "particles": {"type": "json", "sensitive": False, "label": "ذرات پس‌زمینه (وب + CRM)"},
    "fonts.fa": {"type": "json", "sensitive": False, "label": "فونت سفارشی فارسی"},
    "fonts.ar": {"type": "json", "sensitive": False, "label": "فونت سفارشی عربی"},
    "fonts.en": {"type": "json", "sensitive": False, "label": "فونت سفارشی انگلیسی"},
    "home.sections": {"type": "json", "sensitive": False, "label": "اسلات‌های زیرِ هیرو (ترتیب + واریانت)"},
    "hero.fa": {"type": "json", "sensitive": False, "label": "متن هیروی فارسی"},
    "hero.ar": {"type": "json", "sensitive": False, "label": "متن هیروی عربی"},
    "hero.en": {"type": "json", "sensitive": False, "label": "متن هیروی انگلیسی"},
}

_MISS = object()
_cache: dict[str, tuple[str, float]] = {}
_cache_lock = threading.Lock()
_version: int = 0

# حداکثر عمر ورودی کش تنظیمات (ثانیه) — تسک Track A شمارهٔ ۲:
# هیچ کش سمت‌سرور نباید بیش از ۶۰ ثانیه دادهٔ قدیمی سرو کند. هر نوشتن
# همچنان فوراً کش را باطل و نسخهٔ hot-reload را بالا می‌برد (ADR-002).
SETTINGS_CACHE_TTL = 60.0


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
        entry = _cache.get(key, _MISS)
    if entry is not _MISS:
        value, stored_at = entry
        if time.monotonic() - stored_at <= SETTINGS_CACHE_TTL:
            return value  # type: ignore[return-value]
    row = await db.get(PlatformSetting, key)
    if row is None:
        return default
    value = decrypt_value(row.value)
    with _cache_lock:
        _cache[key] = (value, time.monotonic())
    return value


async def get_typed_setting(db: AsyncSession, key: str, default: Any = None) -> Any:
    """مقدار با نوع درست: localized/json → dict/list/None، بقیه → str."""
    raw = await get_setting(db, key)
    if raw is None:
        return default
    meta = SETTING_DEFS.get(key, {})
    if meta.get("type") in ("localized", "json"):
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


# ---------------------------------------------------------------------------
# اعتبارسنج‌های کلیدهای json (میل‌استون polish) — مستندات کامل در
# docs/settings-schema.md. هر اعتبارسنج، مقدار canonical را برمی‌گرداند.
# ---------------------------------------------------------------------------

# نام‌های ۱۰ واریانت بخش‌های خانه (مدل‌های seed_home_sections در seed.py).
# home.sections هر رشتهٔ غیرخالی را به‌عنوان variant می‌پذیرد تا Track C
# بدون migration بک‌اند واریانت جدید اضافه کند؛ این فهرست فقط مستندسازی است.
HOME_SECTION_VARIANTS = (
    "hero",
    "live_status",
    "latest_fatwas",
    "quran_of_day",
    "suggested_lessons",
    "fresh_library",
    "community",
    "nearby_map",
    "donation_banner",
    "footer",
)

_PARTICLES_DEFAULTS = {
    "enabled": True,
    "count": 100,
    "speed": 1.0,
    "parallax": 1.0,
    "lines": True,
}


def _validate_particles(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValueError("particles must be an object")
    unknown = set(value) - set(_PARTICLES_DEFAULTS)
    if unknown:
        raise ValueError(f"particles: unknown fields {sorted(unknown)}")
    out = dict(_PARTICLES_DEFAULTS)
    for k, v in value.items():
        if k in ("enabled", "lines"):
            if not isinstance(v, bool):
                raise ValueError(f"particles.{k} must be a boolean")
        elif k == "count":
            if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 1000:
                raise ValueError("particles.count must be an int in 0..1000")
        elif k in ("speed", "parallax"):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
                raise ValueError(f"particles.{k} must be a non-negative number")
        out[k] = float(v) if k in ("speed", "parallax") else v
    return out


def _validate_font(value: Any) -> dict | None:
    """فونت سفارشی هر لوکیل: {family, url} یا null (استفاده از فونت داخلی)."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("font must be an object or null")
    unknown = set(value) - {"family", "url"}
    if unknown:
        raise ValueError(f"font: unknown fields {sorted(unknown)}")
    family = value.get("family")
    url = value.get("url")
    if not isinstance(family, str) or not family.strip():
        raise ValueError("font.family must be a non-empty string")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("font.url must be a non-empty string")
    return {"family": family.strip(), "url": url.strip()}


def _validate_home_sections(value: Any) -> list:
    if not isinstance(value, list):
        raise ValueError("home.sections must be an array")
    seen: set[str] = set()
    out = []
    for i, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"home.sections[{i}] must be an object")
        sid = item.get("id")
        variant = item.get("variant")
        enabled = item.get("enabled", True)
        if not isinstance(sid, str) or not sid.strip():
            raise ValueError(f"home.sections[{i}].id must be a non-empty string")
        if not isinstance(variant, str) or not variant.strip():
            raise ValueError(f"home.sections[{i}].variant must be a non-empty string")
        if not isinstance(enabled, bool):
            raise ValueError(f"home.sections[{i}].enabled must be a boolean")
        sid = sid.strip()
        if sid in seen:
            raise ValueError(f"home.sections: duplicate id '{sid}'")
        seen.add(sid)
        out.append({"id": sid, "variant": variant.strip(), "enabled": enabled})
    return out


def _validate_cta(cta: Any, where: str) -> dict | None:
    if cta is None:
        return None
    if not isinstance(cta, dict):
        raise ValueError(f"{where} must be an object or null")
    unknown = set(cta) - {"label", "href"}
    if unknown:
        raise ValueError(f"{where}: unknown fields {sorted(unknown)}")
    label = cta.get("label", "")
    href = cta.get("href", "")
    if not isinstance(label, str) or not isinstance(href, str):
        raise ValueError(f"{where}.label/.href must be strings")
    return {"label": label, "href": href}


def _validate_hero(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValueError("hero must be an object")
    unknown = set(value) - {"title", "subtitle", "primary_cta", "secondary_cta"}
    if unknown:
        raise ValueError(f"hero: unknown fields {sorted(unknown)}")
    title = value.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("hero.title must be a non-empty string")
    subtitle = value.get("subtitle", "")
    if not isinstance(subtitle, str):
        raise ValueError("hero.subtitle must be a string")
    return {
        "title": title.strip(),
        "subtitle": subtitle,
        "primary_cta": _validate_cta(value.get("primary_cta"), "hero.primary_cta"),
        "secondary_cta": _validate_cta(value.get("secondary_cta"), "hero.secondary_cta"),
    }


def _validate_json_setting(key: str, value: Any) -> Any:
    """اعتبارسنج اختصاصی هر کلید json — خروجی canonical."""
    if key == "particles":
        return _validate_particles(value)
    if key in ("fonts.fa", "fonts.ar", "fonts.en"):
        return _validate_font(value)
    if key == "home.sections":
        return _validate_home_sections(value)
    if key in ("hero.fa", "hero.ar", "hero.en"):
        return _validate_hero(value)
    # کلید json آینده بدون اعتبارسنج اختصاصی: فقط JSON-serializable بودن
    json.dumps(value)
    return value


def encode_setting_value(setting_type: str, value: Any, key: str | None = None) -> str:
    """اعتبارسنجی + تبدیل مقدار ورودی API به رشتهٔ قابل رمزنگاری.

    برای نوع json، اعتبارسنج‌های اختصاصی هر کلید (میل‌استون polish) اعمال
    می‌شود؛ خروجی همیشه canonical JSON است.
    """
    if setting_type == "json":
        canonical = _validate_json_setting(key or "", value)
        return json.dumps(canonical, ensure_ascii=False)
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
    if setting_type in ("localized", "json"):
        return json.loads(plaintext)
    return plaintext


def is_sensitive(key: str) -> bool:
    return bool(SETTING_DEFS.get(key, {}).get("sensitive"))
