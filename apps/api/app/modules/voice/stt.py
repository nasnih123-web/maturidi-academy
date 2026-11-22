"""رونویسی گفتار (STT) — فاز ۱۲.

انتزاع provider: اگر faster-whisper نصب و مدل در دسترس باشد، رونویسی واقعی؛
در غیر این صورت خطای صادقانهٔ `stt_unavailable` — هرگز رونویسی جعلی
(قرارداد §۱۵.۹).
"""
from __future__ import annotations

import asyncio
import importlib.util
import threading
import time
from typing import Protocol

from app.core.errors import APIError

from .intents import SUPPORTED_LANGS

STT_TIMEOUT_S = 60


def faster_whisper_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def _decode_audio(audio_bytes: bytes):
    """دیکود صدا با PyAV به آرایهٔ float32 (۱۶kHz، مونو) برای whisper.

    چرا خودمان دیکود می‌کنیم؟ دیکود داخلی faster-whisper 1.2.1 به
    av.open آرگومان metadata_errors می‌دهد که در PyAV ≥13 حذف شده و
    av در requirements پین نشده است (production روی av 19 است)؛ پس
    رونویسی از مسیر داخلی whisper همیشه با TypeError می‌مرد. وقتی
    ورودی مدل ndarray باشد، whisper مسیر دیکود داخلی‌اش را رد می‌کند
    و مستقیم رونویسی می‌کند.
    """
    import io

    import av
    import numpy as np

    chunks: list = []
    with av.open(io.BytesIO(audio_bytes), mode="r") as container:
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        for frame in container.decode(stream):
            for out_frame in resampler.resample(frame):
                chunks.append(out_frame.to_ndarray().reshape(-1))
        for out_frame in resampler.resample(None):
            chunks.append(out_frame.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32)


class STTProvider(Protocol):
    name: str

    async def transcribe(
        self, audio_bytes: bytes, *, lang: str | None, timeout_s: float | None = None
    ) -> dict:
        """-> {"text": str, "language": str, "duration_s": float}"""
        ...


class FasterWhisperSTT:
    """رونویسی واقعی با faster-whisper (lazy-load مدل، thread جدا).

    مدل پیش‌فرض = مدل نام‌دار و پین‌شدهٔ B-04 در app/core/media_tools.py
    (FASTER_WHISPER_MODEL) — یک منبع حقیقت برای صدا و کتابخانه.
    """

    name = "faster_whisper"
    _model = None
    _lock = threading.Lock()

    def __init__(self, model_size: str | None = None, device: str = "cpu"):
        from app.core.media_tools import FASTER_WHISPER_MODEL

        self.model_size = model_size or FASTER_WHISPER_MODEL
        self.device = device

    def _get_model(self):
        with self._lock:
            if FasterWhisperSTT._model is None:
                from faster_whisper import WhisperModel

                FasterWhisperSTT._model = WhisperModel(
                    self.model_size, device=self.device, compute_type="int8"
                )
            return FasterWhisperSTT._model

    async def transcribe(
        self,
        audio_bytes: bytes,
        *,
        lang: str | None,
        timeout_s: float | None = None,
    ) -> dict:
        def _run() -> dict:
            model = self._get_model()
            segments, info = model.transcribe(
                _decode_audio(audio_bytes),
                language=lang,  # None → تشخیص خودکار whisper
                vad_filter=True,
            )
            parts: list[str] = []
            end = 0.0
            for seg in segments:
                parts.append(seg.text)
                end = max(end, float(seg.end))
            return {
                "text": " ".join(parts).strip(),
                "language": info.language,
                "duration_s": round(end or float(info.duration or 0.0), 2),
            }

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_run), timeout=timeout_s or STT_TIMEOUT_S
            )
        except TimeoutError:
            raise APIError(
                503, "stt_timeout",
                "رونویسی بیش از حد طول کشید؛ لطفاً فایل کوتاه‌تری بفرستید",
                {"timeout_s": timeout_s or STT_TIMEOUT_S},
            )
        except APIError:
            raise
        except Exception as exc:  # مدل/باینری خراب یا ناموجود → صادقانه
            raise APIError(
                503, "stt_unavailable",
                "سرویس رونویسی گفتار در دسترس نیست",
                {"reason": type(exc).__name__},
            )

    async def transcribe_segments(
        self,
        audio_bytes: bytes,
        *,
        lang: str | None = None,
        task: str = "transcribe",
        timeout_s: float | None = None,
    ) -> dict:
        """رونویسی با سگمنت‌های زمان‌دار — برای زیرنویس WebVTT (فاز ۳ ویدیوها).

        task="translate" خروجی انگلیسی whisper است (ترجمهٔ داخلی خود مدل).
        -> {"segments": [{"start","end","text"}], "language", "duration_s"}
        """
        def _run() -> dict:
            model = self._get_model()
            segments, info = model.transcribe(
                _decode_audio(audio_bytes),
                language=lang,  # None → تشخیص خودکار whisper
                task=task,
                vad_filter=True,
            )
            out: list[dict] = []
            end = 0.0
            for seg in segments:
                out.append(
                    {
                        "start": float(seg.start),
                        "end": float(seg.end),
                        "text": seg.text.strip(),
                    }
                )
                end = max(end, float(seg.end))
            return {
                "segments": out,
                "language": info.language,
                "duration_s": round(end or float(info.duration or 0.0), 2),
            }

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_run), timeout=timeout_s or STT_TIMEOUT_S
            )
        except TimeoutError:
            raise APIError(
                503, "stt_timeout",
                "رونویسی بیش از حد طول کشید؛ لطفاً فایل کوتاه‌تری بفرستید",
                {"timeout_s": timeout_s or STT_TIMEOUT_S},
            )
        except APIError:
            raise
        except Exception as exc:  # noqa: BLE001 — مدل/باینری خراب یا ناموجود؛ صادقانه
            raise APIError(
                503, "stt_unavailable",
                "سرویس رونویسی گفتار در دسترس نیست",
                {"reason": type(exc).__name__},
            )


