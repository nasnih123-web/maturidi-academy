"""تست‌های جریان زندهٔ حفاظ (بازبینی فاز ۳: صفحهٔ خالی + رنگ زنده).

پوشش (بدون مدل واقعی، بدون دانلود):
- تراز زندهٔ حریصانه: تطابق دقیق، جاافتادگی وسط کلمه و کل آیه با
  ادامهٔ نوشتن پس از آن (خاکستری + ادامه)، کلمهٔ اضافه، نزدیک/غلط.
- واج‌به‌کلمه با نگاشت مصنوعیِ قطعه‌ای تست (نه دادهٔ واقعی): تطابق
  دقیق، جاافتادگی + ادامه، و پایان جریان که بقیهٔ آیهٔ جاری را
  جاافتاده می‌کند ولی آیهٔ بعد را لمس نمی‌کند.
- نبود نگاشت: require_phoneme_mapping با مسیر پیکربندی‌نشده ۵۰۳
  hifz_word_alignment_pending می‌دهد؛ feed_phonemes بدون نگاشت هم.
- حلقهٔ WebSocket با سوکت و بازشناسِ ساختگی: رویدادهای کلمه (با
  خاکستری پس از جاافتادگی)، پیام final، بستن ۱۰۰۰، و ذخیرهٔ نشست.
- قاب‌های مانده از پیش از شروع نشست دور ریخته می‌شوند (فقط قاب‌های
  زنده خورانده می‌شوند)؛ قدم‌های کند شروع نشست در
  `_slow_start_steps` جدا می‌شوند.
- دروازهٔ `is_ready` در `SherpaPhonemeStream` (با sherpaی ساختگی):
  دیکد فقط وقتی چانک کامل آماده است، و واج‌ها از JSON نتیجهٔ رسمی
  sherpa-onnx 2.0.1 خوانده می‌شوند.
- شمارنده‌های جلسهٔ زنده (فقط تعداد): کلمه‌ها/جاافتاده‌ها و طول بافر.
- خطای ناشناختهٔ feed/flush: لاگ ERROR با traceback + پیام خطا به
  کلاینت (نه قطع بی‌صدا)؛ هشدار پایان نشست برای قابِ بدون واج و
  واجِ بدون هیچ کلمه‌ای.
- یکپارچگی با دیتابیس واقعی (tc): جریان زنده → پایان → جزئیات نشست
  از HTTP، نمره‌ها و خاکستری پس از آیهٔ جاافتاده در جدول‌ها هستند.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from types import SimpleNamespace

import pytest
from fastapi import WebSocketDisconnect

from app.modules.quran import hifz_service
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import (
    LiveSession,
    LiveUnavailableError,
    MappingPendingError,
    SherpaPhonemeStream,
    StreamWord,
    locate_ayah,
    require_phoneme_mapping,
)

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"

# کلمه‌های موردانتظار مصنوعی برای سورهٔ ۱۱۲ (فقط برای آزمون تراز).
_AYAH_WORDS = {
    1: ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"],
    2: ["اللَّهُ", "الصَّمَدُ"],
    3: ["لَمْ", "يَلِدْ", "وَلَمْ", "يُولَدْ"],
    4: ["وَلَمْ", "يَكُن", "لَّهُ", "كُفُوًا", "أَحَدٌ"],
}

# نگاشت مصنوعیِ قطعه‌ای برای آزمون الگوریتم (نه دادهٔ واقعی).
# هر قطعه → یک رشتهٔ واجیِ ساختگی؛ شاخص‌ها با _AYAH_WORDS می‌خوانند.
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
    """نشست زندهٔ واحدی با _ayah_words و _store_grade ساختگی."""
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
# تراز زندهٔ سطح کلمه
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_words_exact_then_skip_then_continue(monkeypatch):
    """جاافتادگی وسط آیه خاکستری می‌شود و نوشتن ادامه پیدا می‌کند."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_words(
        [StreamWord("قُلْ", 0.95), StreamWord("هُوَ", 0.9), StreamWord("أَحَدٌ", 0.92)]
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "skipped"),
        ("أَحَدٌ", "correct"),
    ]
    assert words[2]["prob"] == 0.0 and words[2]["heard"] is None


@pytest.mark.asyncio
async def test_live_words_whole_ayah_skipped_then_next_ayah_grades(monkeypatch):
    """آیهٔ کاملاً جاافتاده خاکستری می‌شود؛ آیهٔ بعد هنوز نمره می‌گیرد."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_words([StreamWord("قُلْ", 0.95)])
    # پرش مستقیم به کلمهٔ دوم آیهٔ ۲: بقیهٔ آیهٔ ۱ و کلمهٔ اول آیهٔ ۲
    # جاافتاده‌اند، ولی نوشتن ادامه پیدا می‌کند.
    await session.feed_words([StreamWord("الصَّمَدُ", 0.9)])
    words = _word_events(events)
    assert [(w["ayah"], w["expected"], w["status"]) for w in words] == [
        (1, "قُلْ", "correct"),
        (1, "هُوَ", "skipped"),
        (1, "اللَّهُ", "skipped"),
        (1, "أَحَدٌ", "skipped"),
        (2, "اللَّهُ", "skipped"),
        (2, "الصَّمَدُ", "correct"),
    ]


@pytest.mark.asyncio
async def test_live_words_extra_and_tashkeel_close(monkeypatch):
    """کلمهٔ اضافه روی دیوار نمی‌آید؛ اختلاف فقط تشکلی، close می‌گیرد."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_words(
        [
            StreamWord("سلام", 0.9),  # اضافه: با هیچ کلمهٔ آینده‌ای نمی‌خواند
            StreamWord("قُلْ", 0.95),
            StreamWord("هُو", 0.9),  # فقط تشکل با «هُوَ» فرق دارد
        ]
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "close"),
    ]
    # رویداد extra با پاکت نسخهٔ ۲ می‌آید (نه دیکشنریِ برهنهٔ قدیمی).
    extras = [e for e in events if e["type"] == "extra"]
    assert len(extras) == 1
    assert extras[0]["text"] == "سلام"
    assert extras[0]["event_type"] == "extra"
    assert extras[0]["session_id"] == str(session.attempt.id)
    assert extras[0]["sequence_no"] >= 1


