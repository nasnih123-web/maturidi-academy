"""تست‌های فاز ۶ — برابری حفاظ با ترتیل: Alignment + Grading.

پوشش (بدون مدل واقعی، بدون دانلود؛ نگاشت مصنوعیِ قطعه‌ای):
- عیبِ سورهٔ ۲۴: خواندنِ سورهٔ دیگر (یا تعویضِ وسطِ نشست) دیگر
  آیه‌های نخوانده را خاکستری نمی‌نویسد؛ واحدِ بی‌تطابق «غلط»
  می‌خورد و مصرف می‌شود. پرشِ مشروعِ درونِ سوره همچنان خاکستری
  می‌شود (شاهدِ مثبتِ یافتنِ روبه‌جلو).
- یافتنِ آیه: تطابقِ جزئیِ کوتاه (۸–۲۳ حرف از آیهٔ بلند) مدرکِ
  یافتن نیست؛ آیهٔ کوتاه با تطابقِ کاملِ رشته‌اش پیدا می‌شود.
- سه‌وضعیتی: partial موقت (provisional، بی‌confidence)؛ کلمهٔ
  پایدار (stable)؛ کلمهٔ پایانیِ finish (final). تصمیمِ دوم برای
  همان خانه، `correction` است با `corrects_event_id`، نه duplicate.
- پیش‌نمایش (§۱۴٫۱): partial فقط برای واحدِ اشاره‌گرِ قطعی است؛
  با اصلاحِ فرضیه پس گرفته می‌شود (`retracted: true`) و هرگز در
  `finish()` شمرده نمی‌شود.
- تکرار/برگشت: بازخوانیِ واحدِ صادرشده رویداد `repeat` می‌آید و
  اشاره‌گر را جلو نمی‌برد؛ بازخوانیِ آیهٔ پیش‌تر رویداد `revisit`
  می‌آید و نشست به عقب نمی‌رود.
- «نزدیک» در مرزِ بیشینهٔ فاصله، پرچمِ `needs_review` می‌خورد؛
  کلمهٔ ناتمامِ انتهای ضبطِ (align_phonemes) «جاافتاده» با
  `needs_review` است، نه «غلط».
- آیهٔ بدون نگاشت در مسیر زنده خطای صادقانهٔ ۵۰۳ می‌دهد.

آزمون‌های دادهٔ واقعی (فقط وقتی QURAN_PHONEME_MAP_DIR تنظیم شده
باشد): همان سناریوهای سورهٔ ۲۴ با رشته‌های واجیِ واقعی.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.errors import APIError
from app.modules.quran import hifz_service
from app.modules.quran.alignment import align_phonemes
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import (
    LiveSession,
    locate_ayah,
)

_AYAH_WORDS = {
    1: ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"],
    2: ["اللَّهُ", "الصَّمَدُ"],
    3: ["لَمْ", "يَلِدْ", "وَلَمْ", "يُولَدْ"],
    4: ["وَلَمْ", "يَكُن", "لَّهُ", "كُفُوًا", "أَحَدٌ"],
}

_FAKE_SEGMENTS = {
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


class _FakeMapping:
    """نگاشت مصنوعیِ قطعه‌ای (فقط سورهٔ ۱۱۲)."""

    def segments_for(self, surah, ayah):
        if surah != 112:
            return None
        return list(_FAKE_SEGMENTS.get(ayah, [])) or None


def _fake_mapping():
    return _FakeMapping()


async def _fake_ayah_words(db, surah: int, ayah: int):
    assert surah == 112
    return list(_AYAH_WORDS[ayah])


def _session(monkeypatch, events=None, mapping=None, start_ayah=1):
    stored = []

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        stored.append((ayah, [(w.word_index, w.status) for w in aligned], list(extra)))
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", _fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    attempt = SimpleNamespace(id=uuid.uuid4())
    events = events if events is not None else []
    session = LiveSession(
        db=None,
        attempt=attempt,
        surah=112,
        start_ayah=start_ayah,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=mapping,
    )
    session._ayah = start_ayah
    session._words = list(_AYAH_WORDS[start_ayah])
    session._index = 0
    session._touch(start_ayah)
    return session, stored


def _word_events(events):
    return [e for e in events if e["type"] == "word"]


# ---------------------------------------------------------------------------
# یافتنِ آیه: کفِ اثبات
# ---------------------------------------------------------------------------


def test_locate_ayah_short_partial_match_is_not_evidence():
    """تطابقِ جزئیِ ۱۲حرفی با آیهٔ ۳ (رشتهٔ ۱۸حرفی) مدرکِ یافتن نیست؛
    بافرِ کوتاه‌تر از ۲۴ حرف هم اصلاً یافتن نمی‌شود (ایمنی)؛ کاوشِ
    ۴۰حرفی که تمامِ آیهٔ ۳ را دارد، آن را پیدا می‌کند."""
    mapping = _fake_mapping()
    # پیش از اصلاح، همین بافرِ ۱۲حرفی (۳، ۰) برمی‌گرداند (found_len=۱۲).
    assert locate_ayah(mapping, 112, "lamyalidwala", hint_ayah=1) is None
    # بافرِ ۱۸حرفی (تمامِ آیهٔ ۳) ولی کوتاه‌تر از کفِ ۲۴ حرف: None.
    assert locate_ayah(mapping, 112, "lamyalidwalamyulad", hint_ayah=1) is None
    buf = "lamyalidwalamyulad" + "walamyakunlahukufuwanahad"
    assert locate_ayah(mapping, 112, buf, hint_ayah=1) == (3, 0)
    assert locate_ayah(mapping, 112, "zzzzzzzzzzzzzzzzzzzzzzzz", hint_ayah=1) is None


# ---------------------------------------------------------------------------
# عیبِ سورهٔ ۲۴: سورهٔ دیگر، آیهٔ نخوانده نمی‌نویسد
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_feed_phonemes_mid_session_switch_marks_wrong_not_skipped(monkeypatch):
    """تعویضِ وسطِ نشست به واجِ بی‌ربط: کلمه‌های بعد «غلط» می‌خورند،
    نه خاکستری. این همان حفرهٔ اصلاحِ #114 بود: پرچمِ
    `_locate_failed` فقط در فازِ یافتن بالا می‌رفت؛ وسطِ نشست که
    لنگر انداخته بود، شاخهٔ ۲برابر بدونِ هیچ مدرکی خاکستری می‌کرد."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(["q", "u", "l"])
    assert [(w["expected"], w["status"]) for w in _word_events(events)] == [
        ("قُلْ", "correct")
    ]
    await session.feed_phonemes(["z"] * 30)
    words = _word_events(events)
    assert all(w["status"] != "skipped" for w in words)
    assert [(w["expected"], w["status"]) for w in words[1:]] == [
        ("هُوَ", "wrong"),
        ("اللَّهُ", "wrong"),
        ("أَحَدٌ", "wrong"),
        ("اللَّهُ", "wrong"),
        ("الصَّمَدُ", "wrong"),
        ("لَمْ", "wrong"),
    ]
    assert session.live_counts()["buffer_chars"] == 6
    assert session.live_counts()["skipped"] == 0
    assert session._ayah == 3