def get_stt_provider(configured: str) -> STTProvider | None:
    """None یعنی STT در دسترس نیست (فراخواننده خطای صادقانه می‌دهد)."""
    if configured == "none":
        return None
    if configured == "faster_whisper":
        return FasterWhisperSTT() if faster_whisper_available() else None
    # auto: هرچه موجود است
    if faster_whisper_available():
        return FasterWhisperSTT()
    return None


def resolve_stt_provider(configured: str) -> STTProvider:
    provider = get_stt_provider(configured)
    if provider is None:
        raise APIError(
            503, "stt_unavailable",
            "سرویس رونویسی گفتار پیکربندی/نصب نشده است؛ "
            "متن را تایپ کنید یا بعداً تلاش کنید",
            {"hint": "faster-whisper نصب نیست یا voice.stt_provider=none است"},
        )
    return provider


async def transcribe_bytes(
    audio_bytes: bytes,
    *,
    lang: str | None,
    configured_provider: str,
    max_audio_seconds: int,
) -> dict:
    """رونویسی + اعتبارسنجی زبان و سقف مدت (۴۲۲ برای فایل خیلی بلند)."""
    if lang is not None and lang not in SUPPORTED_LANGS:
        raise APIError(
            400, "unsupported_language",
            "فقط فارسی و عربی پشتیبانی می‌شوند",
            {"lang": lang},
        )
    provider = resolve_stt_provider(configured_provider)
    started = time.monotonic()
    result = await provider.transcribe(audio_bytes, lang=lang)
    stt_ms = int((time.monotonic() - started) * 1000)
    duration = float(result.get("duration_s") or 0.0)
    if duration > max_audio_seconds:
        raise APIError(
            422, "audio_too_long",
            "فایل صوتی بیش از حد بلند است؛ لطفاً بخش کوتاه‌تری بفرستید",
            {"duration_s": duration, "max_audio_seconds": max_audio_seconds},
        )
    detected = str(result.get("language") or "").strip().lower()
    if detected and detected not in SUPPORTED_LANGS:
        raise APIError(
            400, "unsupported_language",
            "زبان تشخیص‌داده‌شده پشتیبانی نمی‌شود (فقط فارسی/عربی)",
            {"detected": detected},
        )
    result["stt_ms"] = stt_ms
    result["provider"] = provider.name
    return result