@pytest.mark.asyncio
async def test_live_words_letter_near_miss_is_close(monkeypatch):
    """نزدیکِ یک‌حرفی (فاصلهٔ ویرایش ۱ در کلمهٔ بلند)، close می‌گیرد."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_words(
        [StreamWord("قُلْ", 0.95), StreamWord("هُوَ", 0.9), StreamWord("اللهم", 0.9)]
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "close"),
    ]


@pytest.mark.asyncio
async def test_live_finish_skips_rest_of_current_ayah_only(monkeypatch):
    """پایان: بقیهٔ آیهٔ جاری جاافتاده، آیهٔ بعد لمس نمی‌شود."""
    events = []
    session, stored = _session(monkeypatch, events)
    await session.feed_words([StreamWord("قُلْ", 0.95), StreamWord("هُوَ", 0.9)])
    summary = await session.finish()
    assert summary["ayahs"] == [1]
    assert summary["counts"] == {"correct": 2, "close": 0, "wrong": 0, "skipped": 2}
    assert stored == [
        (1, [(0, "correct"), (1, "correct"), (2, "skipped"), (3, "skipped")], [])
    ]


@pytest.mark.asyncio
async def test_live_finish_after_completed_ayah_does_not_skip_next(monkeypatch):
    """پس از آیهٔ کامل، پایان جریان آیهٔ بعد را جاافتاده نمی‌کند."""
    events = []
    session, stored = _session(monkeypatch, events)
    await session.feed_words(
        [
            StreamWord("قُلْ", 0.95),
            StreamWord("هُوَ", 0.9),
            StreamWord("اللَّهُ", 0.9),
            StreamWord("أَحَدٌ", 0.9),
        ]
    )
    summary = await session.finish()
    assert summary["ayahs"] == [1]
    assert summary["counts"]["skipped"] == 0
    assert len(stored) == 1 and stored[0][0] == 1


# ---------------------------------------------------------------------------
# واج‌به‌کلمه (نگاشت مصنوعی تست) + مسدود بودن نگاشت واقعی
# ---------------------------------------------------------------------------


def test_require_phoneme_mapping_is_pending(monkeypatch):
    """بدون مسیر پیکربندی‌شده، نگاشت ۵۰۳ صادقانه می‌دهد."""
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", "/nonexistent-dir-for-test")
    with pytest.raises(MappingPendingError) as exc:
        require_phoneme_mapping()
    assert exc.value.code == "hifz_word_alignment_pending"
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_feed_phonemes_without_mapping_raises(monkeypatch):
    events = []
    session, _ = _session(monkeypatch, events)
    with pytest.raises(MappingPendingError):
        await session.feed_phonemes(["q", "u", "l"])
    assert _word_events(events) == []


@pytest.mark.asyncio
async def test_feed_phonemes_exact_skip_continue_with_fake_mapping(monkeypatch):
    """واج‌ها با نگاشت مصنوعی به کلمه تبدیل می‌شوند؛ جاافتادگی + ادامه."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    # قُلْ کامل، هُوَ جاافتاده (واج‌هایش نمی‌آیند)، اللَّهُ می‌آید.
    await session.feed_phonemes(
        ["q", "u", "l"]  # قُلْ
        + ["a", "l", "a", "h"]  # اللَّهُ (پس از رد هُوَ با پر شدن بافر)
        + ["a", "h", "a", "d"]  # أَحَدٌ
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "skipped"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]