@pytest.mark.asyncio
async def test_feed_phonemes_shared_word_ahead_is_not_a_skip(monkeypatch):
    """کلمهٔ مشترکِ جلوتر (مثل «اللَّهِ» فاتحه با «اللَّهِ» ۲۴:۲) به‌تنهایی
    پرش نیست: بافر با «alah» شروع می‌شود ولی ادامه‌اش («zzzz») با واحدِ
    بعد («ahad») نمی‌خواند — پس «هُوَ» غلط می‌خورد، نه خاکستری."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(["q", "u", "l"])
    await session.feed_phonemes(list("alah" + "z" * 30))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words if w["ayah"] == 1] == [
        ("قُلْ", "correct"),
        ("هُوَ", "wrong"),
        ("اللَّهُ", "wrong"),
        ("أَحَدٌ", "wrong"),
    ]
    assert all(w["status"] != "skipped" for w in words)


@pytest.mark.asyncio
async def test_feed_phonemes_lost_exact_match_needs_next_word(monkeypatch):
    """وقتی نشست گم شده (_locate_failed)، تطابقِ دقیقِ تک‌واحدی هم
    مدرک نیست: بافر با واحدِ جاری («yalid») می‌خواند ولی ادامه‌اش
    («zzzz») با واحدِ بعد («walam») نمی‌خواند — پس غلط می‌خورد،
    نه درست."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(list("z" * 30))
    await session.feed_phonemes(list("yalid" + "z" * 10))
    words = _word_events(events)
    assert all(w["status"] != "skipped" for w in words)
    assert all(w["status"] != "correct" for w in words)


