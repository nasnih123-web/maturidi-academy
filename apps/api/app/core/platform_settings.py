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
import re
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
    # --- فاز ۱۱ (Track 1): تلگرام دوطرفه + ویجت‌ها (ADR-0008) ---
    "telegram.enabled": {"type": "json", "sensitive": False, "label": "فعال‌بودن بات تلگرام"},
    "telegram.webhook_secret": {"type": "secret", "sensitive": True, "label": "رمز وبهوک تلگرام (هدر X-Telegram-Bot-Api-Secret-Token)"},
    "telegram.api_id": {"type": "secret", "sensitive": True, "label": "api_id تلگرام (Telethon — اتصال حساب از CRM)"},
    "telegram.api_hash": {"type": "secret", "sensitive": True, "label": "api_hash تلگرام (Telethon — اتصال حساب از CRM)"},
    "telegram.session": {"type": "secret", "sensitive": True, "label": "session رمزنگاری‌شدهٔ Telethon (§۳ — هرگز لاگ نمی‌شود)"},
    "telegram.phone_masked": {"type": "string", "sensitive": False, "label": "شمارهٔ ماسک‌شدهٔ حساب تلگرام"},
    "telegram.pending_phone": {"type": "secret", "sensitive": True, "label": "شمارهٔ در انتظار تأیید کد (داخلی)"},
    "telegram.pending_phone_code_hash": {"type": "secret", "sensitive": True, "label": "هش کد ورود تلگرام (داخلی)"},
    "telegram.pending_expires_at": {"type": "string", "sensitive": False, "label": "انقضای کد ورود (ISO8601 — داخلی)"},
    "telegram.pending_session": {"type": "secret", "sensitive": True, "label": "نشست پیش‌ازورود تلگرام (داخلی — تأیید کد باید با همان اتصال انجام شود)"},
    "payment.zarinpal_key": {"type": "secret", "sensitive": True, "label": "کلید زرین‌پال"},
    "payment.idpay_key": {"type": "secret", "sensitive": True, "label": "کلید آیدی‌پی"},
    # --- فاز ۱۵: مالی و درگاه پرداخت (ADR-0013) ---
    "payment.zarinpal_sandbox": {"type": "json", "sensitive": False, "label": "حالت سندباکس زرین‌پال (پیش‌فرض: روشن)"},
    "payment.webhook_secret": {"type": "secret", "sensitive": True, "label": "رمز امضای وبهوک درگاه (HMAC)"},
    "payment.callback_url": {"type": "string", "sensitive": False, "label": "آدرس بازگشت پیش‌فرض درگاه (callback)"},
    "map.key": {"type": "secret", "sensitive": True, "label": "کلید نقشه"},
    # --- maps phase (overnight/w10): CRM control of the public map popup.
    # Shape: {"show_image": bool, "show_description": bool,
    #         "show_type": bool, "show_city": bool}; all default true.
    "places.popup": {"type": "json", "sensitive": False, "label": "شکل پاپ‌آپ نقشهٔ اماکن"},
    # --- globe phase: CRM-extensible place types + default globe view.
    # places.types: [{"key", "emoji", "fa", "ar", "en"}]; validated at write
    # time (see _validate_json_setting). places.globe: {defaultLat,
    # defaultLng, defaultAltitude, defaultMode, autoRotate}.
    "places.types": {"type": "json", "sensitive": False, "label": "انواع مکان (کرهٔ سه‌بعدی)"},
    "places.globe": {"type": "json", "sensitive": False, "label": "نمای پیش‌فرض کرهٔ سه‌بعدی"},
    "email.smtp_password": {"type": "secret", "sensitive": True, "label": "رمز SMTP ایمیل"},
    "sms.api_key": {"type": "secret", "sensitive": True, "label": "کلید API پیامک"},
    # --- فاز ۱۴: هوش تجاری ---
    "bi.metabase_url": {"type": "string", "sensitive": False, "label": "آدرس Metabase (داشبوردهای BI)"},
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
    # --- فاز ۵ (Track 1): قرآن / مناجات ---
    "quran.provider": {"type": "json", "sensitive": False, "label": "provider فعال متن قرآن"},
    "quran.translations": {"type": "json", "sensitive": False, "label": "ترجمه‌های فعال (ترتیب نمایش)"},
    "quran.tafsirs": {"type": "json", "sensitive": False, "label": "تفسیرهای فعال (ترتیب نمایش)"},
    "quran.reciters": {"type": "json", "sensitive": False, "label": "قاری‌های فعال"},
    "quran.active_languages": {"type": "json", "sensitive": False, "label": "زبان‌های فعال قرآن"},
    "quran.show_translation": {"type": "json", "sensitive": False, "label": "نمایش ترجمه"},
    "quran.show_tafsir": {"type": "json", "sensitive": False, "label": "نمایش تفسیر"},
    "quran.highlight_mode": {"type": "json", "sensitive": False, "label": "حالت هایلایت (word|ayah|off)"},
    "quran.font_size": {"type": "json", "sensitive": False, "label": "اندازهٔ پایهٔ فونت قرآن"},
    "quran.playback": {"type": "json", "sensitive": False, "label": "رفتار پخش صوت"},
    # --- فاز قرآن ۱: مذهب پیش‌فرض نمایش + پیش‌فرض‌های پخش‌کننده ---
    "quran.madhhab_default": {"type": "json", "sensitive": False, "label": "مذهب پیش‌فرض نمایش قرآن"},
    "quran.player_default_speed": {"type": "json", "sensitive": False, "label": "سرعت پیش‌فرض پخش قرآن"},
    "quran.player_show_photo": {"type": "json", "sensitive": False, "label": "نمایش عکس قاری در پخش‌کننده"},
    # --- اصلاحیهٔ صفحهٔ قرآن: سبک موج پخش‌کننده (قابل‌تغییر از CRM) ---
    "quran.waveform_style": {"type": "json", "sensitive": False, "label": "سبک موج پخش‌کنندهٔ قرآن"},
    "munajat.enabled": {"type": "json", "sensitive": False, "label": "فعال‌بودن مناجات شبانه"},
    "munajat.window": {"type": "json", "sensitive": False, "label": "پنجرهٔ زمانی مناجات"},
    "adhan.defaults": {"type": "json", "sensitive": False, "label": "پیش‌فرض محاسبهٔ اذان (روش + مذهب)"},
    # --- فاز ۶: موتور فتوای هوشمند ---
    "ai.provider": {"type": "json", "sensitive": False, "label": "provider فعال LLM (none|claude)"},
    "ai.claude_model": {"type": "json", "sensitive": False, "label": "مدل Claude"},
    "ai.claude_api_key": {"type": "secret", "sensitive": True, "label": "کلید API کلاد (هرگز لاگ نمی‌شود)"},
    "ai.daily_quota_per_user": {"type": "json", "sensitive": False, "label": "سقف روزانهٔ AI به‌ازای کاربر"},
    "ai.rate_per_minute": {"type": "json", "sensitive": False, "label": "سقف درخواست AI در دقیقه"},
    "ai.external_research_enabled": {"type": "json", "sensitive": False, "label": "تحقیق خارجی (§۹.۶ — پیش‌فرض خاموش)"},
    "ai.stream_timeout_s": {"type": "json", "sensitive": False, "label": "timeout استریم/تولید AI (ثانیه)"},
    "ai.embedding_provider": {"type": "json", "sensitive": False, "label": "provider embedding ‏(hash|external_api|local_model)"},
    "ai.embedding_endpoint": {"type": "json", "sensitive": False, "label": "endpoint سرویس embedding خارجی"},
    "ai.embedding_api_key": {"type": "secret", "sensitive": True, "label": "کلید سرویس embedding خارجی"},
    "ai.embedding_model": {"type": "json", "sensitive": False, "label": "نام مدل embedding خارجی"},
    # --- TTS ابری (C-03 — ADR-0030): provider واقعی OpenAI-shaped ---
    "voice.tts_cloud_endpoint": {"type": "string", "sensitive": False, "label": "endpoint سرویس TTS ابری (مسیر کامل speech)"},
    "voice.tts_cloud_api_key": {"type": "secret", "sensitive": True, "label": "کلید API سرویس TTS ابری"},
    "voice.tts_cloud_model": {"type": "string", "sensitive": False, "label": "نام مدل TTS ابری (مثل tts-1)"},
    # --- بیلدها (C-05): شناسهٔ پروژهٔ Expo که مالک پس از eas init ثبت می‌کند ---
    "builds.expo_project_id": {"type": "string", "sensitive": False, "label": "شناسهٔ پروژهٔ Expo (easProjectId)"},
    # --- فاز ۱۳ (Track 1): پوش — FCM برای موبایل، web_push جدا برای وب (ADR-0010) ---
    # staged و خالی: فقط در رجیستری ثبت‌اند؛ هیچ مقداری seed/hardcode نمی‌شود (§۱۵.۳).
    "push.fcm_server_key": {"type": "secret", "sensitive": True, "label": "کلید سرور FCM (پوش موبایل)"},
    "push.vapid_public_key": {"type": "string", "sensitive": False, "label": "کلید عمومی VAPID (web push)"},
    "push.vapid_private_key": {"type": "secret", "sensitive": True, "label": "کلید خصوصی VAPID (web push)"},
}

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
        entry = _cache.get(key)
    if entry is not None:
        value, stored_at = entry
        if time.monotonic() - stored_at <= SETTINGS_CACHE_TTL:
            return value
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
        elif k in ("speed", "parallax") and (
            not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0
        ):
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


