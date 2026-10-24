"""تبدیل متن به گفتار (TTS) — فاز ۱۲.

انتزاع provider: اگر هیچ providerای پیکربندی نشده باشد، سرویس به‌جای بایت
صوتی جعلی، متن را با `audio_kind="none"` و اعلان صادقانه برمی‌گرداند
(قرارداد §۱۵.۹ — هرگز سکوت، هرگز بایت جعلی).
"""
from __future__ import annotations

import importlib.util
import logging
from typing import Protocol

import httpx

from app.core.errors import APIError

from .intents import SUPPORTED_LANGS

logger = logging.getLogger("app.voice.tts")


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


def _make_client() -> httpx.AsyncClient:
    """httpx factory — در تست‌ها با MockTransport جایگزین می‌شود."""
    return httpx.AsyncClient(timeout=30.0)


class CloudTTS:
    """TTS ابریِ واقعی (C-03 — ADR-0030): API با شکل OpenAI.

    POST به endpoint پیکربندی‌شده (`voice.tts_cloud_endpoint` — مسیر
    کامل، مثل https://api.openai.com/v1/audio/speech) با بدنهٔ
    {model, input, voice, response_format} و کلید از تنظیمات رمزنگاری‌شده
    (`voice.tts_cloud_api_key`). پاسخِ موفق = بایت‌های صوت خام. هر خطای
    بالادستی (شبکه/وضعیت) به tts_unavailable نگاشت می‌شود تا لایهٔ
    سرویس صادقانه به متن degrade کند — هرگز بایت جعلی ساخته نمی‌شود.
    """

    name = "cloud"

    def __init__(self, endpoint: str = "", api_key: str = "", model: str = "tts-1"):
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model or "tts-1"

    @property
    def configured(self) -> bool:
        return bool(self.endpoint)

    async def synthesize(self, text: str, *, lang: str, voice: str) -> dict:
        if not self.configured:
            raise APIError(
                503, "tts_unavailable",
                "سرویس TTS ابری پیکربندی نشده است",
                {"provider": self.name, "hint": "voice.tts_cloud_endpoint را در CRM ثبت کنید"},
            )
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        payload = {
            "model": self.model,
            "input": text,
            "voice": voice,
            "response_format": "mp3",
        }
        try:
            async with _make_client() as client:
                resp = await client.post(self.endpoint, json=payload, headers=headers)
                resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "cloud TTS upstream error: status=%s", exc.response.status_code
            )
            raise APIError(
                503, "tts_unavailable",
                "سرویس TTS ابری خطا برگرداند",
                {"provider": self.name, "upstream_status": exc.response.status_code},
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning("cloud TTS network error: %s", type(exc).__name__)
            raise APIError(
                503, "tts_unavailable",
                "سرویس TTS ابری در دسترس نیست",
                {"provider": self.name},
            ) from exc
        mime = (resp.headers.get("content-type") or "audio/mpeg").split(";")[0].strip()
        return {"audio_bytes": resp.content, "mime": mime or "audio/mpeg"}


def get_tts_provider(
    configured: str,
    *,
    cloud_endpoint: str = "",
    cloud_api_key: str = "",
    cloud_model: str = "tts-1",
) -> TTSProvider | None:
    """None یعنی هیچ TTSای در دسترس نیست (degradation صادقانه در سرویس)."""
    if configured == "none":
        return None
    if configured == "coqui":
        return CoquiTTS() if _coqui_available() else None
    if configured == "cloud":
        cloud = CloudTTS(endpoint=cloud_endpoint, api_key=cloud_api_key, model=cloud_model)
        return cloud if cloud.configured else None
    # auto
    if _coqui_available():
        return CoquiTTS()
    cloud = CloudTTS(endpoint=cloud_endpoint, api_key=cloud_api_key, model=cloud_model)
    return cloud if cloud.configured else None


async def synthesize_or_degrade(
    text: str,
    *,
    lang: str,
    voice: str,
    configured_provider: str,
    cloud_endpoint: str = "",
    cloud_api_key: str = "",
    cloud_model: str = "tts-1",
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
        configured_provider,
        cloud_endpoint=cloud_endpoint,
        cloud_api_key=cloud_api_key,
        cloud_model=cloud_model,
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
