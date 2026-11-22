"""تست‌های دیکود PyAV در STT (سازگاری faster-whisper 1.2.1 با PyAV ≥13).

پوشش:
- _decode_audio: WAV مصنوعی، خروجی آرایهٔ float32 مونو 16kHz با طول درست
- FasterWhisperSTT به مدل ndarray می‌دهد، نه BytesIO (مسیر دیکود داخلی
  whisper با av.open و metadata_errors روی PyAV ≥13 خراب است)
"""
from __future__ import annotations

import io
import math
import struct
import wave
from types import SimpleNamespace
from typing import ClassVar

import numpy as np
import pytest

from app.modules.voice.stt import FasterWhisperSTT, _decode_audio


def _sine_wav(seconds: float = 0.5, rate: int = 16000, freq: int = 440) -> bytes:
    """WAV مونوی ۱۶بیتی مصنوعی (سینوسی) با stdlib — بدون فایل خارجی."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(int(seconds * rate))
        )
        wf.writeframes(frames)
    return buf.getvalue()


def test_decode_audio_returns_float32_16k_mono():
    out = _decode_audio(_sine_wav())
    assert isinstance(out, np.ndarray)
    assert out.dtype == np.float32
    assert out.ndim == 1
    # ۰٫۵ ثانیه در ۱۶kHz ≈ ۸۰۰۰ نمونه (با تلورانس resampler)
    assert 7000 <= len(out) <= 9000


class _FakeModel:
    """WhisperModel جعلی: ورودی دریافتی را ثبت می‌کند."""

    received: ClassVar[list] = []

    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, audio, **kwargs):
        type(self).received.append(audio)
        seg = SimpleNamespace(text=" سلام ", start=0.0, end=0.5)
        info = SimpleNamespace(language="fa", duration=0.5)
        return [seg], info


@pytest.fixture
def fake_model(monkeypatch):
    _FakeModel.received = []
    monkeypatch.setattr("faster_whisper.WhisperModel", _FakeModel)
    monkeypatch.setattr(FasterWhisperSTT, "_model", None)
    return _FakeModel


async def test_transcribe_segments_passes_ndarray_to_model(fake_model):
    stt = FasterWhisperSTT(model_size="tiny")
    out = await stt.transcribe_segments(_sine_wav(), timeout_s=30)
    assert len(fake_model.received) == 1
    assert isinstance(fake_model.received[0], np.ndarray)
    assert out["language"] == "fa"
    assert out["segments"] == [{"start": 0.0, "end": 0.5, "text": "سلام"}]


async def test_transcribe_passes_ndarray_to_model(fake_model):
    stt = FasterWhisperSTT(model_size="tiny")
    out = await stt.transcribe(_sine_wav(), lang="fa", timeout_s=30)
    assert len(fake_model.received) == 1
    assert isinstance(fake_model.received[0], np.ndarray)
    assert out["text"] == "سلام"
    assert out["language"] == "fa"
