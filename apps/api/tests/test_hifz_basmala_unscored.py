"""تست‌های بسملهٔ خوانده‌شده: تایپ می‌شود ولی نمره نمی‌خورد.

مشخصهٔ کاربر ۲۰۲۶-۱۱-۱۵ (گزارشِ ص ۶۰۱، سورهٔ همزه — بسملهٔ اول
همزه خوانده شد ولی تایپ نشد):
- اگر کسی بسمله را خواند، تایپ بشود ولی در نمره‌دهی حساب نشود؛
  اگر نخواند، هیچ تایپ نمی‌شود.
- موتور باید حواسش باشد که سوره یا با آیهٔ اول شروع می‌شود، یا
  با بسمله، یا از وسطِ سوره؛ و قابلیتِ سرچِ تمامِ آیاتِ سوره
  روشن باشد تا آیهٔ خوانده‌شده را سریع پیدا کند.

رفتارهای قفل‌شده:
- نشست از آیهٔ ۱ با بسمله: واحدهای بسمله با وضعیتِ `basmala`
  صادر می‌شوند (نوشته، بی‌نمره) و کلمه‌های آیهٔ ۱ درست.
- نشست از آیهٔ ۱ بی‌بسمله: هیچ رویدادی برای بسمله نمی‌آید — نه
  درست، نه غلط، نه جاافتاده.
- نشست از وسطِ سوره (آیهٔ ۵) با بسمله + محتوای آیهٔ ۱: بسمله
  پس‌از یافتنِ آیهٔ ۱ تایپ می‌شود و آیهٔ ۱ درست می‌نشیند.
- نشست از وسطِ سوره با بسمله + محتوای آیهٔ دیگر: بسمله دور
  ریخته می‌شود (ایراد ۱۴) و آیهٔ درست پیدا می‌شود.
- نشست از وسطِ سوره بی‌بسمله: یافتنِ آغازین همهٔ آیاتِ سوره را
  می‌گردد و آیهٔ عقب‌تر را هم پیدا می‌کند.
- finish (پیشنهاد ۱۶): بسملهٔ خوانده‌شده با وضعیتِ `basmala`
  ذخیره می‌شود — نمایشی، بی‌نمره (prob صفر، بی‌خطا) و بیرونِ
  شمارنده‌ها — تا پس از بارگذاریِ دوباره هم تایپ‌شده بماند؛
  نخوانده‌اش همچنان ذخیره نمی‌شود (نه «جاافتاده»).
- قیدِ دیتابیس: وضعیتِ نمره فقط پنج مقدار دارد
  (correct | close | wrong | skipped | basmala).
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.modules.quran import hifz_service, hifz_stream
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import LiveSession

# بسملهٔ مصنوعی با ۴ قطعه — مثلِ نگاشتِ واقعی (۴ کلمهٔ ۰ تا ۳).
_BASMALA4 = [
    Segment((0,), "bismilla"),
    Segment((1,), "hirrahma"),
    Segment((2,), "nirrahi"),
    Segment((3,), "m"),
]
_BASMALA = "bismillahirrahmanirrahim"
_AYAH1_REAL = [
    Segment((4,), "aliflammim"),
    Segment((5,), "sadtilkaa"),
    Segment((6,), "yatulkitabi"),
]
_AYAH1_CONTENT = "aliflammimsadtilkaayatulkitabi"
_AYAH3 = [
    Segment((0,), "qalamana"),
    Segment((1,), "manaaka"),
    Segment((2,), "allatasjud"),
]
_AYAH3_STR = "qalamanamanaakaallatasjud"
_AYAH5 = [
    Segment((0,), "walawanna"),
    Segment((1,), "ahlalqur"),
    Segment((2,), "aamanu"),
    Segment((3,), "bima"),
]
_AYAH5_STR = "walawannaahlalquraamanubima"

_WORDS = {
    1: ["بسم", "الله", "الرحمن", "الرحيم", "المص", "تلك", "آية"],
    3: ["قال", "ما", "منعك"],
    5: ["ولو", "أن", "أهل", "القرى"],
}


class _UnscoredBasmalaMapping:
    """نگاشت مصنوعی: ۱:۱ بسمله است (۴ قطعه)؛ ۷:۱ بسمله + محتوا؛
    ۷:۳ و ۷:۵ محتوا."""

    def segments_for(self, surah, ayah):
        if (surah, ayah) == (1, 1):
            return list(_BASMALA4)
        if (surah, ayah) == (7, 1):
            return list(_BASMALA4) + list(_AYAH1_REAL)
        if (surah, ayah) == (7, 3):
            return list(_AYAH3)
        if (surah, ayah) == (7, 5):
            return list(_AYAH5)
        return None


def _word_events(events):
    return [e for e in events if e.get("type") == "word"]


def _by_index(events, ayah):
    return {
        e["word_index"]: e
        for e in _word_events(events)
        if e.get("ayah") == ayah
    }


@pytest.fixture
def _patch_services(monkeypatch):
    async def fake_ayah_words(db, surah, ayah):
        return list(_WORDS[ayah])

    monkeypatch.setattr(hifz_service, "_ayah_words", fake_ayah_words)
    monkeypatch.setattr(
        hifz_stream.quran_service,
        "get_surah",
        lambda surah: SimpleNamespace(ayahs=12),
    )


async def _make_session(events, start_ayah):
    session = LiveSession(
        db=None,
        attempt=SimpleNamespace(id=uuid.uuid4()),
        surah=7,
        start_ayah=start_ayah,
        green=0.8,
        amber=0.5,
        sender=events.append,
        mapping=_UnscoredBasmalaMapping(),
    )
    session._ayah = start_ayah
    session._words = list(_WORDS[start_ayah])
    session._index = 0
    await session._ensure_units()
    session._touch(start_ayah)
    session._locating = True
    return session


@pytest.mark.asyncio
async def test_basmala_recited_at_ayah1_is_typed_unscored(_patch_services):
    """نشست از آیهٔ ۱ با بسمله: بسمله با `basmala` صادر می‌شود،
    نه `correct`؛ کلمه‌های آیهٔ ۱ درست می‌نشینند."""
    events: list[dict] = []
    session = await _make_session(events, start_ayah=1)

    await session.feed_phonemes([_BASMALA])
    await session.feed_phonemes([_AYAH1_CONTENT])

    words = _by_index(events, 1)
    assert [words[i]["status"] for i in (0, 1, 2, 3)] == ["basmala"] * 4
    assert [words[i]["status"] for i in (4, 5, 6)] == ["correct"] * 3
    assert all(words[i]["heard"] == words[i]["expected"] for i in range(7))


@pytest.mark.asyncio
async def test_basmala_skipped_at_ayah1_writes_nothing(_patch_services):
    """نشست از آیهٔ ۱ بی‌بسمله: هیچ رویدادی برای بسمله نمی‌آید —
    نه درست، نه غلط، نه جاافتاده؛ کلمه‌های آیهٔ ۱ درست‌اند."""
    events: list[dict] = []
    session = await _make_session(events, start_ayah=1)

    await session.feed_phonemes([_AYAH1_CONTENT])

    words = _by_index(events, 1)
    assert not any(i in words for i in (0, 1, 2, 3))
    assert [words[i]["status"] for i in (4, 5, 6)] == ["correct"] * 3


@pytest.mark.asyncio
async def test_mid_surah_start_with_basmala_then_ayah1_types_it(
    _patch_services,
):
    """نشست از وسطِ سوره (آیهٔ ۵) با بسمله + محتوای آیهٔ ۱:
    بسمله پس‌از یافتنِ آیهٔ ۱ تایپ می‌شود و آیهٔ ۱ درست
    می‌نشیند."""
    events: list[dict] = []
    session = await _make_session(events, start_ayah=5)

    await session.feed_phonemes([_BASMALA + _AYAH1_CONTENT])

    located = [e for e in events if e.get("type") == "located"]
    assert located and located[-1]["ayah"] == 1
    words = _by_index(events, 1)
    assert [words[i]["status"] for i in (0, 1, 2, 3)] == ["basmala"] * 4
    assert [words[i]["status"] for i in (4, 5, 6)] == ["correct"] * 3


@pytest.mark.asyncio
async def test_mid_surah_start_with_basmala_then_other_ayah_drops_it(
    _patch_services,
):
    """نشست از وسطِ سوره با بسمله + محتوای آیهٔ ۳: بسمله دور
    ریخته می‌شود (ایراد ۱۴ — نشستِ آیهٔ ۳ روی آیهٔ ۱ لنگر
    نمی‌اندازد) و آیهٔ ۳ درست پیدا می‌شود."""
    events: list[dict] = []
    session = await _make_session(events, start_ayah=5)

    await session.feed_phonemes([_BASMALA + _AYAH3_STR])

    located = [e for e in events if e.get("type") == "located"]
    assert located and located[-1]["ayah"] == 3
    assert not any(
        e.get("ayah") == 1 for e in _word_events(events)
    ), "بسمله نباید هیچ رویدادی بسازد وقتی آیهٔ دیگر خوانده می‌شود"
    words = _by_index(events, 3)
    assert [words[i]["status"] for i in (0, 1, 2)] == ["correct"] * 3


@pytest.mark.asyncio
async def test_mid_surah_start_locates_backward_ayah(_patch_services):
    """نشست از وسطِ سوره بی‌بسمله: یافتنِ آغازین همهٔ آیاتِ سوره
    را می‌گردد و آیهٔ عقب‌تر (۳) را هم پیدا می‌کند."""
    events: list[dict] = []
    session = await _make_session(events, start_ayah=5)

    await session.feed_phonemes([_AYAH3_STR])

    located = [e for e in events if e.get("type") == "located"]
    assert located and located[-1]["ayah"] == 3
    words = _by_index(events, 3)
    assert [words[i]["status"] for i in (0, 1, 2)] == ["correct"] * 3


@pytest.mark.asyncio
async def test_finish_stores_recited_basmala_unscored(_patch_services, monkeypatch):
    """finish (پیشنهاد ۱۶): بسملهٔ خوانده‌شده با وضعیتِ `basmala`
    ذخیره می‌شود — نمایشی، بی‌نمره (prob صفر، بی‌خطا) و بیرونِ
    شمارنده‌ها؛ نخوانده‌اش همچنان ذخیره نمی‌شود (نه «جاافتاده»)."""
    captured: list[list] = []

    async def fake_store(db, attempt, surah, ayah, aligned, extra):
        captured.append(list(aligned))
        return [SimpleNamespace(status=w.status) for w in aligned]

    monkeypatch.setattr(hifz_service, "_store_grade", fake_store)

    # خوانده‌شده: بسمله + آیهٔ ۱.
    events: list[dict] = []
    session = await _make_session(events, start_ayah=1)
    await session.feed_phonemes([_BASMALA])
    await session.feed_phonemes([_AYAH1_CONTENT])
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 0,
        "wrong": 0,
        "skipped": 0,
    }
    assert captured and len(captured) == 1
    by_index = {w.word_index: w for w in captured[0]}
    assert [by_index[i].status for i in (0, 1, 2, 3)] == ["basmala"] * 4
    assert [by_index[i].status for i in (4, 5, 6)] == ["correct"] * 3
    assert all(by_index[i].prob == 0.0 for i in (0, 1, 2, 3))
    assert all(by_index[i].mistake_type is None for i in (0, 1, 2, 3))
    assert all(by_index[i].heard == by_index[i].expected for i in (0, 1, 2, 3))

    # نخوانده: فقط آیهٔ ۱ — بسمله «جاافتاده» هم ذخیره نمی‌شود.
    captured.clear()
    events = []
    session = await _make_session(events, start_ayah=1)
    await session.feed_phonemes([_AYAH1_CONTENT])
    summary = await session.finish()
    assert summary["counts"] == {
        "correct": 3,
        "close": 0,
        "wrong": 0,
        "skipped": 0,
    }
    assert captured and all(
        w.word_index >= 4 for aligned in captured for w in aligned
    )
    assert not any(
        w.status == "skipped" for aligned in captured for w in aligned
    )


@pytest.mark.asyncio
async def test_word_score_status_check_constraint(db_session):
    """قیدِ وضعیت: `basmala` پنجمین مقدارِ مجاز است؛ هر چیز
    دیگر رد می‌شود."""
    import sqlalchemy as sa

    from app.models.models import HifzAttempt, HifzWordScore, User

    user = User(
        full_name="کاربر تست بسمله",
        email=f"basmala-{uuid.uuid4().hex[:12]}@example.com",
        password_hash="x",
    )
    db_session.add(user)
    await db_session.flush()
    attempt = HifzAttempt(user_id=user.id, surah=7)
    db_session.add(attempt)
    await db_session.flush()
    db_session.add(
        HifzWordScore(
            attempt_id=attempt.id,
            surah=7,
            ayah=1,
            word_index=0,
            expected_text="بسم",
            status="basmala",
            prob=0.0,
            heard="بسم",
        )
    )
    await db_session.commit()
    with pytest.raises(sa.exc.IntegrityError):
        db_session.add(
            HifzWordScore(
                attempt_id=attempt.id,
                surah=7,
                ayah=1,
                word_index=1,
                expected_text="الله",
                status="bogus",
                prob=0.0,
            )
        )
        await db_session.flush()
    await db_session.rollback()
