"""تست‌های سناریوی موتور تشخیص تلاوت (مأموریت تکمیلی حفاظ، بخش ۷).

سناریوهای اجباری با نگاشت مصنوعیِ قطعه‌ای (سورهٔ ۱۱۲، همان الگوی
`test_hifz_stream.py`) — بدون مدل/نگاشت واقعی، سریع و قطعی. هر حکم،
رفتارِ مشاهده‌شدهٔ کدِ همین شاخه است، نه حدس:

- حذف کلمه در میانهٔ آیه: فقط همان کلمه جاافتاده می‌شود.
- تکرار کلمه: رویداد `repeat` می‌خورد و شمار عین خط مبنا می‌ماند.
- جابه‌جایی دو کلمه: ترتیب عوض نمی‌شود؛ واج‌های کلمهٔ جلوافتاده در
  هم‌ترازیِ دوباره دور ریخته می‌شوند (`resync_dropped`) و کلمهٔ
  جابه‌جاشده خاکستری می‌شود.
- خواندن اضافه (واج‌های بیگانه در میانهٔ آیه): رویداد `extra`
  نمی‌آید؛ واج‌ها در هم‌ترازیِ دوباره دور ریخته می‌شوند و کلمهٔ بعد
  به «نزدیک» تنزل می‌کند.
- جایگزینی ۱/۲/۳/۴ واج در واحدِ ۴حرفی: همه «نزدیک» می‌شوند، نه
  «غلط» — چون قاعدهٔ near-miss (فاصلهٔ لوونشتاین ≤ ۲) روی پنجرهٔ
  `buf[:len(phon)]` پس از جابه‌جاییِ هم‌ترازیِ دوباره سنجیده می‌شود،
  نه روی کلمهٔ گفته‌شده به‌تنهایی (برای «axyz»: پس از دورریختنِ ۲
  حرف، پنجره «yzah» در برابر «alah» فاصلهٔ ۲ دارد).
- بازگشت به آیهٔ ۱ پس از آیهٔ ۳: یک `revisit`، همهٔ کلمات درست.
- تکرار یک آیه چند بار: نقصِ بخش ۷ بود (در نگاشت مصنوعی سه
  `revisit` شناسایی می‌شدند ولی آیه‌های ۳ و ۴ پس از آن همه «غلط»
  می‌خوردند؛ با توکن‌های واقعیِ فاتحه ۲۰ غلط، صفر `revisit`) —
  رفع شد: یافتنِ جابه‌جاپذیر + مصرفِ دقیقِ تطابق در شاخهٔ بازگشت.
  تستِ `test_scenario_repeat_ayah_many_times` رفتارِ مطلوب را
  می‌خواهد و سبز است. شاهدِ دادهٔ واقعی در
  `~/workspace/hifz-voice-test/completion/summary.json` است.

هشدارِ روشی: نگاشت مصنوعی (رشته‌های بلند و متمایز) پرشِ آیه و
بازگشت را تمیز نشان می‌دهد، ولی با توکن‌های واقعیِ فاتحه (واحدهای
کوتاه، واج‌های مشترکِ آیه‌ها، صورت‌های وصل) همان سناریوها
می‌شکنند: پرشِ آیهٔ ۲ در دادهٔ واقعی ۶/۰/۱۶/۷ و بازگشت به آیهٔ ۱
۱۶/۲/۱۱/۰ می‌شود. پس سبزبودنِ تست‌های مصنوعی، سلامتِ دادهٔ واقعی
را ثابت نمی‌کند؛ شاهدِ دادهٔ واقعی در
`~/workspace/hifz-voice-test/completion/summary.json` است.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.modules.quran import hifz_service
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import LiveSession

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


async def _fake_ayah_words(db, surah: int, ayah: int):
    return list(_AYAH_WORDS[ayah])


def _session(monkeypatch, events=None, mapping=None):
    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_ayah_words", _fake_ayah_words)
    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)
    events = events if events is not None else []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=mapping,
    )
    session._ayah = 1
    session._words = list(_AYAH_WORDS[1])
    session._index = 0
    session._touch(1)
    return session


def _word_events(events):
    return [e for e in events if e["type"] == "word"]


@pytest.mark.asyncio
async def test_scenario_omit_word_mid_ayah_only_it_is_skipped(monkeypatch):
    """حذف کلمهٔ میانیِ آیهٔ ۳ (يَلِدْ): فقط همان کلمه جاافتاده است."""
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(
        list("qul" "huwa" "alah" "ahad"  # آیهٔ ۱
             "alah" "samad"  # آیهٔ ۲
             "lam" "walam" "yulad")  # آیهٔ ۳، بی‌يَلِدْ
    )
    words = _word_events(events)
    assert [(w["ayah"], w["expected"], w["status"]) for w in words] == [
        (1, "قُلْ", "correct"),
        (1, "هُوَ", "correct"),
        (1, "اللَّهُ", "correct"),
        (1, "أَحَدٌ", "correct"),
        (2, "اللَّهُ", "correct"),
        (2, "الصَّمَدُ", "correct"),
        (3, "لَمْ", "correct"),
        (3, "يَلِدْ", "skipped"),
        (3, "وَلَمْ", "correct"),
        (3, "يُولَدْ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 9,
        "close": 0,
        "wrong": 0,
        "skipped": 1,
    }


@pytest.mark.asyncio
async def test_scenario_repeat_word_emits_repeat(monkeypatch):
    """تکرار کلمه (قُلْ دو بار): رویداد `repeat`، شمار عین خط مبنا."""
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(list("qul" "qul" "huwa" "alah" "ahad"))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]
    repeats = [e for e in events if e["type"] == "repeat"]
    assert len(repeats) == 1
    assert session.live_counts()["repeats"] == 1
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 4,
        "close": 0,
        "wrong": 0,
        "skipped": 0,
    }


@pytest.mark.asyncio
async def test_scenario_transposed_words_first_correct_second_skipped(
    monkeypatch,
):
    """جابه‌جایی دو کلمه (هُوَ پیش از قُلْ): ترتیب عوض نمی‌شود؛
    واج‌های جلوافتاده در هم‌ترازیِ دوباره دور ریخته می‌شوند و کلمهٔ
    جابه‌جاشده خاکستری می‌شود."""
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(list("huwa" "qul" "alah" "ahad"))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "skipped"),
        ("اللَّهُ", "correct"),
        ("أَحَدٌ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 4
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 0,
        "wrong": 0,
        "skipped": 1,
    }


@pytest.mark.asyncio
async def test_scenario_shared_phonemes_tie_breaks_by_recency(monkeypatch):
    """واج‌های مشترکِ دو آیه در شاخهٔ بازگشت: واج‌های آیهٔ ۳ عینِ
    دنبالهٔ آیهٔ ۱ است (الگوی بسمله/آیهٔ ۳ در فاتحه)؛ پس از خواندنِ
    آیهٔ ۲ و خردهٔ مشترک، یافتنِ بازگشت میانِ آیهٔ ۱ و ۳ مساوی
    می‌شود و باید تازه‌ترینِ خوانده‌شده (۳) برنده شود، نه اینکه
    None برگردد و آیهٔ ۴ غلط بخورد.

    نقصِ بخش ۷ بود که فقط در دادهٔ واقعیِ صوتی دیده شد: تکرارِ
    چندبارهٔ صوتیِ آیهٔ ۲ پس از نخستین `revisit` با همین خردهٔ
    مشترک می‌ایستاد و آیه‌های ۴ تا ۷ همه غلط می‌خوردند
    (۹/۱/۱۹/۰). مصرف برای برندگانِ مساوی یکی است (همان زیررشتهٔ
    بافر)؛ فقط برچسبِ آیهٔ رویدادِ `revisit` با تازگی حل می‌شود.
    """
    from app.modules.quran import hifz_service as _hs

    words = {
        1: ["w1a", "w1b"],
        2: ["w2a", "w2b"],
        3: ["w3a"],
        4: ["w4a", "w4b", "w4c", "w4d", "w4e"],
    }

    class _TieMapping:
        def segments_for(self, surah, ayah):
            if surah != 112:
                return None
            segs = {
                1: [Segment((0,), "bbbbbbbb"), Segment((1,), "sharedphon")],
                2: [Segment((0,), "eeeeeeeeee"), Segment((1,), "ffffffffff")],
                3: [Segment((0,), "sharedphon")],
                4: [
                    Segment((0,), "kkkkk"),
                    Segment((1,), "lllll"),
                    Segment((2,), "mmmmm"),
                    Segment((3,), "nnnnn"),
                    Segment((4,), "ooooo"),
                ],
            }
            return list(segs.get(ayah, [])) or None

    async def _tie_ayah_words(db, surah: int, ayah: int):
        return list(words[ayah])

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(_hs, "_ayah_words", _tie_ayah_words)
    monkeypatch.setattr(_hs, "_store_grade", fake_store)
    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_TieMapping(),
    )
    session._ayah = 1
    session._words = list(words[1])
    session._index = 0
    session._touch(1)
    a1 = "bbbbbbbbsharedphon"
    a2 = "eeeeeeeeeeffffffffff"
    a3 = "sharedphon"
    a4 = "kkkkklllllmmmmmnnnnnooooo"
    await session.feed_phonemes(list(a1 + a2 + a3 + a2 + a3 + a2 + a4))
    word_list = _word_events(events)
    assert [(w["ayah"], w["status"]) for w in word_list] == (
        [(1, "correct")] * 2
        + [(2, "correct")] * 2
        + [(3, "correct")]
        + [(4, "correct")] * 5
    )
    revisits = [e for e in events if e["type"] == "revisit"]
    assert [r["ayah"] for r in revisits] == [2, 3, 2]
    assert session.live_counts()["revisits"] == 3
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 10,
        "close": 0,
        "wrong": 0,
        "skipped": 0,
    }


@pytest.mark.asyncio
async def test_scenario_extra_foreign_phonemes_demote_next_word(monkeypatch):
    """خواندن اضافه در میانهٔ آیه (واج‌های بیگانه پیش از اللَّهُ):
    رویداد `extra` نمی‌آید؛ واج‌ها دور ریخته می‌شوند و کلمهٔ بعد
    به «نزدیک» تنزل می‌کند، نه اینکه غلط/جاافتاده شود."""
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(list("qul" "huwa" "zzzz" "alah" "ahad"))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "close"),
        ("أَحَدٌ", "correct"),
    ]
    assert [e for e in events if e["type"] == "extra"] == []
    assert session.live_counts()["resync_dropped"] == 3
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 1,
        "wrong": 0,
        "skipped": 0,
    }


@pytest.mark.asyncio
async def test_scenario_two_phoneme_substitution_is_close(monkeypatch):
    """جایگزینی ۲ واج در واحدِ ۴حرفی (alah ← alxy): «نزدیک»."""
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(list("qul" "huwa" "alxy" "ahad"))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "close"),
        ("أَحَدٌ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 1,
        "wrong": 0,
        "skipped": 0,
    }


@pytest.mark.asyncio
async def test_scenario_three_phoneme_substitution_still_close(monkeypatch):
    """جایگزینی ۳ واج در واحدِ ۴حرفی (alah ← axyz): باز هم «نزدیک»،
    نه «غلط» — هم‌ترازیِ دوباره ۲ حرف دور می‌ریزد و پنجرهٔ
    نزدیک‌یابی («yzah» در برابر «alah»، فاصلهٔ ۲) روی سرِ کلمهٔ بعد
    می‌لغزد. پس در مسیر واجی، آستانهٔ ≤ ۲ به‌تنهایی مرزِ «غلط» نیست.
    """
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(list("qul" "huwa" "axyz" "ahad"))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "close"),
        ("أَحَدٌ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 2
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 1,
        "wrong": 0,
        "skipped": 0,
    }


@pytest.mark.asyncio
async def test_scenario_four_phoneme_substitution_still_close(monkeypatch):
    """جایگزینی هر ۴ واج (alah ← wxyz): باز هم «نزدیک» (هم‌ترازیِ
    دوباره ۲ حرف، پنجرهٔ «yzah» با فاصلهٔ ۲). «غلط» در مسیر واجی
    با جایگزینیِ درون‌کلمه‌ای به‌تنهایی رخ نمی‌دهد؛ یا حالتِ
    یافتنِ ناموفق لازم است (سورهٔ دیگر) یا واحدِ بلندتر."""
    events = []
    session = _session(monkeypatch, events, mapping=_FakeMapping())
    await session.feed_phonemes(list("qul" "huwa" "wxyz" "ahad"))
    words = _word_events(events)
    assert [(w["expected"], w["status"]) for w in words] == [
        ("قُلْ", "correct"),
        ("هُوَ", "correct"),
        ("اللَّهُ", "close"),
        ("أَحَدٌ", "correct"),
    ]
    assert session.live_counts()["resync_dropped"] == 2
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 1,
        "wrong": 0,
        "skipped": 0,
    }


def _long_session(monkeypatch, events=None):
    """نشست روی سورهٔ ۱۱۲ با رشته‌های واجیِ بلند و متمایز (الگوی
    تست‌های بازخوانیِ فاز ۹) برای سناریوهای بازگشت به آیهٔ پیش‌تر."""

    class _LongMapping:
        def segments_for(self, surah, ayah):
            if surah != 112:
                return None
            segs = {
                1: [
                    Segment((0,), "aaaaaaaa"),
                    Segment((1,), "bbbbbbbb"),
                    Segment((2,), "cccccccc"),
                    Segment((3,), "dddddddd"),
                ],
                2: [Segment((0,), "eeeeeeeeee"), Segment((1,), "ffffffffff")],
                3: [
                    Segment((0,), "ggggg"),
                    Segment((1,), "hhhhh"),
                    Segment((2,), "iiiii"),
                    Segment((3,), "jjjjj"),
                ],
                4: [
                    Segment((0,), "kkkkk"),
                    Segment((1,), "lllll"),
                    Segment((2,), "mmmmm"),
                    Segment((3,), "nnnnn"),
                    Segment((4,), "ooooo"),
                ],
            }
            return list(segs.get(ayah, [])) or None

    return _session(monkeypatch, events, mapping=_LongMapping())


@pytest.mark.asyncio
async def test_scenario_return_to_ayah_1_after_ayah_3(monkeypatch):
    """بازگشت به آیهٔ ۱ پس از خواندنِ آیهٔ ۳ و ادامهٔ آیهٔ ۴: یک
    `revisit`، همهٔ ۱۵ کلمه درست، بدون غلط/جاافتاده."""
    events = []
    session = _long_session(monkeypatch, events)
    a1 = "aaaaaaaabbbbbbbbccccccccdddddddd"
    a2 = "eeeeeeeeeeffffffffff"
    a3 = "ggggghhhhhiiiiijjjjj"
    a4 = "kkkkklllllmmmmmnnnnnooooo"
    await session.feed_phonemes(list(a1 + a2 + a3 + a1 + a4))
    words = _word_events(events)
    assert len(words) == 15
    assert all(w["status"] == "correct" for w in words)
    revisits = [e for e in events if e["type"] == "revisit"]
    assert len(revisits) == 1
    assert revisits[0]["ayah"] == 1
    assert session.live_counts()["revisits"] == 1
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 15,
        "close": 0,
        "wrong": 0,
        "skipped": 0,
    }


@pytest.mark.asyncio
async def test_scenario_skip_whole_ayah_grays_it_only(monkeypatch):
    """پرشِ یک آیهٔ کامل (آیهٔ ۲ خوانده نمی‌شود): فقط همان آیه
    خاکستری می‌شود؛ آیه‌های ۳ و ۴ درست نمره می‌گیرند."""
    events = []
    session = _long_session(monkeypatch, events)
    a1 = "aaaaaaaabbbbbbbbccccccccdddddddd"
    a3 = "ggggghhhhhiiiiijjjjj"
    a4 = "kkkkklllllmmmmmnnnnnooooo"
    await session.feed_phonemes(list(a1 + a3 + a4))
    words = _word_events(events)
    assert [(w["ayah"], w["status"]) for w in words] == (
        [(1, "correct")] * 4
        + [(2, "skipped")] * 2
        + [(3, "correct")] * 4
        + [(4, "correct")] * 5
    )
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 13,
        "close": 0,
        "wrong": 0,
        "skipped": 2,
    }


@pytest.mark.asyncio
async def test_scenario_repeat_ayah_many_times(monkeypatch):
    """تکرار یک آیه چند بار (آیهٔ ۲ چهار بار خوانده می‌شود، بعد
    آیهٔ ۳): هر سه بازخوانی `revisit` می‌خورند و آیهٔ ۳ درست نمره
    می‌گیرد.

    نقصِ بخش ۷ بود (در دادهٔ واقعی ۸/۱/۲۰/۰ می‌شد): بازخوانی فقط
    یک نسخه از آیه را می‌پوشاند و شاخهٔ بازگشتِ پشتیبان با مصرفِ
    «یک طولِ کلمه» هم‌ترازی را می‌شکست. رفع: یافتنِ جابه‌جاپذیرِ
    `locate_ayah_span` + مصرفِ دقیقِ تطابق در شاخهٔ بازگشت.
    """
    events = []
    session = _long_session(monkeypatch, events)
    a1 = "aaaaaaaabbbbbbbbccccccccdddddddd"
    a2 = "eeeeeeeeeeffffffffff"
    a3 = "ggggghhhhhiiiiijjjjj"
    await session.feed_phonemes(list(a1 + a2 + a2 + a2 + a2 + a3))
    words = _word_events(events)
    assert [(w["ayah"], w["status"]) for w in words] == (
        [(1, "correct")] * 4
        + [(2, "correct")] * 2
        + [(3, "correct")] * 4
    )
    assert session.live_counts()["revisits"] == 3
    assert session.live_counts()["resync_dropped"] == 0
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 10,
        "close": 0,
        "wrong": 0,
        "skipped": 0,
    }


def test_locate_ayah_span_finds_ayah_behind_leading_junk(monkeypatch):
    """یافتنِ آیه پشتِ خردهٔ سرِ بافر: بافر با دو حرفِ اضافی شروع
    می‌شود (خردهٔ واحدِ پیشین) و بعد آیهٔ ۲ می‌آید — `locate_ayah`
    همان (۲، ۰) را می‌دهد و `locate_ayah_span` جابه‌جاییِ ۲ و طولِ
    ۲۰ را برمی‌گرداند تا شاخهٔ بازگشت دقیق مصرف کند."""
    from app.modules.quran.hifz_stream import locate_ayah, locate_ayah_span

    class _LongMapping2:
        def segments_for(self, surah, ayah):
            if surah != 112:
                return None
            segs = {
                1: [
                    Segment((0,), "aaaaaaaa"),
                    Segment((1,), "bbbbbbbb"),
                    Segment((2,), "cccccccc"),
                    Segment((3,), "dddddddd"),
                ],
                2: [Segment((0,), "eeeeeeeeee"), Segment((1,), "ffffffffff")],
                3: [
                    Segment((0,), "ggggg"),
                    Segment((1,), "hhhhh"),
                    Segment((2,), "iiiii"),
                    Segment((3,), "jjjjj"),
                ],
                4: [
                    Segment((0,), "kkkkk"),
                    Segment((1,), "lllll"),
                    Segment((2,), "mmmmm"),
                    Segment((3,), "nnnnn"),
                    Segment((4,), "ooooo"),
                ],
            }
            return list(segs.get(ayah, [])) or None

    mapping = _LongMapping2()
    a2 = "eeeeeeeeeeffffffffff"
    a3 = "ggggghhhhhiiiiijjjjj"
    buf = "zz" + a2 + a3
    assert locate_ayah(
        mapping, 112, buf, hint_ayah=3, allow_backward=True, min_len=8
    ) == (2, 0)
    assert locate_ayah_span(
        mapping, 112, buf, hint_ayah=3, allow_backward=True, min_len=8
    ) == (2, 0, 20, 2)
    # بدون خرده، رفتارِ پیشین بی‌تغییر است (جابه‌جاییِ ۰).
    assert locate_ayah_span(
        mapping, 112, a2 + a3, hint_ayah=3, allow_backward=True, min_len=8
    ) == (2, 0, 20, 0)


@pytest.mark.asyncio
async def test_scenario_jump_to_same_ayah_emits_skipped_live(monkeypatch):
    """پرشِ درون‌آیه‌ای به واحدِ جلوتر: واحدهای ردشدهٔ همان آیه
    زنده خاکستری می‌شوند (پیش‌تر فقط در ذخیره جاافتاده بودند و
    در نمایشِ زنده نمی‌آمدند — ناسازگاریِ زنده/ذخیرهٔ §۵ بخش ۷)."""
    events = []
    session = _long_session(monkeypatch, events)
    await session._ensure_units()
    await session._jump_to(1, 2)
    words = _word_events(events)
    assert [(w["ayah"], w["word_index"], w["status"]) for w in words] == [
        (1, 0, "skipped"),
        (1, 1, "skipped"),
    ]
    assert session.live_counts()["skipped"] == 2
    a1_tail = "ccccccccdddddddd"
    a2 = "eeeeeeeeeeffffffffff"
    a3 = "ggggghhhhhiiiiijjjjj"
    a4 = "kkkkklllllmmmmmnnnnnooooo"
    await session.feed_phonemes(list(a1_tail + a2 + a3 + a4))
    words = _word_events(events)
    assert [(w["ayah"], w["status"]) for w in words] == (
        [(1, "skipped")] * 2
        + [(1, "correct")] * 2
        + [(2, "correct")] * 2
        + [(3, "correct")] * 4
        + [(4, "correct")] * 5
    )
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 13,
        "close": 0,
        "wrong": 0,
        "skipped": 2,
    }


@pytest.mark.asyncio
async def test_scenario_waqf_pause_inside_merged_segment_emits_in_order(
    monkeypatch,
):
    """قطعهٔ ادغامی روی نشانهٔ وقف: کلمه‌های (۰، ۲) یک قطعه‌اند و
    وقفِ ۱ واحدِ جدایِ بعد از آن است — رویدادِ ردشدهٔ وقف باید
    میانِ دو کلمهٔ قطعه بیاید (۰، ۱-ردشده، ۲)، نه پس از هر دو."""
    from app.modules.quran import hifz_service as _hs

    words_ayah1 = ["قُلْ", "ۚ", "هُوَ", "اللَّهُ"]

    class _WaqfMapping:
        def segments_for(self, surah, ayah):
            if surah != 112 or ayah != 1:
                return None
            return [
                Segment((0, 2), "qulhuwa"),
                Segment((1,), None),
                Segment((3,), "alah"),
            ]

    async def _waqf_ayah_words(db, surah: int, ayah: int):
        return list(words_ayah1)

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(_hs, "_ayah_words", _waqf_ayah_words)
    monkeypatch.setattr(_hs, "_store_grade", fake_store)
    events: list = []
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_WaqfMapping(),
    )
    session._ayah = 1
    session._words = list(words_ayah1)
    session._index = 0
    session._touch(1)
    await session.feed_phonemes(list("qulhuwaalah"))
    words = _word_events(events)
    assert [(w["word_index"], w["status"]) for w in words] == [
        (0, "correct"),
        (1, "skipped"),
        (2, "correct"),
        (3, "correct"),
    ]
    assert session.live_counts()["skipped"] == 1
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 0,
        "wrong": 0,
        "skipped": 1,
    }