# --- فاز ۵ (Track 1): اعتبارسنج‌های کلیدهای قرآن / مناجات ---

_QURAN_PROVIDERS = ("alquran_cloud",)


def _validate_quran_provider(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("quran.provider must be a non-empty string")
    pid = value.strip()
    if pid not in _QURAN_PROVIDERS:
        raise ValueError(f"quran.provider: unknown provider '{pid}'")
    return pid


def _validate_edition_list(key: str, value: Any) -> list:
    if not isinstance(value, list):
        raise ValueError(f"{key} must be an array")
    out = []
    for i, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{key}[{i}] must be a non-empty string")
        if item.strip() in out:
            raise ValueError(f"{key}: duplicate '{item.strip()}'")
        out.append(item.strip())
    return out


def _validate_active_languages(value: Any) -> list:
    langs = _validate_edition_list("quran.active_languages", value)
    allowed = {"fa", "ar", "en"}
    for lang in langs:
        if lang not in allowed:
            raise ValueError(f"quran.active_languages: unsupported language '{lang}'")
    if not langs:
        raise ValueError("quran.active_languages must not be empty")
    return langs


def _validate_flag(key: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value


def _validate_highlight_mode(value: Any) -> str:
    if value not in ("word", "ayah", "off"):
        raise ValueError("quran.highlight_mode must be one of word|ayah|off")
    return value


def _validate_font_size(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("quran.font_size must be a number")
    if not 12 <= value <= 72:
        raise ValueError("quran.font_size must be between 12 and 72")
    return float(value)


def _validate_playback(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValueError("quran.playback must be an object")
    unknown = set(value) - {"autoplay", "repeat"}
    if unknown:
        raise ValueError(f"quran.playback: unknown fields {sorted(unknown)}")
    autoplay = value.get("autoplay", False)
    repeat = value.get("repeat", "off")
    if not isinstance(autoplay, bool):
        raise ValueError("quran.playback.autoplay must be a boolean")
    if repeat not in ("off", "ayah", "surah"):
        raise ValueError("quran.playback.repeat must be one of off|ayah|surah")
    return {"autoplay": autoplay, "repeat": repeat}


# --- فاز قرآن ۱: مذهب پیش‌فرض نمایش + پیش‌فرض‌های پخش‌کننده ---

_QURAN_MADHHABS = ("hanafi", "shafii", "maliki", "hanbali")


def _validate_madhhab_default(value: Any) -> str:
    if value not in _QURAN_MADHHABS:
        raise ValueError(
            f"quran.madhhab_default must be one of {'|'.join(_QURAN_MADHHABS)}"
        )
    return value


def _validate_player_speed(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        # TRY004: wrong-typed values raise TypeError; the settings PUT path
        # maps both ValueError and TypeError to the same client 400.
        raise TypeError("quran.player_default_speed must be a number")
    if not 0.5 <= value <= 2:
        raise ValueError("quran.player_default_speed must be between 0.5 and 2")
    return float(value)


_WAVEFORM_STYLES = ("bars", "dotted", "line", "mirrored", "neon")


def _validate_waveform_style(value: Any) -> str:
    if value not in _WAVEFORM_STYLES:
        raise ValueError(
            f"quran.waveform_style must be one of {'|'.join(_WAVEFORM_STYLES)}"
        )
    return value


_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_munajat_window(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValueError("munajat.window must be an object")
    unknown = set(value) - {"start", "end"}
    if unknown:
        raise ValueError(f"munajat.window: unknown fields {sorted(unknown)}")
    out = {}
    for side in ("start", "end"):
        v = value.get(side)
        if not isinstance(v, str) or not _HHMM.match(v):
            raise ValueError(f"munajat.window.{side} must be HH:MM (00:00–23:59)")
        out[side] = v
    return out


_ADHAN_METHODS = ("council", "tehran", "isna", "mwl", "egypt", "karachi", "makkah", "qom", "jafari", "france")
_ADHAN_MADHABS = ("shafi", "hanafi")


def _validate_adhan_defaults(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValueError("adhan.defaults must be an object")
    # LEGACY TOLERANCE: old stored dicts may still carry `default_city` — it
    # is simply ignored here (never an error, never written back). There is
    # NO default city anymore; fresh values carry method + madhab only.
    unknown = set(value) - {"calculation_method", "madhab", "default_city"}
    if unknown:
        raise ValueError(f"adhan.defaults: unknown fields {sorted(unknown)}")
    method = value.get("calculation_method", "council")
    madhab = value.get("madhab", "hanafi")
    if method not in _ADHAN_METHODS:
        raise ValueError(
            f"adhan.defaults.calculation_method must be one of {'|'.join(_ADHAN_METHODS)}"
        )
    if madhab not in _ADHAN_MADHABS:
        raise ValueError("adhan.defaults.madhab must be one of shafi|hanafi")
    return {"calculation_method": method, "madhab": madhab}


# --- Globe phase: CRM-extensible place types + default globe view --------
# Validators return the canonical value; the places service re-parses with
# parse_place_types (defensive) so a stored value can never break reads.

def _validate_place_types(value: Any) -> list:
    if not isinstance(value, list):
        raise TypeError("places.types must be a list")
    if not value:
        raise ValueError("places.types must be a non-empty list")
    out: list[dict] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, dict):
            raise TypeError("places.types entries must be objects")
        key = raw.get("key")
        if not isinstance(key, str) or not key.strip() or len(key) > 32:
            raise ValueError("places.types entry needs a non-empty key (<=32 chars)")
        key = key.strip()
        if key in seen:
            continue
        seen.add(key)
        unknown = set(raw) - {"key", "emoji", "fa", "ar", "en"}
        if unknown:
            raise ValueError(f"places.types entry: unknown fields {sorted(unknown)}")
        emoji = raw.get("emoji")
        out.append({
            "key": key,
            "emoji": emoji if isinstance(emoji, str) and emoji.strip() else "📍",
            "fa": raw.get("fa") if isinstance(raw.get("fa"), str) and raw.get("fa") else key,
            "ar": raw.get("ar") if isinstance(raw.get("ar"), str) and raw.get("ar") else key,
            "en": raw.get("en") if isinstance(raw.get("en"), str) and raw.get("en") else key,
        })
    if not out:
        raise ValueError("places.types must contain at least one type")
    return out


_GLOBE_MODES = ("satellite", "simple", "dark", "topology")


def _validate_globe(value: Any) -> dict:
    if not isinstance(value, dict):
        raise TypeError("places.globe must be an object")
    unknown = set(value) - {
        "defaultLat", "defaultLng", "defaultAltitude", "defaultMode", "autoRotate",
    }
    if unknown:
        raise ValueError(f"places.globe: unknown fields {sorted(unknown)}")
    out = {
        "defaultLat": 21.4225,
        "defaultLng": 39.8262,
        "defaultAltitude": 2.5,
        "defaultMode": "satellite",
        "autoRotate": False,
    }
    lat = value.get("defaultLat")
    if lat is not None:
        if isinstance(lat, bool) or not isinstance(lat, (int, float)):
            raise TypeError("places.globe.defaultLat must be a number")
        if not -90 <= lat <= 90:
            raise ValueError("places.globe.defaultLat must be in -90..90")
        out["defaultLat"] = float(lat)
    lng = value.get("defaultLng")
    if lng is not None:
        if isinstance(lng, bool) or not isinstance(lng, (int, float)):
            raise TypeError("places.globe.defaultLng must be a number")
        if not -180 <= lng <= 180:
            raise ValueError("places.globe.defaultLng must be in -180..180")
        out["defaultLng"] = float(lng)
    alt = value.get("defaultAltitude")
    if alt is not None:
        if isinstance(alt, bool) or not isinstance(alt, (int, float)):
            raise TypeError("places.globe.defaultAltitude must be a number")
        if not 0.1 <= alt <= 10:
            raise ValueError("places.globe.defaultAltitude must be in 0.1..10")
        out["defaultAltitude"] = float(alt)
    mode = value.get("defaultMode")
    if mode is not None:
        if mode not in _GLOBE_MODES:
            raise ValueError(f"places.globe.defaultMode must be one of {'|'.join(_GLOBE_MODES)}")
        out["defaultMode"] = mode
    rot = value.get("autoRotate")
    if rot is not None:
        if not isinstance(rot, bool):
            raise TypeError("places.globe.autoRotate must be a boolean")
        out["autoRotate"] = rot
    return out


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
    # --- فاز ۵: قرآن / مناجات ---
    if key == "quran.provider":
        return _validate_quran_provider(value)
    if key in ("quran.translations", "quran.tafsirs", "quran.reciters"):
        return _validate_edition_list(key, value)
    if key == "quran.active_languages":
        return _validate_active_languages(value)
    if key in ("quran.show_translation", "quran.show_tafsir", "munajat.enabled"):
        return _validate_flag(key, value)
    if key == "quran.highlight_mode":
        return _validate_highlight_mode(value)
    if key == "quran.font_size":
        return _validate_font_size(value)
    if key == "quran.playback":
        return _validate_playback(value)
    if key == "quran.madhhab_default":
        return _validate_madhhab_default(value)
    if key == "quran.player_default_speed":
        return _validate_player_speed(value)
    if key == "quran.player_show_photo":
        return _validate_flag(key, value)
    if key == "quran.waveform_style":
        return _validate_waveform_style(value)
    if key == "munajat.window":
        return _validate_munajat_window(value)
    if key == "adhan.defaults":
        return _validate_adhan_defaults(value)
    # --- Globe phase: place types + default globe view ---
    if key == "places.types":
        return _validate_place_types(value)
    if key == "places.globe":
        return _validate_globe(value)
    # --- فاز ۶: تنظیمات AI ---
    if key == "ai.provider":
        if value not in ("none", "claude"):
            raise ValueError("ai.provider must be one of none|claude")
        return value
    if key == "ai.claude_model":
        if not isinstance(value, str) or not value.strip():
            raise ValueError("ai.claude_model must be a non-empty string")
        return value.strip()
    if key in ("ai.daily_quota_per_user", "ai.rate_per_minute",
               "ai.stream_timeout_s"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{key} must be a number")
        bounds = {
            "ai.daily_quota_per_user": (1, 10000),
            "ai.rate_per_minute": (1, 600),
            "ai.stream_timeout_s": (5, 600),
        }[key]
        if not bounds[0] <= value <= bounds[1]:
            raise ValueError(f"{key} must be between {bounds[0]} and {bounds[1]}")
        return int(value)
    if key == "ai.external_research_enabled":
        return _validate_flag(key, value)
    # --- فاز ۱۱: تلگرام ---
    if key == "telegram.enabled":
        return _validate_flag(key, value)
    if key == "ai.embedding_provider":
        if value not in ("hash", "external_api", "local_model"):
            raise ValueError(
                "ai.embedding_provider must be one of hash|external_api|local_model"
            )
        return value
    if key in ("ai.embedding_endpoint", "ai.embedding_model"):
        if value is not None and not isinstance(value, str):
            raise ValueError(f"{key} must be a string or null")
        return value
    # کلید json آینده بدون اعتبارسنج اختصاصی: فقط JSON-serializable بودن
    json.dumps(value)
    return value


def encode_setting_value(setting_type: str, value: Any, key: str | None = None) -> str:
    """اعتبارسنجی + تبدیل مقدار ورودی API به رشتهٔ قابل رمزنگاری.

    برای نوع json، اعتبارسنج‌های اختصاصی هر کلید (میل‌استون polish) اعمال
    می‌شود؛ خروجی همیشه canonical JSON است.
    رشته‌های JSON نیز پذیرفته می‌شوند (برای سازگاری با کلاینت‌هایی که
    مقدار را stringify می‌کنند) — در صورت نامعتبر بودن، رشتهٔ خام به
    اعتبارسنج اختصاصی سپرده می‌شود.
    """
    if setting_type == "json":
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (json.JSONDecodeError, ValueError):
                pass  # رشتهٔ خام؛ اعتبارسنج اختصاصی تصمیم می‌گیرد
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