@pytest.mark.asyncio
async def test_confirm_following_needs_two_units(monkeypatch):
    """_confirm_following: بقیهٔ بافر باید با واحدِ بعد بخواند — دقیق،
    پیشوند، یا نزدیک؛ بقیهٔ خالی/کوتاه = هنوز نمی‌دانیم (None)."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    session._units = await session._load_units(1)
    session._unit_pos = 0
    # واحدِ بعد از ۰، «huwa» است.
    assert session._confirm_following("huwa", 0) is True
    assert session._confirm_following("huw", 0) is True
    assert session._confirm_following("huxa", 0) is True  # نزدیکِ ۱ حرف
    assert session._confirm_following("zzzz", 0) is False
    assert session._confirm_following("", 0) is None
    assert session._confirm_following("h", 0) is None
    # واحدِ آخرِ آیه: واحدِ بعد، سرِ آیهٔ بعد است («alah»).
    assert session._confirm_following("alah", 3) is True
    assert session._confirm_following("zzzz", 3) is False


@pytest.mark.asyncio
async def test_feed_phonemes_legit_forward_skip_still_grays(monkeypatch):
    """پرشِ مشروعِ درونِ سوره (آیهٔ ۱ بعد آیهٔ ۳، با بافرِ بلندِ
    آیهٔ ۳): آیهٔ ۲ خاکستری می‌شود و آیهٔ ۳ درست می‌خورد — شاهدِ
    مثبتِ یافتنِ روبه‌جلو، خاکستری را نگه می‌دارد."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    # رشته‌های بلند و متمایز لازم‌اند تا یافتنِ روبه‌جلو مدرک داشته
    # باشد؛ نگاشتِ مصنوعیِ کوتاهِ _FAKE_SEGMENTS برای این آزمون
    # کافی نیست، پس واحدهای آیهٔ ۳ را بلند می‌کنیم.
    long_segs = {
        1: [Segment((0,), "qul"), Segment((1,), "huwa")],
        2: [Segment((0,), "alah"), Segment((1,), "samad")],
        3: [
            Segment((0,), "lam" + "x" * 25),
            Segment((1,), "yalid" + "y" * 25),
        ],
    }

    class _LongMapping:
        def segments_for(self, surah, ayah):
            if surah != 112:
                return None
            return list(long_segs.get(ayah, [])) or None

    session.mapping = _LongMapping()
    session._words = ["قُلْ", "هُوَ"]
    await session.feed_phonemes(list("qulhuwa"))
    await session.feed_phonemes(list("lam" + "x" * 25 + "yalid" + "y" * 25))
    words = _word_events(events)
    assert [(w["ayah"], w["status"]) for w in words] == [
        (1, "correct"),
        (1, "correct"),
        (2, "skipped"),
        (2, "skipped"),
        (3, "correct"),
        (3, "correct"),
    ]


