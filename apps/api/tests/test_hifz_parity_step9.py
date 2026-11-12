"""تست‌های گام ۹ برابری با ترتیل — ایراد ۷ (ترازِ واجیِ مسیرِ Whisper).

پوشش (با ASR ماک و نگاشت مصنوعی، نه مدل واقعی):
- مسیرِ Whisper + پس‌پردازشِ واجی → زمان‌بندی از ترازِ واجی
  (`timing_source: "phoneme"`) با مرزهای دقیقِ توکن‌ها.
- پس‌پردازش در دسترس نیست + زمانِ DTW در رونویسی هست →
  `dtw_fallback` با برچسبِ صریح (نه بی‌صدا).
- هیچ‌کدام در دسترس نیست → `none` با start/end خالی، نه زمانِ ساختگی.
- بسملهٔ آغازینِ ضبط در پس‌پردازش مصرف می‌شود و زمانِ کلمهٔ اول
  از محتوای آیه شروع می‌شود، نه از بسمله.
- تمرینِ تک‌کلمه هم زمانِ واجی می‌گیرد.
- مسیرِ واجیِ Zipformer هم از همان تراز زمان می‌گیرد.
- واحدها: بازه‌های `align_phonemes`، هم‌ارزیِ فروپاشی با نقشهٔ توکن،
  و نگاشتِ بازه→زمان (واحدِ ادغامی، کلمهٔ جاافتاده).
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest

from app.modules.quran import alignment
from app.modules.quran.hifz_engines import HeardWord, TimedPhoneme, Transcription
from app.modules.quran.hifz_mapping import Segment

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


class _FakeWhisperEngine:
    """ASR ماکِ کلمه‌ای (Whisper): کلمه‌ها + زمانِ DTWِ اختیاری."""

    output_level = "word"

    def __init__(self, words, timings=None):
        heard = []
        for i, w in enumerate(words):
            start = end = None
            if timings is not None:
                start, end = timings[i]
            heard.append(HeardWord(w, 0.95, start=start, end=end))
        self._transcription = Transcription(
            text=" ".join(words), words=heard
        )

    def transcribe(self, wav_bytes: bytes):
        assert wav_bytes[:4] == b"RIFF", "mock expects a WAV payload"
        return self._transcription


class _FakePhonemeEngine:
    """موتورِ ماکِ پس‌پردازشِ واجی: توکن‌های زمان‌دارِ از پیش تعیین‌شده."""

    def __init__(self, timed, available=True):
        self._timed = timed
        self._available = available

    def is_configured(self):
        return (self._available, "" if self._available else "not configured")

    def transcribe_timed_phonemes(self, wav_bytes: bytes):
        assert wav_bytes[:4] == b"RIFF", "mock expects a WAV payload"
        return list(self._timed)


class _FakeMapping:
    """نگاشت مصنوعی: ۱۱۲:۱ با بسمله (۸ واحد، مثل متن تنزیلِ ریپو که
    بسمله را جزو آیهٔ ۱ می‌آورد)، ۱۱۲:۲ بدون بسمله، و بسملهٔ ۱:۱."""

    def __init__(self, with_basmala=True):
        self._segs_112_1 = [
            Segment((0,), "bis"),
            Segment((1,), "mil"),
            Segment((2,), "lah"),
            Segment((3,), "rahim"),
            Segment((4,), "qul"),
            Segment((5,), "huwa"),
            Segment((6,), "alah"),
            Segment((7,), "ahad"),
        ]
        self._segs_112_2 = [
            Segment((0,), "alah"),
            Segment((1,), "samad"),
        ]
        self._segs_basmala = (
            [
                Segment((0,), "bis"),
                Segment((1,), "mil"),
                Segment((2,), "lah"),
                Segment((3,), "rahim"),
            ]
            if with_basmala
            else None
        )

    def segments_for(self, surah, ayah):
        if (surah, ayah) == (112, 1):
            return list(self._segs_112_1)
        if (surah, ayah) == (112, 2):
            return list(self._segs_112_2)
        if (surah, ayah) == (1, 1) and self._segs_basmala is not None:
            return list(self._segs_basmala)
        return None


def _timed(text: str, start: float = 1.0, step: float = 0.1):
    return [
        TimedPhoneme(ch, round(start + i * step, 3))
        for i, ch in enumerate(text)
    ]


def _setup(monkeypatch, whisper_fake, phoneme_fake, mapping=None):
    """Whisper موتورِ انتخاب‌شده؛ پس‌پردازش و نگاشت، ماک."""
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )

    async def _resolve(db):
        return "whisper_quran"

    monkeypatch.setattr(hifz_service.hifz_engines, "resolve_engine_id", _resolve)
    monkeypatch.setattr(
        hifz_service.hifz_engines,
        "get_engine",
        lambda _id: whisper_fake if _id == "whisper_quran" else phoneme_fake,
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping,
        "load_phoneme_mapping",
        lambda: mapping if mapping is not None else _FakeMapping(),
    )


async def _attempt_id(tc, token: str) -> str:
    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "page": 604},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _grade(tc, token, attempt_id, ayah=1, word_index=None):
    data = {"surah": 112, "ayah": ayah}
    path = f"{HIFZ}/attempts/{attempt_id}/grade"
    if word_index is not None:
        data["word_index"] = word_index
        path = f"{HIFZ}/attempts/{attempt_id}/grade-word"
    return await tc["client"].post(
        path,
        data=data,
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )


_WORDS_112_1 = _tanzil_ayah(112, 1).split()


@pytest.mark.asyncio
async def test_whisper_grade_uses_phoneme_timing(tc, monkeypatch):
    """پس‌پردازشِ واجی در دسترس است: زمان‌ها از ترازِ واجی می‌آیند،
    نه از DTW — مرزها دقیقاً زمانِ توکن‌های واجی‌اند."""
    whisper = _FakeWhisperEngine(_WORDS_112_1)
    phoneme = _FakePhonemeEngine(_timed("bismillahrahimqulhuwaalahahad"))
    _setup(monkeypatch, whisper, phoneme)
    token = await _user_token(tc["client"], "hifz-s9-phoneme@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(tc, token, attempt_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine_used"] == "whisper_quran"
    assert body["timing_source"] == "phoneme"
    assert body["counts"]["correct"] == 8
    by_index = {w["word_index"]: w for w in body["words"]}
    assert (by_index[0]["start"], by_index[0]["end"]) == (1.0, 1.3)
    assert (by_index[4]["start"], by_index[4]["end"]) == (2.4, 2.7)
    assert (by_index[7]["start"], by_index[7]["end"]) == (3.5, 3.9)


@pytest.mark.asyncio
async def test_whisper_grade_dtw_fallback_is_labeled(tc, monkeypatch):
    """پس‌پردازش در دسترس نیست و رونویسی زمانِ DTW دارد: زمان‌ها
    می‌آیند ولی با برچسبِ صریحِ `dtw_fallback`، نه بی‌صدا."""
    timings = [
        (10.0, 10.5), (10.5, 11.0), (11.0, 11.8), (11.8, 12.4),
        (12.4, 13.0), (13.0, 13.6), (13.6, 14.2), (14.2, 14.9),
    ]
    whisper = _FakeWhisperEngine(_WORDS_112_1, timings=timings)
    phoneme = _FakePhonemeEngine([], available=False)
    _setup(monkeypatch, whisper, phoneme)
    token = await _user_token(tc["client"], "hifz-s9-dtw@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(tc, token, attempt_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timing_source"] == "dtw_fallback"
    by_index = {w["word_index"]: w for w in body["words"]}
    assert (by_index[0]["start"], by_index[0]["end"]) == (10.0, 10.5)
    assert (by_index[7]["start"], by_index[7]["end"]) == (14.2, 14.9)
    assert body["counts"]["correct"] == 8


@pytest.mark.asyncio
async def test_whisper_grade_no_timing_source_none(tc, monkeypatch):
    """نه پس‌پردازش هست، نه زمانِ DTW: `none` با start/end خالی —
    زمانِ ساختگی تولید نمی‌شود و نمره‌دهی سر جایش می‌ماند."""
    whisper = _FakeWhisperEngine(_WORDS_112_1)
    phoneme = _FakePhonemeEngine([], available=False)
    _setup(monkeypatch, whisper, phoneme)
    token = await _user_token(tc["client"], "hifz-s9-none@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(tc, token, attempt_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timing_source"] == "none"
    assert all(w["start"] is None and w["end"] is None for w in body["words"])
    assert body["counts"]["correct"] == 8


@pytest.mark.asyncio
async def test_whisper_grade_basmala_consumed_before_timing(tc, monkeypatch):
    """ضبطِ آیهٔ ۲ با بسمله شروع می‌شود: بسمله در پس‌پردازش مصرف
    می‌شود و زمانِ کلمهٔ اول از محتوای آیه شروع می‌شود، نه از بسمله.
    (آیهٔ ۱ بسمله را جزو خودش دارد و مصرف نمی‌شود.)"""
    words_112_2 = _tanzil_ayah(112, 2).split()
    whisper = _FakeWhisperEngine(words_112_2)
    phoneme = _FakePhonemeEngine(
        _timed("bismillahrahimalahsamad", start=5.0)
    )
    _setup(monkeypatch, whisper, phoneme)
    token = await _user_token(tc["client"], "hifz-s9-basmala@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(tc, token, attempt_id, ayah=2)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timing_source"] == "phoneme"
    assert body["counts"]["correct"] == 2
    by_index = {w["word_index"]: w for w in body["words"]}
    # بسمله ۱۴ نویسه است (۵٫۰ تا ۶٫۴)؛ «اللَّهُ» از ۶٫۴ شروع می‌شود.
    assert (by_index[0]["start"], by_index[0]["end"]) == (6.4, 6.8)
    assert (by_index[1]["start"], by_index[1]["end"]) == (6.8, 7.3)


@pytest.mark.asyncio
async def test_whisper_grade_word_phoneme_timing(tc, monkeypatch):
    """تمرینِ تک‌کلمه در مسیرِ Whisper هم زمانِ واجی می‌گیرد (ضبطِ
    تک‌کلمه فقط همان کلمه را دارد)."""
    words_112_2 = _tanzil_ayah(112, 2).split()
    whisper = _FakeWhisperEngine([words_112_2[0]])
    phoneme = _FakePhonemeEngine(_timed("alah"))
    _setup(monkeypatch, whisper, phoneme)
    token = await _user_token(tc["client"], "hifz-s9-word@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(tc, token, attempt_id, ayah=2, word_index=0)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timing_source"] == "phoneme"
    assert body["words"][0]["word_index"] == 0
    assert body["words"][0]["status"] == "correct"
    assert (body["words"][0]["start"], body["words"][0]["end"]) == (1.0, 1.4)


@pytest.mark.asyncio
async def test_zipformer_grade_timing_from_same_decode(tc, monkeypatch):
    """مسیرِ واجیِ Zipformer: زمان از همان دیکدی می‌آید که نمره را
    داد (بدون دیکدِ دوم)؛ ماکِ بدونِ زمان، `none` می‌گیرد."""
    from app.modules.quran import hifz_service

    class _FakeZipformerEngine:
        output_level = "phoneme"

        def __init__(self, timed):
            self._timed = timed

        def transcribe(self, wav_bytes: bytes):
            return Transcription(
                text=" ".join(t.text for t in self._timed),
                words=[HeardWord(t.text) for t in self._timed],
                timed_phonemes=list(self._timed),
            )

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping,
        "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    monkeypatch.setattr(
        hifz_service.hifz_engines,
        "get_engine",
        lambda _id: _FakeZipformerEngine(
            _timed("bismillahrahimqulhuwaalahahad")
        ),
    )
    token = await _user_token(tc["client"], "hifz-s9-zip@example.com")
    attempt_id = await _attempt_id(tc, token)
    r = await _grade(tc, token, attempt_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine_used"] == "zipformer"
    assert body["timing_source"] == "phoneme"
    assert body["counts"]["correct"] == 8
    by_index = {w["word_index"]: w for w in body["words"]}
    assert (by_index[0]["start"], by_index[0]["end"]) == (1.0, 1.3)
    assert (by_index[7]["start"], by_index[7]["end"]) == (3.5, 3.9)


# ---------------------------------------------------------------------------
# واحدها (بدون HTTP)
# ---------------------------------------------------------------------------


def test_align_phonemes_records_spans():
    """هر واحدِ مصرف‌شده بازهٔ واجی‌اش را ثبت می‌کند؛ جاافتاده None."""
    units = [
        ((0,), "qul"),
        ((1,), "huwa"),
        ((2,), "alah"),
        ((3,), "ahad"),
    ]
    aligned, _ = alignment.align_phonemes(
        ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"], units, "qulhuwaalahahad", 0.8, 0.5
    )
    assert [(a.phoneme_start, a.phoneme_end) for a in aligned] == [
        (0, 3),
        (3, 7),
        (7, 11),
        (11, 15),
    ]
    aligned, _ = alignment.align_phonemes(
        ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"], units, "qulahad", 0.8, 0.5
    )
    by_index = {a.word_index: a for a in aligned}
    assert by_index[1].status == "skipped"
    assert by_index[1].phoneme_start is None
    assert by_index[3].status == "correct"
    assert (by_index[3].phoneme_start, by_index[3].phoneme_end) == (3, 7)


def test_align_words_records_heard_index():
    """`heard_index` جایگاهِ کلمهٔ شنیده‌شدهٔ متناظر است؛ جاافتاده None."""
    aligned, _ = alignment.align_words(
        ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"],
        ["قُلْ", "اللَّهُ", "أَحَدٌ"],
        heard_probs=[0.9, 0.9, 0.9],
    )
    assert [a.heard_index for a in aligned] == [0, None, 1, 2]


def test_collapse_with_token_map_matches_collapse():
    """فروپاشی با نقشهٔ توکن، همان رشتهٔ `collapse_phoneme_runs` را
    می‌دهد و هر نویسه به توکنِ درستش برمی‌گردد."""
    from app.modules.quran import hifz_service
    from app.modules.quran.hifz_mapping import collapse_phoneme_runs

    timed = [TimedPhoneme("قَا", 1.0), TimedPhoneme("ا", 1.1), TimedPhoneme("لَ", 1.2)]
    text, token_of_char = hifz_service._collapse_with_token_map(timed)
    assert text == collapse_phoneme_runs("قَاالَ") == "قَالَ"
    assert token_of_char == [0, 0, 0, 2, 2]


def test_spans_to_timings_merged_and_skipped():
    """واحدِ ادغامی یک زمان برای هر دو کلمه می‌دهد؛ جاافتاده زمان ندارد."""
    from app.modules.quran import hifz_service

    aligned = [
        alignment.AlignedWord(0, "a", "correct", 0.95, "a", None,
                              phoneme_start=0, phoneme_end=6),
        alignment.AlignedWord(1, "b", "correct", 0.95, "b", None,
                              phoneme_start=0, phoneme_end=6),
        alignment.AlignedWord(2, "c", "skipped", 0.0, None, "skipped"),
    ]
    timed = _timed("abcdef", start=2.0, step=0.5)
    out = hifz_service._spans_to_timings(aligned, timed, list(range(6)))
    assert out[0] == out[1] == (2.0, 5.0)
    assert 2 not in out
