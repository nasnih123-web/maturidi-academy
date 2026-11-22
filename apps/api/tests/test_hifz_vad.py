"""دروازهٔ گفتارِ سبکِ انرژی/RMS برای مسیر حفاظ (پیشنهاد ۱۲).

کالیبراسیون از روی فایلِ واقعیِ کاربر (fatiha-16k.wav): گفتارِ
میانه −۱۹٫۵ dBFS، آغازِ آرامِ بسمله رامپِ −۶۵ تا −۴۵ در ~۰٫۴
ثانیه، سکوتِ دیجیتال −۱۲۰. آزمونِ آغازِ آرام، صریح است: رامپِ
مصنوعی و فایلِ واقعی (و نسخهٔ ۰٫۲۵ برابریِ آن) باید گفتار
شناخته شوند و نخستین قابِ گفتارشان دیر نرسد؛ سکوتِ خالص باید
۴۲۲ `hifz_no_speech` بگیرد، نه نمره.
"""

from __future__ import annotations

import io
import json
import struct
import wave
from pathlib import Path

import pytest

from app.core.errors import APIError
from app.modules.quran import hifz_service, hifz_vad
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import SherpaPhonemeStream

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"
_FATIHA = Path.home() / "workspace" / "hifz-voice-test" / "fatiha-16k.wav"


def _pcm(samples: list[int]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *samples)


def _wav_bytes(samples: list[int]) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(_pcm(samples))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# توابعِ خالص
# ---------------------------------------------------------------------------


def test_frame_dbfs_silence_and_loud():
    assert hifz_vad.frame_dbfs([0] * 320) == -120.0
    assert hifz_vad.frame_dbfs([]) == -120.0
    # دامنهٔ ۱۰۰۰ → ‎~−۳۰٫۳ dBFS
    assert abs(hifz_vad.frame_dbfs([1000] * 320) - (-30.3)) < 0.2


def test_speech_mask_pure_silence():
    pcm = _pcm([0] * 16000)  # ۱ ثانیه سکوت
    assert hifz_vad.speech_mask(pcm) == [False] * 50
    assert hifz_vad.has_speech(pcm) is False
    assert hifz_vad.filter_silence(pcm) == b""


def test_speech_mask_loud_is_all_speech():
    pcm = _pcm([1000] * 16000)
    assert all(hifz_vad.speech_mask(pcm))
    assert hifz_vad.filter_silence(pcm) == pcm


def test_mask_drops_silence_gap_keeps_speech():
    """۰٫۵ ثانیه سکوت + ۱ ثانیه گفتار + ۰٫۵ ثانیه سکوت: گفتار
    با پیش‌نگه‌داشت و پس‌نگه‌داشت نگه داشته می‌شود، سکوتِ دور
    می‌ریزد."""
    pcm = _pcm([0] * 8000 + [1000] * 16000 + [0] * 8000)
    mask = hifz_vad.speech_mask(pcm)
    # گفتار از قاب ۲۵ شروع می‌شود؛ پیش‌نگه‌داشت، قاب‌های ۲۳ و ۲۴
    # را هم گفتار می‌کند.
    assert mask[22] is False
    assert mask[23] is True and mask[24] is True
    assert all(mask[25:75])
    # پس‌نگه‌داشت: ۵ قاب پس از پایانِ گفتار (۷۵ تا ۷۹) هم می‌مانند.
    assert all(mask[75:80])
    assert mask[80] is False
    kept = hifz_vad.filter_silence(pcm)
    assert len(kept) // 2 == (80 - 23) * 320


