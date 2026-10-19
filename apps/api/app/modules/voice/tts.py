"""تبدیل متن به گفتار (TTS) — فاز ۱۲.

انتزاع provider: اگر هیچ providerای پیکربندی نشده باشد، سرویس به‌جای بایت
صوتی جعلی، متن را با `audio_kind="none"` و اعلان صادقانه برمی‌گرداند
(قرارداد §۱۵.۹ — هرگز سکوت، هرگز بایت جعلی).
"""
from __future__ import annotations

import importlib.util
from typing import Protocol

from app.core.errors import APIError
from .intents import SUPPORTED_LANGS


class TTSProvider(Protocol):
    name: str

    async def synthesize(self, text: str, *, lang: str, voice: str) -> dict:
        """-> {"audio_bytes": bytes, "mime": str}"""
        ...


def _coqui_available() -> bool:
    return importlib.util.find_spec("TTS") is not None


class CoquiTTS:
    """TTS محلی (Coqui) — فقط وقتی پکیج نصب باشد."""

    name = "coqui"
    _tts = None

    async def synthesize(self, text: str, *, lang: str, voice: str) -> dict:
        raise APIError(
            503, "tts_unavailable",
            "موتور TTS محلی در دسترس نیست",
            {"provider": self.name},
        )


class CloudTTS:
    """TTS ابری — stub پشت تنظیمات؛ بدون endpoint پیکربندی‌شده → ناموجود."""

    name = "cloud"

    def __init__(self, endpoint: str = "", api_key: str = ""):
        self.endpoint = endpoint
        self.api_key = api_key

    @property
    def configured(self) -> bool:
        return bool(self.endpoint)

    async def synthesize(self, text: str, *, lang: str, voice: str) -> dict:
        # نقطهٔ اتصال provider ابری اینجاست؛ تا وقتی endpoint در
        # platform_settings ثبت نشده، صادقانه ناموجود اعلام می‌شود.
        raise APIError(
            503, "tts_unavailable",
            "سرویس TTS ابری پیکربندی نشده است",
            {"provider": self.name, "hint": "voice.tts_cloud_endpoint را در CRM ثبت کنید"},
        )


def get_tts_provider(
    configured: str, *, cloud_endpoint: str = "", cloud_api_key: str = ""
) -> TTSProvider | None:
    """None یعنی هیچ TTSای در دسترس نیست (degradation صادقانه در سرویس)."""
    if configured == "none":
        return None
    if configured == "coqui":
        return CoquiTTS() if _coqui_available() else None
    if configured == "cloud":
        cloud = CloudTTS(endpoint=cloud_endpoint, api_key=cloud_api_key)
        return cloud if cloud.configured else None
    # auto
    if _coqui_available():
        return CoquiTTS()
    cloud = CloudTTS(endpoint=cloud_endpoint, api_key=cloud_api_key)
    return cloud if cloud.configured else None


async def synthesize_or_degrade(
    text: str,
    *,
    lang: str,
    voice: str,
    configured_provider: str,
    cloud_endpoint: str = "",
    cloud_api_key: str = "",
) -> tuple[bytes | None, str | None, str | None]:
    """-> (audio_bytes|None, mime|None, notice_code|None).

    notice_code همیشه یکی از کدهای پیام است؛ هرگز exception برای «پیکربندی‌نشده»
    بالا نمی‌آید تا پاسخ متنی از دست نرود.
    """
    if lang not in SUPPORTED_LANGS:
        raise APIError(
            400, "unsupported_language",
            "فقط فارسی و عربی پشتیبانی می‌شوند",
            {"lang": lang},
        )
    provider = get_tts_provider(
        configured_provider, cloud_endpoint=cloud_endpoint, cloud_api_key=cloud_api_key
    )
    if provider is None:
        return None, None, "tts_unavailable"
    try:
        out = await provider.synthesize(text, lang=lang, voice=voice)
    except APIError as exc:
        if exc.code == "tts_unavailable":
            return None, None, "tts_unavailable"
        raise
    return out["audio_bytes"], out["mime"], None