@pytest.mark.asyncio
async def test_feed_phonemes_resync_after_misread_word(monkeypatch):
    """یک کلمهٔ غلط‌خوانده‌شده در ابتدا، بقیه را مسموم نمی‌کند:
    واج‌های اضافی دور ریخته می‌شوند و کلمه‌های بعد هم‌تراز می‌شوند."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    # واج‌های یک کلمهٔ غلط (zzzz) + واج‌های درستِ هُوَ، اللَّهُ، أَحَدٌ.
    await session.feed_phonemes(
        ["z", "z", "z", "z"]  # کلمهٔ غلط به‌جای قُلْ
        + ["h", "u", "w", "a"]  # هُوَ
        + ["a", "l", "a", "h"]  # اللَّهُ
        + ["a", "h", "a", "d"]  # أَحَدٌ
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "skipped"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 4


@pytest.mark.asyncio
async def test_feed_phonemes_wrong_surahm_does_not_write_unrecited_ayahs(monkeypatch):
    """خواندنِ چیزی که با سوره نمی‌خواند، آیه‌های نخوانده را نمی‌نویسد.

    عیبِ گزارش‌شده (سورهٔ ۲۴، ۲۰۲۶-۱۱-۰۶): کاربر چیزِ دیگری خواند و
    تطبیق‌دهنده ۵۳ کلمه را خاکستری (جاافتاده) نوشت و جلو رفت. رفتارِ
    درست (پرمیوم): واج‌های بی‌تطابق، کلمهٔ جاری را «غلط» (قرمز) علامت
    می‌زنند و یک طولِ کلمه مصرف می‌کنند؛ اشاره‌گر فقط به‌اندازهٔ
    واج‌های شنیده‌شده جلو می‌رود و هیچ کلمه‌ای خاکستری نمی‌شود.
    واج‌های «z» با هیچ قطعهٔ نگاشتِ مصنوعی نمی‌خوانند.
    """
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    # مثل شروعِ واقعی: نشست در حالتِ یافتن است.
    session._locating = True
    await session.feed_phonemes(["z"] * 30)
    words = _word_events(events)
    assert [(w["ayah"], w["expected"], w["status"]) for w in words] == [
        (1, "قُلْ", "wrong"),
        (1, "هُوَ", "wrong"),
        (1, "اللَّهُ", "wrong"),
        (1, "أَحَدٌ", "wrong"),
        (2, "اللَّهُ", "wrong"),
        (2, "الصَّمَدُ", "wrong"),
        (3, "لَمْ", "wrong"),
    ]
    # هیچ خاکستری‌ای نیست و هم‌ترازیِ دوباره هم چیزی دور نریخته است.
    assert all(w["status"] != "skipped" for w in words)
    assert session.live_counts()["resync_dropped"] == 0
    # بافرِ مانده کوتاه‌تر از یک کلمهٔ کامل است: نشست منتظرِ واجِ
    # بیشتر می‌ماند، نه اینکه جلو برود.
    assert session.live_counts()["buffer_chars"] == 3


@pytest.mark.asyncio
async def test_feed_phonemes_madd_length_ignored(monkeypatch):
    """کششِ مد (شمارِ الف/الف خنجری) در تطابق اثر نمی‌کند: نگاشت
    ۴ الف خنجری می‌نویسد، بازشناس ۲ تا می‌شنود، کلمه درست می‌خورد
    و کلمه‌های بعد هم سر جایشان می‌مانند (نه نزدیک، نه جاافتاده)."""
    events = []

    class _MaddMapping:
        def segments_for(self, surah, ayah):
            if surah != 112 or ayah != 1:
                return None
            return [
                Segment((0,), "ررَحِۦۦۦۦم"),  # قُلْ، با مدِ ۴ الف خنجری
                Segment((1,), "huwa"),
                Segment((2,), "alah"),
                Segment((3,), "ahad"),
            ]

    session, _ = _session(monkeypatch, events, mapping=_MaddMapping())
    await session.feed_phonemes(
        ["ررَ", "حِ", "ۦۦ", "م"]  # همان کلمه، با مدِ ۲ الف خنجری
        + ["h", "u", "w", "a"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 0


@pytest.mark.asyncio
async def test_feed_phonemes_close_anchored_on_next_word(monkeypatch):
    """کلمهٔ نزدیک با یک حرفِ اضافه در سرِ بافر: مصرف روی شروعِ
    واحدِ بعد لنگر می‌شود (len+1)، نه طولِ ثابتِ موردانتظار؛ پس
    کلمه‌های بعد دقیق می‌خورند و جابه‌جایی سرایت نمی‌کند."""
    events = []

    class _AnchorMapping:
        def segments_for(self, surah, ayah):
            if surah != 112 or ayah != 1:
                return None
            return [
                Segment((0,), "qulhu"),  # قُلْ، ۵ حرف (شرطِ len > 3)
                Segment((1,), "huwa"),
                Segment((2,), "alah"),
                Segment((3,), "ahad"),
            ]

    session, _ = _session(monkeypatch, events, mapping=_AnchorMapping())
    # حرفِ اضافهٔ 'x' در سرِ بافر (مثل حرکتِ پایانیِ کلمهٔ قبل در
    # وصل) + واج‌های درستِ هُوَ، اللَّهُ، أَحَدٌ.
    await session.feed_phonemes(
        ["x", "q", "u", "l", "h", "u"]
        + ["h", "u", "w", "a"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "close"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]


@pytest.mark.asyncio
async def test_feed_phonemes_waslah_hamza_optional(monkeypatch):
    """همزهٔ وصلِ اولِ کلمه در خواندنِ پیوسته اختیاری است: واحدی که
    با الفِ وصله شروع می‌شود، بی‌همزه هم درست می‌خورد؛ ولی همزهٔ
    قطع (leading_waslah=False) بی‌همزه درست نمی‌خورد."""
    events = []

    class _WaslahMapping:
        def segments_for(self, surah, ayah):
            if surah != 112 or ayah != 1:
                return None
            return [
                Segment((0,), "ءqulhu", leading_waslah=True),
                Segment((1,), "huwa"),
                Segment((2,), "alah"),
                Segment((3,), "ahad"),
            ]

    session, _ = _session(monkeypatch, events, mapping=_WaslahMapping())
    # واج‌ها بی‌همزه می‌آیند (خواندنِ پیوسته).
    await session.feed_phonemes(
        ["q", "u", "l", "h", "u"]
        + ["h", "u", "w", "a"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
    )
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]

    events2 = []

    class _QataMapping:
        def segments_for(self, surah, ayah):
            if surah != 112 or ayah != 1:
                return None
            return [
                Segment((0,), "ءqulhu", leading_waslah=False),
                Segment((1,), "huwa"),
                Segment((2,), "alah"),
                Segment((3,), "ahad"),
            ]

    session2, _ = _session(monkeypatch, events2, mapping=_QataMapping())
    await session2.feed_phonemes(
        ["q", "u", "l", "h", "u"]
        + ["h", "u", "w", "a"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
    )
    words2 = _word_events(events2)
    assert words2[0]["status"] != "correct"


# ---------------------------------------------------------------------------
# یافتنِ آیه از روی صدا + قانونِ خاکستریِ ≤۵ آیه
# ---------------------------------------------------------------------------


def test_locate_ayah_finds_start_ayah_from_phonemes():
    """یافتنِ آیه: واج‌های آیهٔ ۳ را با راهنمای ۱ پیدا می‌کند؛ بافرِ
    کوتاه یا بی‌ربط → None."""
    mapping = _fake_mapping()
    buf = "lamyalidwalamyulad" + "walamyakunlahukufuwanahad"
    assert locate_ayah(mapping, 112, buf, hint_ayah=1) == (3, 0)
    # همان آیهٔ راهنما هم پیدا می‌شود.
    buf1 = "qulhuwaalahahad" + "alahsamad"
    assert locate_ayah(mapping, 112, buf1, hint_ayah=1) == (1, 0)
    # بافرِ کوتاه‌تر از آستانه → None.
    assert locate_ayah(mapping, 112, "lamyalid", hint_ayah=1) is None
    # بافرِ بی‌ربط → None.
    assert locate_ayah(mapping, 112, "zzzzzzzzzzzzzzzzzzzzzzzz", hint_ayah=1) is None


def test_locate_ayah_prefers_hint_on_tie_and_none_when_ambiguous():
    """تساویِ دقیق: اگر راهنما در میانِ برندگان باشد همان برمی‌گردد،
    وگرنه مبهم است و None (نشست روی راهنما می‌ماند)."""
    shared = "abcdefghij0123456789abcd"

    class _TieMapping:
        def segments_for(self, surah, ayah):
            if surah != 112:
                return None
            if ayah == 1:
                return [Segment((0,), shared), Segment((1,), "diff11111")]
            if ayah == 2:
                return [Segment((0,), shared), Segment((1,), "diff22222")]
            return None

    mapping = _TieMapping()
    assert locate_ayah(mapping, 112, shared, hint_ayah=1) == (1, 0)
    assert locate_ayah(mapping, 112, shared, hint_ayah=3) is None


def _wide_session(monkeypatch, events=None, start_ayah=1):
    """نشستِ مصنوعی روی سورهٔ ۸آیه‌ایِ ۱۱۲ با رشته‌های واجیِ بلند و
    متمایز (هر آیه ۲ کلمه، ۲۶ حرفِ واجی؛ آیه‌ها با دست‌کم ۳ حرف از هم
    فرق می‌کنند تا قانونِ «نزدیک» به‌اشتباه لنگر نیندازد). برای
    آزمونِ یافتن/خاکستری لازم است، چون رشته‌های کوتاهِ _FAKE_SEGMENTS
    در هم‌ترازیِ دوباره جویده می‌شوند."""
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

    events = events if events is not None else []
    attempt = SimpleNamespace(id=uuid.uuid4())
    session = LiveSession(
        db=None,
        attempt=attempt,
        surah=112,
        start_ayah=start_ayah,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_WideMapping(),
    )
    session._ayah = start_ayah
    session._words = list(words[start_ayah])
    session._index = 0
    session._touch(start_ayah)
    return session, events, words, segs


@pytest.mark.asyncio
async def test_feed_phonemes_locates_start_ayah_when_hint_is_wrong(monkeypatch):
    """نشست با راهنمای آیهٔ ۱ ولی خواندن از آیهٔ ۳: نشست همان‌جا
    لنگر می‌اندازد، آیه‌های ۱ و ۲ خاکستری نمی‌شوند و کلمه‌ها شنیده
    می‌شوند (نه ۱۶۳۱ جاافتاده)."""
    events = []
    session, events, _words, segs = _wide_session(
        monkeypatch, events, start_ayah=1
    )
    session._locating = True
    phon3 = "".join(s.phoneme for s in segs[3])
    phon4 = "".join(s.phoneme for s in segs[4])
    await session.feed_phonemes(list(phon3 + phon4))
    words_out = _word_events(events)
    assert [w["ayah"] for w in words_out] == [3, 3, 4, 4]
    assert all(w["status"] == "correct" for w in words_out)
    assert session.live_counts()["skipped"] == 0
    assert session.live_counts()["located"] == 1
    located = [e for e in events if e["type"] == "located"]
    assert len(located) == 1
    assert located[0]["surah"] == 112 and located[0]["ayah"] == 3
    assert located[0]["event_type"] == "located"
    assert located[0]["sequence_no"] >= 1


@pytest.mark.asyncio
async def test_feed_phonemes_gray_skipped_within_five_ayahs(monkeypatch):
    """پرشِ ≤۵ آیه: آیهٔ جاافتاده خاکستری می‌شود و خواندن ادامه پیدا
    می‌کند؛ رویدادِ located نمی‌آید."""
    events = []
    session, events, _words, segs = _wide_session(
        monkeypatch, events, start_ayah=1
    )
    phon1 = "".join(s.phoneme for s in segs[1])
    phon3 = "".join(s.phoneme for s in segs[3])
    await session.feed_phonemes(list(phon1))
    await session.feed_phonemes(list(phon3))
    words_out = _word_events(events)
    assert [(w["ayah"], w["status"]) for w in words_out] == [
        (1, "correct"),
        (1, "correct"),
        (2, "skipped"),
        (2, "skipped"),
        (3, "correct"),
        (3, "correct"),
    ]
    assert session.live_counts()["located"] == 0
    assert [e for e in events if e["type"] == "located"] == []


@pytest.mark.asyncio
async def test_feed_phonemes_relocates_after_more_than_five_skipped_ayahs(
    monkeypatch,
):
    """پرشِ بیش از ۵ آیه: آیه‌های تا ۵ آیه خاکستری می‌شوند، ولی آیهٔ
    بعد از آن خاکستری نمی‌شود؛ نشست از نو می‌یابد و همان‌جا ادامه
    می‌دهد (رویداد `located`)."""
    events = []
    session, events, _words, segs = _wide_session(
        monkeypatch, events, start_ayah=1
    )
    phon1 = "".join(s.phoneme for s in segs[1])
    phon8 = "".join(s.phoneme for s in segs[8])
    await session.feed_phonemes(list(phon1))
    await session.feed_phonemes(list(phon8))

    words_out = _word_events(events)
    heard = [(w["ayah"], w["status"]) for w in words_out if w["status"] != "skipped"]
    skipped_ayahs = sorted({w["ayah"] for w in words_out if w["status"] == "skipped"})
    assert heard == [(1, "correct"), (1, "correct"), (8, "correct"), (8, "correct")]
    # فقط آیه‌های ۲ تا ۶ خاکستری‌اند (۵ آیه)؛ آیهٔ ۷ هرگز لمس نشد.
    assert skipped_ayahs == [2, 3, 4, 5, 6]
    assert 7 not in {w["ayah"] for w in words_out}
    assert session.live_counts()["located"] == 1
    located = [e for e in events if e["type"] == "located"]
    assert len(located) == 1
    assert located[0]["surah"] == 112 and located[0]["ayah"] == 8
    assert located[0]["event_type"] == "located"


def test_collapse_phoneme_runs_keeps_shadda():
    """فروپاشیِ کشش فقط الف/الف خنجری/واو کوچک را می‌گیرد؛ تشدید
    (تکرارِ همخوان) و بقیهٔ رشته دست نمی‌خورد."""
    from app.modules.quran.hifz_mapping import collapse_phoneme_runs

    assert collapse_phoneme_runs("ررَحِۦۦۦۦم") == "ررَحِۦم"
    assert collapse_phoneme_runs("ضضَااااااللِۦۦۦۦن") == "ضضَاللِۦن"
    assert collapse_phoneme_runs("ررَ") == "ررَ"
    assert collapse_phoneme_runs("للَ") == "للَ"
    assert collapse_phoneme_runs("") == ""


@pytest.mark.asyncio
async def test_live_counts_only_counts_words_and_skips(monkeypatch):
    """شمارنده‌های جلسه: کلمه‌های درست/نزدیک جدا از جاافتاده‌ها؛ بافر خالی."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(
        ["q", "u", "l"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
    )
    assert session.live_counts() == {
        "words": 3,
        "skipped": 1,
        "buffer_chars": 0,
        "resync_dropped": 0,
        "located": 0,
        "repeats": 0,
        "revisits": 0,
    }