# ---------------------------------------------------------------------------
# سه‌وضعیتی + correction + پیش‌نمایش
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_word_events_carry_finality_and_partial_has_no_confidence(monkeypatch):
    """هر خروجیِ confidence وضعیتِ provisional/stable/final دارد؛
    partial اصلاً confidence ندارد (prob جعلی از واج ساخته نمی‌شود)."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(["q", "u"])
    partials = [e for e in events if e["event_type"] == "partial"]
    assert len(partials) == 1
    assert partials[0]["finality"] == "provisional"
    assert "confidence" not in partials[0]
    assert partials[0]["expected"] == "قُلْ"
    await session.feed_phonemes(["l"])
    words = _word_events(events)
    assert len(words) == 1
    assert words[0]["event_type"] == "stable_word"
    assert words[0]["finality"] == "stable"
    assert words[0]["confidence"] == 0.95
    await session.finish()
    finals = [e for e in events if e["event_type"] == "final_word"]
    assert len(finals) == 3
    assert all(e["finality"] == "final" for e in finals)
    assert all(e["status"] == "skipped" for e in finals)


@pytest.mark.asyncio
async def test_emit_word_second_decision_is_correction(monkeypatch):
    """تصمیمِ دوم برای همان خانه، correction است با corrects_event_id؛
    duplicate نمی‌ماند و _assigned یک ورودی دارد."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    session._emit_word(1, 0, "قُلْ", "correct", 0.95, "قُلْ")
    first = events[-1]
    assert first["event_type"] == "stable_word"
    session._emit_word(1, 0, "قُلْ", "close", 0.65, "قُلْ", "wrong_word")
    second = events[-1]
    assert second["event_type"] == "correction"
    assert second["type"] == "correction"
    assert second["corrects_event_id"] == first["event_id"]
    assert second["finality"] == "stable"
    assert len(_word_events(events)) == 1
    assert len(session._assigned) == 1
    assert session._assigned[(1, 0)] == ("قُلْ", 0.65)


@pytest.mark.asyncio
async def test_partial_retracted_when_hypothesis_changes(monkeypatch):
    """پیش‌نمایشِ «قُلْ» با بافرِ «qu» می‌آید؛ وقتی بافر «quzzzz»
    شد (دیگر پیشوندِ واحد نیست)، پس گرفته می‌شود و هیچ کلمهٔ
    پایداری برای آن خانه صادر نمی‌شود."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(["q", "u"])
    assert len([e for e in events if e["event_type"] == "partial"]) == 1
    await session.feed_phonemes(["z", "z", "z", "z"])
    retracted = [
        e for e in events
        if e["event_type"] == "partial" and e.get("retracted") is True
    ]
    assert len(retracted) == 1
    assert retracted[0]["ayah"] == 1 and retracted[0]["word_index"] == 0
    assert retracted[0]["status"] == "retracted"
    assert retracted[0]["finality"] == "provisional"
    assert _word_events(events) == []
    assert (1, 0) not in session._assigned


@pytest.mark.asyncio
async def test_partial_never_counts_toward_finish(monkeypatch):
    """پیش‌نمایش در _assigned نیست و پیش از finish هیچ کلمه‌ای
    برای آن خانه صادر نشده است."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(["q", "u"])
    assert (1, 0) not in session._assigned
    assert _word_events(events) == []
    assert session.live_counts()["words"] == 0