def test_quiet_start_not_eaten_by_pre_roll():
    """آغازِ آرام (۱۵ قابِ ‎~−۶۱ dBFS و بعد گفتار): پیش‌نگه‌داشت،
    ۲ قابِ پیش از نخستین قابِ گفتار را نگه می‌دارد — آغازِ کلمه
    بریده نمی‌شود."""
    pcm = _pcm([30] * (15 * 320) + [300] * (35 * 320))
    mask = hifz_vad.speech_mask(pcm)
    assert mask[12] is False
    assert mask[13] is True and mask[14] is True  # پیش‌نگه‌داشت
    assert mask[15] is True  # نخستین قابِ گفتار (۰٫۳۰ ثانیه)
    assert hifz_vad.has_speech(pcm) is True
    assert len(hifz_vad.filter_silence(pcm)) // 2 == (50 - 13) * 320


def test_filter_silence_preserves_sample_values():
    pcm = _pcm([0] * 3200 + [2000] * 3200 + [0] * 3200)
    kept = hifz_vad.filter_silence(pcm)
    # قاب‌های ۸ و ۹ (پیش‌نگه‌داشت) + ۱۰ تا ۱۹ (گفتار) + ۲۰ تا ۲۴ (پس‌نگه‌داشت)
    assert kept == _pcm([0] * (2 * 320) + [2000] * 3200 + [0] * (5 * 320))


# ---------------------------------------------------------------------------
# فایلِ واقعیِ کاربر
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _FATIHA.exists(), reason="user voice file not present")
def test_real_fatiha_passes_gate_and_quiet_start_survives():
    pcm = hifz_vad.wav_pcm16(_FATIHA.read_bytes())
    mask = hifz_vad.speech_mask(pcm)
    first = next(i for i, m in enumerate(mask) if m)
    assert first <= 25, f"first speech frame {first} (>0.5s) — quiet start eaten"
    assert sum(mask) / len(mask) >= 0.70
    assert hifz_vad.has_speech(pcm) is True
    assert len(hifz_vad.filter_silence(pcm)) > 0


@pytest.mark.skipif(not _FATIHA.exists(), reason="user voice file not present")
def test_real_fatiha_quiet_version_still_passes():
    """نسخهٔ ۰٫۲۵ برابری (۱۲- dB آرام‌تر — خوانندهٔ آرام): هنوز
    گفتار شناخته می‌شود و نخستین قابش دیر نمی‌رسد."""
    raw = _FATIHA.read_bytes()
    with wave.open(io.BytesIO(raw), "rb") as w:
        frames = w.readframes(w.getnframes())
    samples = struct.unpack(f"<{len(frames) // 2}h", frames)
    quiet = struct.pack(
        f"<{len(samples)}h",
        *[max(-32768, min(32767, int(s * 0.25))) for s in samples],
    )
    mask = hifz_vad.speech_mask(quiet)
    assert any(mask)
    first = next(i for i, m in enumerate(mask) if m)
    assert first <= 50, f"first speech frame {first} (>1s) for quiet recitation"


# ---------------------------------------------------------------------------
# require_speech
# ---------------------------------------------------------------------------


def test_require_speech_rejects_silence_wav():
    with pytest.raises(APIError) as exc:
        hifz_vad.require_speech(_wav_bytes([0] * 16000))
    assert exc.value.status_code == 422
    assert exc.value.code == "hifz_no_speech"


def test_require_speech_passes_loud_wav():
    hifz_vad.require_speech(_wav_bytes([1000] * 16000))


def test_require_speech_rejects_invalid_wav():
    with pytest.raises(APIError) as exc:
        hifz_vad.require_speech(b"not a wav")
    assert exc.value.code == "hifz_audio_format"


# ---------------------------------------------------------------------------
# جریانِ زنده: دروازه در SherpaPhonemeStream.feed
# ---------------------------------------------------------------------------


class _FakeStream:
    def __init__(self):
        self.samples = 0
        self.finished = False

    def accept_waveform(self, sample_rate, samples):
        self.samples += len(samples)

    def input_finished(self):
        self.finished = True


