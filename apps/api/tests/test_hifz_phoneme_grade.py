"""تست‌های نمره‌دهی ضبطی با خروجی واجی (Zipformer) — فاز ۳.

پوشش (با ASR ماکِ واجی و نگاشت مصنوعیِ قطعه‌ای، نه دادهٔ واقعی):
- نمرهٔ آیهٔ کامل با رشتهٔ واجی دقیق → همه درست.
- جاافتادگی وسط آیه (تراز ادامه‌دار) → خاکستری + ادامه.
- تمرین تک‌کلمه روی کلمهٔ ادغام‌شده → ۴۲۲ صادقانه.
- نبود نگاشت → ۵۰۳ صادقانه، بدون نمرهٔ ساختگی.
- مسیر کلمه‌ای (Whisper) دست‌نخورده می‌ماند (در test_hifz_phase3).
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest

from app.modules.quran.hifz_mapping import MappingPendingError, Segment

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"

_TANZIL = Path(__file__).resolve().parent.parent / (
    "app/modules/quran/data/tanzil_uthmani.txt"
)


def _tanzil_ayah(surah: int, ayah: int) -> str:
    for line in _TANZIL.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if (
            len(parts) == 3
            and parts[0].isdigit()
            and parts[1].isdigit()
            and int(parts[0]) == surah
            and int(parts[1]) == ayah
        ):
            return parts[2]
    raise AssertionError(f"Tanzil ayah {surah}:{ayah} not found")


def _wav_bytes(frames: int = 1600) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


async def _fake_ayah_bundle(db, surah: int, ayah: int, **kwargs):
    return {
        "surah": surah,
        "ayah": ayah,
        "editions": [{"edition": "quran-uthmani", "text": _tanzil_ayah(surah, ayah)}],
    }


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _user_token(client, email: str) -> str:
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
    return r.json()["access_token"]


class _FakePhonemeEngine:
    """ASR ماکِ واجی: توکن‌های واجی از پیش تعیین‌شده."""

    output_level = "phoneme"

    def __init__(self, tokens: list[str]):
        from app.modules.quran.hifz_engines import HeardWord, Transcription

        self._transcription = Transcription(
            text=" ".join(tokens),
            words=[HeardWord(t) for t in tokens],
        )

    def transcribe(self, wav_bytes: bytes):
        assert wav_bytes[:4] == b"RIFF", "mock expects a WAV payload"
        return self._transcription


class _FakeMapping:
    """نگاشت مصنوعیِ قطعه‌ای برای ۱۱۲:۱ (مبنای ارائه‌شده: ۸ کلمه)."""

    def __init__(self, merged: bool = False):
        if merged:
            # کلمه‌های ۴ و ۵ (قُلْ + هُوَ) در یک قطعه ادغام شده‌اند.
            self._segs = [
                Segment((0,), "basm1"),
                Segment((1,), "basm2"),
                Segment((2,), "basm3"),
                Segment((3,), "basm4"),
                Segment((4, 5), "qulhuwa"),
                Segment((6,), "alah"),
                Segment((7,), "ahad"),
            ]
        else:
            self._segs = [
                Segment((0,), "basm1"),
                Segment((1,), "basm2"),
                Segment((2,), "basm3"),
                Segment((3,), "basm4"),
                Segment((4,), "qul"),
                Segment((5,), "huwa"),
                Segment((6,), "alah"),
                Segment((7,), "ahad"),
            ]

    def segments_for(self, surah, ayah):
        if (surah, ayah) == (112, 1):
            return list(self._segs)
        return None


async def _attempt_id(tc, token: str) -> str:
    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "page": 604},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _grade(tc, token, attempt_id, ayah, tokens, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine",
        lambda _id: _FakePhonemeEngine(tokens),
    )
    return await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": ayah},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.mark.asyncio
async def test_phoneme_grade_exact_all_correct(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping,
        "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    token = await _user_token(tc["client"], "hifz-phon-exact@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(
        tc, token, attempt_id, 1,
        ["basm1", "basm2", "basm3", "basm4", "qul", "huwa", "alah", "ahad"],
        monkeypatch,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine_used"] == "zipformer"
    assert body["counts"]["correct"] == 8
    assert all(w["status"] == "correct" for w in body["words"])


@pytest.mark.asyncio
async def test_phoneme_grade_skip_continues(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping,
        "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    token = await _user_token(tc["client"], "hifz-phon-skip@example.com")
    attempt_id = await _attempt_id(tc, token)
    # هُوَ و اللَّهُ جاافتاده‌اند؛ أَحَدٌ بعدشان می‌آید.
    r = await _grade(
        tc, token, attempt_id, 1,
        ["basm1", "basm2", "basm3", "basm4", "qul", "ahad"],
        monkeypatch,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    by_index = {w["word_index"]: w["status"] for w in body["words"]}
    assert by_index[4] == "correct"
    assert by_index[5] == "skipped" and by_index[6] == "skipped"
    assert by_index[7] == "correct"


@pytest.mark.asyncio
async def test_phoneme_grade_word_merged_unit_422(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping,
        "load_phoneme_mapping",
        lambda: _FakeMapping(merged=True),
    )
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine",
        lambda _id: _FakePhonemeEngine(["qulhuwa"]),
    )
    token = await _user_token(tc["client"], "hifz-phon-merged@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade-word",
        data={"surah": 112, "ayah": 1, "word_index": 4},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "hifz_word_in_merged_unit"


@pytest.mark.asyncio
async def test_phoneme_grade_without_mapping_503(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )

    def _raise():
        raise MappingPendingError("نگاشت پیکربندی نشده است")

    monkeypatch.setattr(
        hifz_service.hifz_mapping, "load_phoneme_mapping", _raise
    )
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine",
        lambda _id: _FakePhonemeEngine(["qul"]),
    )
    token = await _user_token(tc["client"], "hifz-phon-nomap@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "hifz_word_alignment_pending"