# ---------------------------------------------------------------------------
# تکرار / برگشت
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repeat_word_is_reported_not_rewritten(monkeypatch):
    """بازخوانیِ «قُلْ» پس از صدور: رویداد `repeat` می‌آید، کلمه
    دوباره نوشته نمی‌شود و خواندنِ «هُوَ» بعدش درست می‌خورد."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(["q", "u", "l"])
    await session.feed_phonemes(["q", "u", "l"])
    await session.feed_phonemes(["h", "u", "w", "a"])
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
    ]
    repeats = [e for e in events if e["event_type"] == "repeat"]
    assert len(repeats) == 1
    assert repeats[0]["ayah"] == 1 and repeats[0]["word_index"] == 0
    assert repeats[0]["expected"] == "قُلْ"
    assert session.live_counts()["repeats"] == 1


@pytest.mark.asyncio
async def test_revisit_earlier_ayah_is_reported(monkeypatch):
    """بازخوانیِ آیهٔ ۱ وقتی اشاره‌گر روی آیهٔ ۳ است: رویداد
    `revisit` می‌آید، نشست به عقب نمی‌رود و هیچ کلمه‌ای برای
    آیهٔ ۳ علامت نمی‌خورد."""
    from app.modules.quran import hifz_stream
    from app.modules.quran import service as quran_service

    words = {a: [f"w{a}a", f"w{a}b"] for a in range(1, 9)}
    segs = {}
    for a in range(1, 9):
        letter = chr(ord("a") + a - 1)
        segs[a] = [
            Segment((0,), letter * 3 + "m" * 10),
            Segment((1,), letter * 3 + "n" * 10),
        ]

    class _WideMapping:
        def segments_for(self, surah, ayah):
            if surah != 112:
                return None
            return list(segs.get(ayah, [])) or None

    async def _wide_ayah_words(db, surah, ayah):
        return list(words[ayah])

    real_get_surah = quran_service.get_surah

    def _wide_get_surah(number):
        if number == 112:
            return SimpleNamespace(ayahs=8)
        return real_get_surah(number)

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", _wide_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    monkeypatch.setattr(hifz_stream.quran_service, "get_surah", _wide_get_surah)

    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_WideMapping(),
    )
    session._ayah = 1
    session._words = list(words[1])
    session._index = 0
    session._touch(1)
    phon1 = "".join(s.phoneme for s in segs[1])
    phon2 = "".join(s.phoneme for s in segs[2])
    await session.feed_phonemes(list(phon1))
    await session.feed_phonemes(list(phon2))
    assert session._ayah == 2
    await session.feed_phonemes(list(phon1))
    revisits = [e for e in events if e["event_type"] == "revisit"]
    assert len(revisits) >= 1
    assert revisits[0]["ayah"] == 1
    assert session._ayah == 3
    assert [w for w in _word_events(events) if w["ayah"] == 3] == []
    assert session.live_counts()["revisits"] >= 1


# ---------------------------------------------------------------------------
# needs_review + کلمهٔ ناتمام + آیهٔ بدون نگاشت
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_close_at_max_distance_needs_review(monkeypatch):
    """«نزدیک» با فاصلهٔ ۲ (مرزِ بیشینه) پرچمِ needs_review دارد؛
    با فاصلهٔ ۱ ندارد."""

    class _AnchorMapping:
        def segments_for(self, surah, ayah):
            if surah != 112 or ayah != 1:
                return None
            return [
                Segment((0,), "qulhu"),
                Segment((1,), "huwa"),
                Segment((2,), "alah"),
                Segment((3,), "ahad"),
            ]

    for heard_first, flagged in (("qxxhu", True), ("quxhu", False)):
        events = []
        session, _ = _session(monkeypatch, events, mapping=_AnchorMapping())
        await session.feed_phonemes(
            list(heard_first) + ["h", "u", "w", "a"]
            + ["a", "l", "a", "h"] + ["a", "h", "a", "d"]
        )
        words = _word_events(events)
        assert words[0]["status"] == "close"
        assert words[0].get("needs_review", False) is flagged


def test_align_phonemes_trailing_partial_is_skipped_needs_review():
    """ضبط وسطِ کلمه تمام شده: کلمهٔ ناتمام «جاافتاده» با
    needs_review است، نه «غلط»؛ بقیه هم جاافتاده‌اند و بافرِ مانده
    به extra می‌رود."""
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    units = [
        ((0,), "qul"),
        ((1,), "huwa"),
        ((2,), "alah"),
        ((3,), "ahad"),
    ]
    aligned, extra = align_phonemes(expected, units, "qulhu")
    assert [(w.status, w.needs_review) for w in aligned] == [
        ("correct", False),
        ("skipped", True),
        ("skipped", False),
        ("skipped", False),
    ]
    assert extra == ["hu"]


def test_align_phonemes_close_at_max_distance_needs_review():
    """در مسیر ضبطی هم «نزدیک» با فاصلهٔ ۲ پرچم دارد، با فاصلهٔ ۱ نه."""
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    units = [
        ((0,), "qul"),
        ((1,), "huwa"),
        ((2,), "alah"),
        ((3,), "ahad"),
    ]
    aligned, _ = align_phonemes(expected, units, "qulhuxxalahahad")
    assert aligned[1].status == "close"
    assert aligned[1].needs_review is True
    aligned, _ = align_phonemes(expected, units, "qulhuxaalahahad")
    assert aligned[1].status == "close"
    assert aligned[1].needs_review is False


@pytest.mark.asyncio
async def test_feed_phonemes_unmapped_ayah_raises_503(monkeypatch):
    """آیهٔ بدون نگاشت در مسیر زنده: خطای صادقانهٔ ۵۰۳، بدونِ هیچ
    کلمه‌ای."""

    class _NoMapping:
        def segments_for(self, surah, ayah):
            return None

    events = []
    session, _ = _session(monkeypatch, events, mapping=_NoMapping())
    with pytest.raises(APIError) as exc:
        await session.feed_phonemes(["q", "u", "l"])
    assert exc.value.status_code == 503
    assert exc.value.code == "hifz_mapping_ayah_unavailable"
    assert _word_events(events) == []


# ---------------------------------------------------------------------------
# دادهٔ واقعی (فقط با متغیر محیطی)
# ---------------------------------------------------------------------------

_REAL_DIR = os.environ.get("QURAN_PHONEME_MAP_DIR")
_TANZIL = Path(__file__).resolve().parent.parent / (
    "app/modules/quran/data/tanzil_uthmani.txt"
)


def _tanzil_words():
    out: dict = {}
    for line in _TANZIL.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            out[(int(parts[0]), int(parts[1]))] = parts[2].split()
    return out


def _real_session(mapping, surah, start_ayah):
    from app.modules.quran.hifz_stream import LiveSession

    words = _tanzil_words()
    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=surah,
        start_ayah=start_ayah,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=mapping,
    )
    session._ayah = start_ayah
    session._words = list(words[(surah, start_ayah)])
    session._index = 0
    session._touch(start_ayah)
    session._locating = True
    return session, events


async def _feed_real(session, text):
    chars = list(text)
    for i in range(0, len(chars), 40):
        await session.feed_phonemes(chars[i : i + 40])


def _expected_phonemes(mapping, surah, ayah):
    from app.modules.quran.hifz_mapping import collapse_phoneme_runs

    segs = mapping.segments_for(surah, ayah)
    assert segs, f"no mapping for {surah}:{ayah}"
    return "".join(
        collapse_phoneme_runs(s.phoneme) for s in segs if s.phoneme is not None
    )


# نشانه‌های وقف/سجده که در متنِ تنزیل توکنِ جدا هستند و قطعهٔ واجی
# ندارند: اشاره‌گر با رد شدن از آن‌ها، خودکار خاکستری‌شان می‌کند
# (ردِ خودکار، نه «جاافتاده»ٔ ناشی از پرش). تنها «جاافتاده»ٔ مجاز
# در سناریوهای سورهٔ اشتباه همین‌هاست.
PAUSE_MARKS = {"ۖ", "ۗ", "ۘ", "ۙ", "ۚ", "ۛ", "ۜ", "۩"}


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
@pytest.mark.asyncio
async def test_real_wrong_surah_never_writes_unrecited_ayahs(monkeypatch):
    """بازتولیدِ عیبِ سورهٔ ۲۴ با رشته‌های واجیِ واقعی: خواندنِ کاملِ
    فاتحه در برابر سورهٔ ۲۴، هیچ کلمه‌ای را خاکستری نمی‌نویسد و
    نشست به آیهٔ دیگری نمی‌پرد."""
    from app.modules.quran import hifz_service
    from app.modules.quran.hifz_mapping import load_phoneme_mapping

    async def _fake_ayah_words(db, surah: int, ayah: int):
        return list(_tanzil_words()[(surah, ayah)])

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", _fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    mapping = load_phoneme_mapping()
    fatiha = "".join(_expected_phonemes(mapping, 1, a) for a in range(1, 8))
    session, events = _real_session(mapping, 24, 1)
    await _feed_real(session, fatiha)
    words = _word_events(events)
    assert [e for e in events if e["type"] == "located"] == []
    # فقط بسمله (که واقعاً خوانده شده — ۴ کلمهٔ اولِ آیهٔ ۱) درست
    # است؛ بقیه غلط‌اند. تنها خاکستریِ مجاز، نشانهٔ وقف است که
    # اشاره‌گر با رد شدن از آن، خودکار خاکستری‌اش می‌کند.
    correct = [w for w in words if w["status"] == "correct"]
    assert [(w["ayah"], w["word_index"]) for w in correct] == [
        (1, 0),
        (1, 1),
        (1, 2),
        (1, 3),
    ]
    assert all(
        w["expected"] in PAUSE_MARKS
        for w in words
        if w["status"] == "skipped"
    )
    assert all(w["status"] in ("correct", "wrong", "skipped") for w in words)


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
@pytest.mark.asyncio
async def test_real_mid_session_switch_marks_wrong_not_skipped(monkeypatch):
    """۲۴:۱ درست خوانده می‌شود، بعد فاتحه: هیچ کلمه‌ای از آیهٔ ۲
    به بعد خاکستری نمی‌شود."""
    from app.modules.quran import hifz_service
    from app.modules.quran.hifz_mapping import load_phoneme_mapping

    async def _fake_ayah_words(db, surah: int, ayah: int):
        return list(_tanzil_words()[(surah, ayah)])

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", _fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    mapping = load_phoneme_mapping()
    fatiha = "".join(_expected_phonemes(mapping, 1, a) for a in range(1, 8))
    session, events = _real_session(mapping, 24, 1)
    await _feed_real(session, _expected_phonemes(mapping, 24, 1))
    assert all(
        w["status"] == "correct"
        for w in _word_events(events)
        if w["ayah"] == 1 and w["expected"] != "ۚ"
    )
    await _feed_real(session, fatiha)
    words = _word_events(events)
    # از آیهٔ ۲ به بعد: هیچ کلمه‌ای «درست» نمی‌شود (کلمهٔ مشترکِ دو
    # سوره به‌تنهایی مدرک نیست) و هیچ کلمهٔ واقعی‌ای خاکستری نمی‌شود؛
    # تنها خاکستریِ مجاز، نشانهٔ وقفِ ردِ خودکار است.
    assert all(w["status"] != "correct" for w in words if w["ayah"] >= 2)
    assert all(
        w["expected"] in PAUSE_MARKS
        for w in words
        if w["ayah"] >= 2 and w["status"] == "skipped"
    )
    assert any(w["status"] == "wrong" for w in words if w["ayah"] >= 2)


@pytest.mark.skipif(not _REAL_DIR, reason="real mapping dir not configured")
@pytest.mark.asyncio
async def test_real_legit_skip_still_grays_within_five(monkeypatch):
    """پرشِ مشروعِ ۲۴:۱ ← ۲۴:۳ با دادهٔ واقعی: آیهٔ ۲ کامل
    خاکستری می‌شود و آیهٔ ۳ نمره می‌گیرد."""
    from app.modules.quran import hifz_service
    from app.modules.quran.hifz_mapping import load_phoneme_mapping

    async def _fake_ayah_words(db, surah: int, ayah: int):
        return list(_tanzil_words()[(surah, ayah)])

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", _fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    mapping = load_phoneme_mapping()
    session, events = _real_session(mapping, 24, 1)
    await _feed_real(session, _expected_phonemes(mapping, 24, 1))
    await _feed_real(session, _expected_phonemes(mapping, 24, 3))
    words = _word_events(events)
    ayah2 = [w for w in words if w["ayah"] == 2]
    assert len(ayah2) == len(_tanzil_words()[(24, 2)])
    assert all(w["status"] == "skipped" for w in ayah2)
    ayah3 = [w for w in words if w["ayah"] == 3]
    assert sum(1 for w in ayah3 if w["status"] == "correct") >= 17
    assert all(w["status"] != "wrong" for w in ayah3)