# ---------------------------------------------------------------------------
# حلقهٔ WebSocket با سوکت و بازشناسِ ساختگی
# ---------------------------------------------------------------------------


class _FakeWebSocket:
    """سوکت ساختگی: پیام‌های ازپیش‌نوشته‌شده را می‌دهد، ارسال‌ها را ضبط می‌کند.

    `stale` یعنی چند پیامِ اول از پیش در صف‌اند (قاب‌های مانده از پیش
    از شروع نشست) و بی‌درنگ برمی‌گردند؛ بقیه «زنده»‌اند و با تأخیر
    کوتاه می‌رسند تا تخلیهٔ قاب‌های مانده، آن‌ها را نخورد.
    """

    def __init__(self, messages, stale=0):
        self._messages = list(messages)
        self._stale = stale
        self.sent = []
        self.close_code = None

    async def receive(self):
        if not self._messages:
            raise WebSocketDisconnect()
        if self._stale > 0:
            self._stale -= 1
        else:
            await asyncio.sleep(0.01)
        return self._messages.pop(0)

    async def send_json(self, event):
        self.sent.append(event)

    async def close(self, code=1000, reason=""):
        self.close_code = code


class _FakePhonemeRecognizer:
    """بازشناس ساختگی: هر قاب، واج‌های ازپیش‌نوشته‌شده را می‌دهد."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.calls = 0

    def feed(self, pcm16: bytes):
        self.calls += 1
        return self._chunks.pop(0) if self._chunks else []

    def flush(self):
        return []


@pytest.mark.asyncio
async def test_serve_stream_words_final_and_close(monkeypatch):
    """حلقهٔ WS: کلمه‌ها (با خاکستری پس از جاافتادگی) + final + بستن ۱۰۰۰."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, stored = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    ws = _FakeWebSocket(
        [
            {"bytes": b"\x00\x00" * 100},
            {"text": json.dumps({"type": "bogus"})},
            {"text": json.dumps({"type": "end"})},
        ]
    )
    recognizer = _FakePhonemeRecognizer(
        [["q", "u", "l", "a", "l", "a", "h", "a", "h", "a", "d"]]
    )
    # نگاشت مصنوعی را به نشستِ ساخته‌شده بده (این تست، حلقه را با
    # نگاشت مصنوعی می‌آزماید).
    session.mapping = _fake_mapping()
    await serve_stream(ws, session, recognizer, queue)
    words = [e for e in ws.sent if e.get("type") == "word"]
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "skipped"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]
    # خطای پیام ناشناخته با پاکت نسخهٔ ۲ می‌آید؛ غیرکشنده است.
    errors = [e for e in ws.sent if e.get("type") == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "unknown_message"
    assert errors[0]["message"] == "پیام ناشناخته"
    assert errors[0]["event_type"] == "error"
    assert errors[0]["fatal"] is False
    assert errors[0]["sequence_no"] >= 1
    finals = [e for e in ws.sent if e.get("type") == "final"]
    assert len(finals) == 1 and finals[0]["ayahs"] == [1]
    assert ws.close_code == 1000
    assert stored and stored[0][0] == 1
    # حلقه با `listening` شروع و با `session_ended` تمام می‌شود.
    assert ws.sent[0].get("event_type") == "listening"
    ended = [e for e in ws.sent if e.get("event_type") == "session_ended"]
    assert len(ended) == 1 and ended[0]["reason"] == "end"


@pytest.mark.asyncio
async def test_serve_stream_disconnect_without_end_stores_nothing(monkeypatch):
    """قطع بدون end: چیزی ذخیره نمی‌شود."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, stored = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    session.mapping = _fake_mapping()
    ws = _FakeWebSocket([{"bytes": b"\x00\x00" * 100}])
    recognizer = _FakePhonemeRecognizer([["q", "u", "l"]])
    await serve_stream(ws, session, recognizer, queue)
    assert stored == []
    assert [e for e in ws.sent if e.get("type") == "final"] == []


class _FailingPhonemeRecognizer:
    """بازشناس ساختگی که در feed خطای ناشناخته می‌دهد."""

    def feed(self, pcm16: bytes):
        raise RuntimeError("boom")

    def flush(self):
        return []


class _CloseRecordingWebSocket(_FakeWebSocket):
    """سوکت ساختگی که همهٔ کدهای بستن را ثبت می‌کند."""

    def __init__(self, messages):
        super().__init__(messages)
        self.close_codes: list[int] = []

    async def close(self, code=1000, reason=""):
        self.close_codes.append(code)
        await super().close(code, reason)


@pytest.mark.asyncio
async def test_serve_stream_feed_error_sends_error_json_not_silent_close(
    monkeypatch, caplog
):
    """خطای ناشناختهٔ feed: پیام خطا به کلاینت + بستن ۱۰۱۱ + لاگ ERROR."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, _ = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    session.mapping = _fake_mapping()
    ws = _CloseRecordingWebSocket([{"bytes": b"\x00\x00" * 100}])
    recognizer = _FailingPhonemeRecognizer()
    with caplog.at_level(logging.ERROR, logger="app.modules.quran.hifz_router"):
        await serve_stream(ws, session, recognizer, queue)
    errors = [e for e in ws.sent if e.get("type") == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "hifz_stream_error"
    assert errors[0]["message"] == "خطای داخلی در جریان زنده؛ دوباره تلاش کنید."
    assert errors[0]["event_type"] == "error"
    assert errors[0]["fatal"] is True
    # بستن ۱۰۱۱ برای خطا فرستاده می‌شود (بستن پایانی ۱۰۰۰ در finally
    # پس از آن می‌آید؛ کلاینت نخستین بستن را می‌بیند).
    assert 1011 in ws.close_codes
    assert any(
        "hifz live stream feed failed" in r.message for r in caplog.records
    )
    assert any(r.exc_info is not None for r in caplog.records)


@pytest.mark.asyncio
async def test_serve_stream_frames_without_phonemes_warns(monkeypatch, caplog):
    """قاب رسید ولی واجی برنگشت: هشدار پایان نشست در لاگ است."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, _ = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    session.mapping = _fake_mapping()
    ws = _FakeWebSocket([{"bytes": b"\x00\x00" * 100}])
    recognizer = _FakePhonemeRecognizer([[]])
    with caplog.at_level(logging.WARNING, logger="app.modules.quran.hifz_router"):
        await serve_stream(ws, session, recognizer, queue)
    assert any(
        "zero phonemes" in r.message and r.levelname == "WARNING"
        for r in caplog.records
    )


@pytest.mark.asyncio
async def test_serve_stream_phonemes_without_words_warns(monkeypatch, caplog):
    """واج رسید ولی هیچ کلمه‌ای (حتی جاافتاده) تولید نشد: هشدار در لاگ است."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, _ = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    session.mapping = _fake_mapping()
    ws = _FakeWebSocket([{"bytes": b"\x00\x00" * 100}])
    # واج‌های بی‌معنا که با هیچ واحدی نمی‌خوانند و بافر را هم به حد
    # رد خودکار نمی‌رسانند: هیچ رویدادی تولید نمی‌شود.
    recognizer = _FakePhonemeRecognizer([["z", "z"]])
    with caplog.at_level(logging.WARNING, logger="app.modules.quran.hifz_router"):
        await serve_stream(ws, session, recognizer, queue)
    assert any(
        "zero word events" in r.message and r.levelname == "WARNING"
        for r in caplog.records
    )


# ---------------------------------------------------------------------------
# قاب‌های مانده + زمان‌بندی شروع + دروازهٔ is_ready
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_serve_stream_rejects_pre_ready_frames_with_warning(monkeypatch, caplog):
    """قاب‌های رسیده پیش از readiness رد می‌شوند و با warning گزارش
    می‌شوند (نه بی‌صدا دور ریخته)؛ قاب زنده می‌رسد."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, stored = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    session.mapping = _fake_mapping()
    ws = _FakeWebSocket(
        [
            {"bytes": b"\x00\x00" * 100},  # پیش از readiness
            {"bytes": b"\x00\x00" * 100},  # پیش از readiness
            {"bytes": b"\x00\x00" * 100},  # زنده
            {"text": json.dumps({"type": "end"})},
        ],
        stale=2,
    )
    recognizer = _FakePhonemeRecognizer(
        [["q", "u", "l", "a", "l", "a", "h", "a", "h", "a", "d"]]
    )
    with caplog.at_level(logging.INFO, logger="app.modules.quran.hifz_router"):
        await serve_stream(ws, session, recognizer, queue)
    # فقط قاب زنده خورانده شد (یک بار feed) و همان یک واج‌چین، کل
    # آیهٔ اول را ساخت؛ قاب‌های پیش از readiness، واجی تولید نکردند.
    assert recognizer.calls == 1
    words = [e for e in ws.sent if e.get("type") == "word"]
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "skipped"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]
    assert any(
        "rejected pre-ready frames" in r.message and "dropped=2" in r.message
        for r in caplog.records
    )
    warnings = [
        e for e in ws.sent if e.get("event_type") == "warning"
    ]
    assert len(warnings) == 1
    assert warnings[0]["code"] == "hifz_frames_before_ready"
    assert warnings[0]["dropped"] == 2
    assert ws.close_code == 1000
    assert stored and stored[0][0] == 1


def test_slow_start_steps_flags_only_slow_steps():
    """_slow_start_steps: فقط قدم‌های بیش از ۵ ثانیه را نام می‌برد."""
    from app.modules.quran.hifz_router import _slow_start_steps

    assert _slow_start_steps(
        {
            "wait_start_ms": 10.0,
            "mapping_ms": 6000.0,
            "session_ms": 100.0,
            "build_ms": 2000.0,
        }
    ) == ["mapping_ms"]
    assert _slow_start_steps({"wait_start_ms": 10.0, "mapping_ms": 100.0}) == []
    assert _slow_start_steps({}) == []
    assert _slow_start_steps({"build_ms": 5000.0}) == []


class _FakeSherpaStream:
    """جریان ساختگی sherpa: قاب‌ها را می‌شمارد؛ هر دیکد یک چانک مصرف می‌کند."""

    def __init__(self, chunk_frames=2):
        self.accepted = 0
        self.consumed = 0
        self.chunk_frames = chunk_frames
        self.finished = False

    def accept_waveform(self, sample_rate, samples):
        self.accepted += 1

    def input_finished(self):
        self.finished = True

    @property
    def buffered(self):
        return self.accepted - self.consumed


class _FakeSherpaRecognizer:
    """بازشناس ساختگی: وقتی چانک کامل بافر شده، آماده است.

    هر دیکد یک چانک مصرف می‌کند و واج‌چینِ بعدیِ `tokens_per_decode`
    را برمی‌گرداند (تکرار آخری اگر تمام شد)؛ پیش از نخستین دیکد،
    واجی نیست.
    """

    def __init__(self, ready_after=2, tokens_per_decode=None):
        self._stream = _FakeSherpaStream(chunk_frames=ready_after)
        self._tokens_per_decode = list(tokens_per_decode or [])
        self._tokens: list[str] = []
        self.decode_calls = 0

    def create_stream(self):
        return self._stream

    def is_ready(self, stream):
        return stream.buffered >= stream.chunk_frames

    def decode_stream(self, stream):
        self.decode_calls += 1
        stream.consumed += stream.chunk_frames
        if self._tokens_per_decode:
            self._tokens = list(self._tokens_per_decode.pop(0))

    def get_result_as_json_string(self, stream):
        return json.dumps({"tokens": self._tokens, "text": "".join(self._tokens)})


def _fake_sherpa_stream(monkeypatch, tmp_path, recognizer):
    """sherpaی ساختگی + پوشهٔ مدلِ ساختگی (فقط برای آزمون دروازه)."""
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "model.int8.onnx").write_bytes(b"fake")
    (model_dir / "tokens.txt").write_text("<blank> 250\n", encoding="utf-8")
    monkeypatch.setenv("HIFZ_ZIPFORMER_MODEL_DIR", str(model_dir))
    fake_module = SimpleNamespace(
        OnlineRecognizer=SimpleNamespace(
            from_zipformer2_ctc=lambda **kwargs: recognizer
        )
    )
    monkeypatch.setitem(sys.modules, "sherpa_onnx", fake_module)
    return SherpaPhonemeStream()


def test_feed_decodes_only_when_ready(monkeypatch, tmp_path):
    """قاب کوتاه، بدون دیکد برمی‌گردد؛ دیکد فقط وقتی چانک کامل آماده است."""
    recognizer = _FakeSherpaRecognizer(
        ready_after=2, tokens_per_decode=[["a", "b"]]
    )
    stream = _fake_sherpa_stream(monkeypatch, tmp_path, recognizer)
    frame = b"\x00\x00" * 4096
    assert stream.feed(frame) == []
    assert recognizer.decode_calls == 0
    assert stream.feed(frame) == ["a", "b"]
    assert recognizer.decode_calls == 1
    # قاب سوم: چانک ناقص است (یک قاب در بافر)، پس دیکد نمی‌شود.
    assert stream.feed(frame) == []
    assert recognizer.decode_calls == 1
    # قاب چهارم: چانک کامل شد؛ دیکد می‌شود ولی واج تازه‌ای نیست.
    assert stream.feed(frame) == []
    assert recognizer.decode_calls == 2


def test_flush_decodes_remaining_chunks(monkeypatch, tmp_path):
    """flush: چانک‌های مانده در بافر را دیکد می‌کند، بعد می‌ایستد."""
    recognizer = _FakeSherpaRecognizer(
        ready_after=2, tokens_per_decode=[["a", "b"], ["a", "b", "c"]]
    )
    stream = _fake_sherpa_stream(monkeypatch, tmp_path, recognizer)
    frame = b"\x00\x00" * 4096
    assert stream.feed(frame) == []
    assert stream.feed(frame) == ["a", "b"]
    # دو قاب را مستقیم بپذیر (بدون feed) تا بافر، یک چانک کامل شود.
    stream._stream.accept_waveform(16000, [0.0] * 4096)
    stream._stream.accept_waveform(16000, [0.0] * 4096)
    assert stream.flush() == ["c"]
    assert recognizer.decode_calls == 2
    assert recognizer._stream.finished is True


def test_feed_without_ready_chunk_never_decodes(monkeypatch, tmp_path):
    """یک قابِ تنها (همان حالت زندهٔ ۲۵۶ میلی‌ثانیه‌ای) هرگز دیکد نمی‌شود."""
    recognizer = _FakeSherpaRecognizer(
        ready_after=2, tokens_per_decode=[["a", "b"]]
    )
    stream = _fake_sherpa_stream(monkeypatch, tmp_path, recognizer)
    assert stream.feed(b"\x00\x00" * 4096) == []
    assert recognizer.decode_calls == 0
    assert stream.flush() == []
    assert recognizer.decode_calls == 0


# ---------------------------------------------------------------------------
# یکپارچگی با دیتابیس واقعی
# ---------------------------------------------------------------------------


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


@pytest.mark.asyncio
async def test_live_session_persists_to_real_tables(tc, monkeypatch):
    """جریان زنده روی دیتابیس واقعی → جزئیات نشست از HTTP درست است."""
    from pathlib import Path

    from app.models.models import HifzAttempt

    tanzil = Path(__file__).resolve().parent.parent / (
        "app/modules/quran/data/tanzil_uthmani.txt"
    )

    def tanzil_ayah(surah: int, ayah: int) -> str:
        for line in tanzil.read_text(encoding="utf-8").splitlines():
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

    async def fake_bundle(db, surah: int, ayah: int, **kwargs):
        return {
            "surah": surah,
            "ayah": ayah,
            "editions": [{"edition": "quran-uthmani", "text": tanzil_ayah(surah, ayah)}],
        }

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", fake_bundle
    )
    client = tc["client"]
    token = await _user_token(client, "live-stream@example.com")
    auth = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": None}, headers=auth
    )
    assert r.status_code == 200, r.text
    attempt_id = r.json()["id"]

    events: list = []
    async with tc["maker"]() as db:
        attempt = await db.get(HifzAttempt, uuid.UUID(attempt_id))
        assert attempt is not None
        session = LiveSession(
            db=db,
            attempt=attempt,
            surah=112,
            start_ayah=1,
            green=0.8,
            amber=0.5,
            sender=events.append,
        )
        session._ayah = 1
        session._words = await session._load_ayah(1)
        session._touch(1)
        # آیهٔ ۱ کامل خوانده می‌شود، آیهٔ ۲ جا می‌افتد، آیهٔ ۳ درست می‌آید.
        words1 = list(session._words)
        await session.feed_words([StreamWord(w, 0.95) for w in words1])
        words3 = await session._load_ayah(3)
        await session.feed_words([StreamWord(w, 0.92) for w in words3])
        summary = await session.finish()

    assert summary["ayahs"] == [1, 2, 3]
    r = await client.get(f"{HIFZ}/attempts/{attempt_id}", headers=auth)
    assert r.status_code == 200, r.text
    detail = r.json()
    by_ayah = {}
    for w in detail["words"]:
        by_ayah.setdefault(w["ayah"], []).append(w["status"])
    assert all(s == "correct" for s in by_ayah[1])
    assert all(s == "skipped" for s in by_ayah[2])
    assert all(s == "correct" for s in by_ayah[3])
    # ردیف‌های خطا برای آیهٔ جاافتاده در تاریخچه هستند.
    assert any(
        m["ayah"] == 2 and m["mistake_type"] == "skipped"
        for m in detail["mistakes"]
    )


def test_whisper_live_unavailable_error_shape():
    """خطای زنده-ناممکن برای Whisper: کد و وضعیت درست."""
    err = LiveUnavailableError("whisper_quran")
    assert err.code == "hifz_live_unavailable"
    assert err.status_code == 503
