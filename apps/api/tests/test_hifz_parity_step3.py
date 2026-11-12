"""تست‌های گام ۳ برابری با ترتیل — ایراد ۱۴ (تطبیق‌دهندهٔ زنده).

سه رفتارِ اصلاح‌شده:
- بسمله مدرکِ یافتنِ آیه نیست: نشستِ آغازشده با بسمله روی آیهٔ ۱
  لنگر نمی‌اندازد و بسملهٔ تنها هیچ آیه‌ای را ثابت نمی‌کند؛ محتوای
  واقعیِ آیهٔ ۱ (پس از بسمله) همچنان پیدا می‌شود و سورهٔ ۱ که
  آیهٔ اولش خودِ بسمله است، از این قاعده آسیب نمی‌بیند.
- هم‌ترازیِ دوباره دیگر خطای واقعی را بی‌صدا دور نمی‌ریزد: خردهٔ
  به‌اندازهٔ یک کلمه که با واحدی جلوتر ادامه پیدا می‌کند، واحدِ
  جاری را «غلط» می‌کند، نه «جاافتاده».
- گزینهٔ «تا اصلاحِ خطا جلو نرو» (freeze_on_error / hold): واحدِ
  غلط اشاره‌گر را نگه می‌دارد؛ کلمهٔ درستِ بعد شمرده نمی‌شود تا
  همان واحد اصلاح شود و اصلاح با correction روی همان خانه
  می‌نشیند.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.modules.quran import hifz_service
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import LiveSession, locate_ayah

# رشتهٔ واجیِ بسملهٔ مصنوعی: دقیقاً ۲۴ حرف (کفِ اثباتِ یافتن).
_BASMALA_SEGS = [
    Segment((0,), "bismilla"),
    Segment((1,), "hirrahma"),
    Segment((2,), "nirrahim"),
]
_BASMALA = "bismillahirrahmanirrahim"

_AYAH12_SEGS = [
    Segment((0,), "qalama"),
    Segment((1,), "manaaka"),
    Segment((2,), "allatasjud"),
]
_AYAH12 = "qalamamanaakaallatasjud"


class _BasmalaMapping:
    """نگاشت مصنوعی: ۱:۱ بسمله است؛ ۷:۱ بسمله + محتوا؛ ۷:۱۲ محتوا."""

    def segments_for(self, surah, ayah):
        if (surah, ayah) == (1, 1):
            return list(_BASMALA_SEGS)
        if (surah, ayah) == (7, 1):
            return list(_BASMALA_SEGS) + [
                Segment((3,), "aliflammimsad"),
                Segment((4,), "tilkaayatulkitabi"),
            ]
        if (surah, ayah) == (7, 12):
            return list(_AYAH12_SEGS)
        return None


def test_basmala_does_not_locate_ayah_1():
    """بسمله + محتوای آیهٔ ۱۲ باید آیهٔ ۱۲ را بیابد، نه آیهٔ ۱ را."""
    mapping = _BasmalaMapping()
    hit = locate_ayah(mapping, 7, _BASMALA + _AYAH12, hint_ayah=12)
    assert hit == (12, 0)


def test_basmala_alone_proves_nothing():
    """بسملهٔ تنها هیچ آیه‌ای را ثابت نمی‌کند (نشست منتظر می‌ماند)."""
    mapping = _BasmalaMapping()
    assert locate_ayah(mapping, 7, _BASMALA, hint_ayah=12) is None


def test_ayah_1_content_still_locates_after_basmala_exclusion():
    """محتوای واقعیِ آیهٔ ۱ (بدون بسمله) آیهٔ ۱ را با unit_posِ
    پس از قطعه‌های بسمله پیدا می‌کند."""
    mapping = _BasmalaMapping()
    hit = locate_ayah(
        mapping, 7, "aliflammimsadtilkaayatulkitabi", hint_ayah=5
    )
    assert hit == (1, 3)


def test_fatiha_basmala_ayah_still_locates():
    """سورهٔ ۱: آیهٔ اول خودِ بسمله است و همچنان پیدا می‌شود."""
    mapping = _BasmalaMapping()
    hit = locate_ayah(mapping, 1, _BASMALA, hint_ayah=1)
    assert hit == (1, 0)


@pytest.mark.asyncio
async def test_session_waits_out_opening_basmala(monkeypatch):
    """نشستِ زنده با بسملهٔ آغازین (راستی‌آزماییِ صدای واقعی مالک):
    تا بسمله کامل نشده یافتن اجرا نمی‌شود و «یافتنِ ناموفق» و
    آبشارِ غلط ساخته نمی‌شود؛ پس از بسمله، نشست روی همان آیهٔ
    انتخابی لنگر می‌اندازد و کلمهٔ اول درست می‌نشیند."""
    events: list[dict] = []

    async def fake_ayah_words(db, surah, ayah):
        assert (surah, ayah) == (7, 12)
        return ["قال", "ما", "منعك"]

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=7,
        start_ayah=12,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_BasmalaMapping(),
    )
    session._ayah = 12
    session._words = ["قال", "ما", "منعك"]
    session._index = 0
    await session._ensure_units()
    session._touch(12)
    session._locating = True

    # بسمله تکه‌تکه می‌رسد؛ وسطِ آن هیچ رویدادی نباید بیاید.
    await session.feed_phonemes([_BASMALA[:22]])
    assert _word_events(events) == []
    assert session._locate_failed is False
    # بسمله کامل شد → مصرف می‌شود و نشست منتظرِ متن می‌ماند.
    await session.feed_phonemes([_BASMALA[22:]])
    assert _word_events(events) == []
    assert session._phoneme_buffer == ""
    # متنِ آیهٔ انتخابی: لنگر + کلمهٔ اول درست.
    await session.feed_phonemes(["qalama"])
    words = _word_events(events)
    assert [(w["word_index"], w["status"]) for w in words] == [(0, "correct")]
    assert session._locating is False


# ---------------------------------------------------------------------------
# نشست زنده با نگاشت مصنوعیِ سورهٔ ۱۱۲ (همان الگوی test_hifz_stream)
# ---------------------------------------------------------------------------

_AYAH_WORDS_112 = {
    1: ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"],
    2: ["اللَّهُ", "الصَّمَدُ"],
    3: ["لَمْ", "يَلِدْ", "وَلَمْ", "يُولَدْ"],
    4: ["وَلَمْ", "يَكُن", "لَّهُ", "كُفُوًا", "أَحَدٌ"],
}

_SEGMENTS_112 = {
    1: [
        Segment((0,), "qul"),
        Segment((1,), "huwa"),
        Segment((2,), "alah"),
        Segment((3,), "ahad"),
    ],
    2: [Segment((0,), "alah"), Segment((1,), "samad")],
    3: [
        Segment((0,), "lam"),
        Segment((1,), "yalid"),
        Segment((2,), "walam"),
        Segment((3,), "yulad"),
    ],
    4: [
        Segment((0,), "walam"),
        Segment((1,), "yakun"),
        Segment((2,), "lahu"),
        Segment((3,), "kufuwan"),
        Segment((4,), "ahad"),
    ],
}


class _FakeMapping112:
    def segments_for(self, surah, ayah):
        if surah != 112:
            return None
        return list(_SEGMENTS_112.get(ayah, [])) or None


def _session(monkeypatch, events, hold_on_wrong=False):
    async def fake_ayah_words(db, surah, ayah):
        assert surah == 112
        return list(_AYAH_WORDS_112[ayah])

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_FakeMapping112(),
        hold_on_wrong=hold_on_wrong,
    )
    session._ayah = 1
    session._words = list(_AYAH_WORDS_112[1])
    session._index = 0
    session._touch(1)
    return session


def _word_events(events):
    return [e for e in events if e.get("type") in ("word", "correction")]


@pytest.mark.asyncio
async def test_resync_marks_misread_word_wrong_not_skipped(monkeypatch):
    """به‌جای «قُلْ» چیز دیگری خوانده شد و خواندن با «هُوَ» ادامه
    یافت: واحدِ اول «غلط» است (با شنیده‌شدهٔ واقعی)، نه جاافتاده —
    و خرده بی‌صدا دور ریخته نمی‌شود."""
    events: list[dict] = []
    session = _session(monkeypatch, events)
    await session.feed_phonemes(["xxxxhuwa"])
    words = _word_events(events)
    by_index = {w["word_index"]: w for w in words if w["ayah"] == 1}
    assert by_index[0]["status"] == "wrong"
    assert by_index[0]["heard"] == "xxx"
    assert by_index[1]["status"] == "correct"
    # خردهٔ غلط شمردهٔ دورریخته نیست؛ به‌حسابِ خطا رفته است.
    assert session.live_counts()["resync_dropped"] == 0


@pytest.mark.asyncio
async def test_reread_of_wrong_word_corrects_it(monkeypatch):
    """بازخوانیِ درستِ کلمه‌ای که غلط خورده، «تکرار» نیست —
    اصلاح است: همان خانه با correction درست می‌شود (ایراد ۱۴)."""
    events: list[dict] = []
    session = _session(monkeypatch, events)
    await session.feed_phonemes(["xxxxhuwa"])
    words = _word_events(events)
    assert {w["word_index"]: w["status"] for w in words}[0] == "wrong"

    events.clear()
    await session.feed_phonemes(["qul"])
    words = _word_events(events)
    corrections = [w for w in words if w.get("type") == "correction"]
    assert len(corrections) == 1
    assert corrections[0]["word_index"] == 0
    assert corrections[0]["status"] == "correct"
    assert not [e for e in events if e.get("type") == "repeat"]


@pytest.mark.asyncio
async def test_hold_until_corrected_blocks_and_releases(monkeypatch):
    """با hold روشن: غلط → اشاره‌گر می‌ایستد؛ کلمهٔ بعد شمرده
    نمی‌شود؛ بازخوانیِ درستِ همان واحد با correction آزاد می‌کند."""
    events: list[dict] = []
    session = _session(monkeypatch, events, hold_on_wrong=True)
    await session.feed_phonemes(["z" * 24])
    words = _word_events(events)
    assert len(words) == 1
    assert words[0]["word_index"] == 0 and words[0]["status"] == "wrong"
    assert session._held is True
    first_event_id = words[0]["event_id"]

    # کلمهٔ بعد خوانده می‌شود ولی تا اصلاحِ خطا شمرده نمی‌شود.
    await session.feed_phonemes(["huwa"])
    assert len(_word_events(events)) == 1
    assert session._held is True

    # همان واحد درست خوانده می‌شود: correction روی همان خانه.
    await session.feed_phonemes(["qul"])
    words = _word_events(events)
    corrections = [w for w in words if w.get("type") == "correction"]
    assert len(corrections) == 1
    assert corrections[0]["word_index"] == 0
    assert corrections[0]["status"] == "correct"
    assert corrections[0]["corrects_event_id"] == first_event_id
    assert session._held is False


@pytest.mark.asyncio
async def test_without_hold_wrong_still_advances(monkeypatch):
    """بدون hold (پیش‌فرض): غلط علامت می‌خورد و خواندن ادامه
    پیدا می‌کند — رفتارِ علامت + ادامهٔ پیشین دست نخورده است."""
    events: list[dict] = []
    session = _session(monkeypatch, events, hold_on_wrong=False)
    await session.feed_phonemes(["z" * 24 + "huwa"])
    words = _word_events(events)
    by_index = {w["word_index"]: w for w in words if w["ayah"] == 1}
    assert by_index[0]["status"] == "wrong"
    assert session._held is False