class _FakeRecognizer:
    READY_SAMPLES = 9600  # ‎~۰٫۶ ثانیه، مثل sherpa واقعی

    def __init__(self):
        self._stream = _FakeStream()
        self.decode_calls = 0

    def create_stream(self):
        return self._stream

    def is_ready(self, stream):
        return stream.samples >= self.READY_SAMPLES

    def decode_stream(self, stream):
        self.decode_calls += 1
        stream.samples = 0

    def get_result_as_json_string(self, stream):
        return json.dumps({"tokens": []})


def _stream_with_fake_recognizer():
    stream = SherpaPhonemeStream.__new__(SherpaPhonemeStream)
    stream._recognizer = _FakeRecognizer()
    stream._stream = stream._recognizer.create_stream()
    stream._seen_tokens = 0
    stream._speech_samples = 0
    return stream


def test_feed_drops_pure_silence():
    stream = _stream_with_fake_recognizer()
    assert stream.feed(_pcm([0] * 16000)) == []
    assert stream._recognizer._stream.samples == 0
    assert stream.heard_speech is False


def test_feed_passes_speech_and_tracks_it():
    stream = _stream_with_fake_recognizer()
    assert stream.feed(_pcm([1000] * 16000)) == []
    assert stream._recognizer._stream.samples == 0  # دیکد، شمارنده را صفر کرد
    assert stream._recognizer.decode_calls == 1
    assert stream.heard_speech is True
    assert stream._speech_samples == 16000


def test_warmup_bypasses_vad_and_does_not_count_as_speech():
    stream = _stream_with_fake_recognizer()
    assert stream.warmup() >= 0
    assert stream._recognizer.decode_calls == 1
    assert stream.heard_speech is False
    assert stream._speech_samples == 0


# ---------------------------------------------------------------------------
# مسیر ضبطی: سکوت → ۴۲۲ صادقانه، گفتار → ۲۰۰
# ---------------------------------------------------------------------------


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _user_token_and_attempt(client, email: str):
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    r = await client.post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "page": 604},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return token, r.json()["id"]


@pytest.mark.asyncio
async def test_grade_silence_wav_is_honest_no_speech_error(tc):
    import uuid

    email = f"vad-silence-{uuid.uuid4().hex[:8]}@example.com"
    token, attempt_id = await _user_token_and_attempt(tc["client"], email)
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes([0] * 16000), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "hifz_no_speech"


@pytest.mark.asyncio
async def test_grade_loud_wav_passes_gate(tc, monkeypatch):
    """گفتارِ بلند از دروازه می‌گذرد و نمره می‌گیرد (نه ۴۲۲)."""
    import uuid

    from app.modules.quran.hifz_engines import HeardWord, Transcription

    class _FakePhonemeEngine:
        output_level = "phoneme"

        def transcribe(self, wav_bytes: bytes):
            tokens = [
                "basm1", "basm2", "basm3", "basm4",
                "qul", "huwa", "alah", "ahad",
            ]
            return Transcription(
                text=" ".join(tokens),
                words=[HeardWord(t) for t in tokens],
            )

    class _FakeMapping:
        def segments_for(self, surah, ayah):
            if (surah, ayah) == (112, 1):
                return [
                    Segment((0,), "basm1"),
                    Segment((1,), "basm2"),
                    Segment((2,), "basm3"),
                    Segment((3,), "basm4"),
                    Segment((4,), "qul"),
                    Segment((5,), "huwa"),
                    Segment((6,), "alah"),
                    Segment((7,), "ahad"),
                ]
            return None

    async def _fake_bundle(db, surah, ayah, **kw):
        return {
            "surah": surah, "ayah": ayah,
            "editions": [{"edition": "quran-uthmani", "text": (
                "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ "
                "قُلْ هُوَ اللَّهُ أَحَدٌ"
            )}],
        }

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping, "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine",
        lambda _id: _FakePhonemeEngine(),
    )
    email = f"vad-loud-{uuid.uuid4().hex[:8]}@example.com"
    token, attempt_id = await _user_token_and_attempt(tc["client"], email)
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes([1000] * 16000), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["correct"] == 8
