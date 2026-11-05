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
    StreamWord,
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
    assert [e for e in events if e["type"] == "extra"] == [
        {"type": "extra", "text": "سلام"}
    ]


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
async def test_live_counts_only_counts_words_and_skips(monkeypatch):
    """شمارنده‌های جلسه: کلمه‌های درست/نزدیک جدا از جاافتاده‌ها؛ بافر خالی."""
    events = []
    session, _ = _session(monkeypatch, events, mapping=_fake_mapping())
    await session.feed_phonemes(
        ["q", "u", "l"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
    )
    assert session.live_counts() == {"words": 3, "skipped": 1, "buffer_chars": 0}


# ---------------------------------------------------------------------------
# حلقهٔ WebSocket با سوکت و بازشناسِ ساختگی
# ---------------------------------------------------------------------------


class _FakeWebSocket:
    """سوکت ساختگی: پیام‌های ازپیش‌نوشته‌شده را می‌دهد، ارسال‌ها را ضبط می‌کند."""

    def __init__(self, messages):
        self._messages = list(messages)
        self.sent = []
        self.close_code = None

    async def receive(self):
        if not self._messages:
            raise WebSocketDisconnect()
        return self._messages.pop(0)

    async def send_json(self, event):
        self.sent.append(event)

    async def close(self, code=1000, reason=""):
        self.close_code = code


class _FakePhonemeRecognizer:
    """بازشناس ساختگی: هر قاب، واج‌های ازپیش‌نوشته‌شده را می‌دهد."""

    def __init__(self, chunks):
        self._chunks = list(chunks)

    def feed(self, pcm16: bytes):
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
    assert [e for e in ws.sent if e.get("type") == "error"] == [
        {"type": "error", "code": "unknown_message", "message": "پیام ناشناخته"}
    ]
    finals = [e for e in ws.sent if e.get("type") == "final"]
    assert len(finals) == 1 and finals[0]["ayahs"] == [1]
    assert ws.close_code == 1000
    assert stored and stored[0][0] == 1


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
    assert errors == [
        {
            "type": "error",
            "code": "hifz_stream_error",
            "message": "خطای داخلی در جریان زنده؛ دوباره تلاش کنید.",
        }
    ]
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
