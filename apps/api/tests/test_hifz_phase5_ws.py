"""تست‌های فاز ۵ حفاظ — قرارداد نسخه‌دار WebSocket + readiness + سقف‌ها.

پوشش:
- `parse_start_message`: نسخهٔ پیش‌فرض ۱، نسخهٔ ۲، نسخهٔ ناشناخته،
  فیلد ممنوع (جعل هویت/مالکیت)، اعلامِ قالبِ ناسازگار، بازهٔ surah/ayah.
- `LiveEventSequencer`: پاکت کامل، sequence_no یکنواختِ صعودی،
  event_id یکتا.
- `LiveSessionStateMachine`: گذرهای مجاز و نامجاز.
- `FrameRateLimiter` + `validate_frame`: سقف نرخ/اندازهٔ قاب.
- `LiveSession`: پاکت روی همهٔ رویدادها؛ correction به‌جای کلمهٔ
  تکراری؛ partial برای وسطِ کلمه؛ final_word برای کلمه‌های پایانی؛
  progress هنگام ورود به آیهٔ تازه؛ `note_audio` و `audio_ts_ms`.
- `serve_stream`: قابِ بدشکل/بیش‌ازحد (خطای روشن، بدون بستنِ
  فوری)؛ سیلِ قاب (هشدار + بستن ۴۴۰۹)؛ `listening` نخستین رویداد و
  `session_ended` پایانی.
- `start_live_session`: سورهٔ start با سورهٔ attempt نخواند → ۴۰۰.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from types import SimpleNamespace

import pytest
from fastapi import WebSocketDisconnect

from app.core.errors import APIError
from app.modules.quran import hifz_service
from app.modules.quran.hifz_mapping import Segment
from app.modules.quran.hifz_stream import (
    LiveSession,
    SherpaPhonemeStream,
    start_live_session,
)
from app.modules.quran.hifz_ws_contract import (
    MAX_FRAME_BYTES,
    FrameRateLimiter,
    LiveEventSequencer,
    LiveSessionState,
    LiveSessionStateMachine,
    parse_start_message,
    validate_frame,
)

# نگاشت مصنوعیِ قطعه‌ای (همانِ test_hifz_stream، برای آزمون قرارداد).
_AYAH_WORDS = {
    1: ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"],
    2: ["اللَّهُ", "الصَّمَدُ"],
}

_FAKE_SEGMENTS = {
    1: [
        Segment((0,), "qul"),
        Segment((1,), "huwa"),
        Segment((2,), "alah"),
        Segment((3,), "ahad"),
    ],
    2: [Segment((0,), "alah"), Segment((1,), "samad")],
}


class _FakeMapping:
    def segments_for(self, surah, ayah):
        if surah != 112:
            return None
        return list(_FAKE_SEGMENTS.get(ayah, [])) or None


async def _fake_ayah_words(db, surah: int, ayah: int):
    assert surah == 112
    return list(_AYAH_WORDS[ayah])


def _session(monkeypatch, events=None, start_ayah=1):
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
        mapping=_FakeMapping(),
    )
    session._ayah = start_ayah
    session._words = list(_AYAH_WORDS[start_ayah])
    session._index = 0
    session._touch(start_ayah)
    return session, stored


def _word_events(events):
    return [e for e in events if e["type"] == "word"]


# ---------------------------------------------------------------------------
# parse_start_message
# ---------------------------------------------------------------------------


def test_parse_start_v1_default_and_v2_ok():
    """بدون protocol_version یعنی نسخهٔ ۱؛ نسخهٔ ۲ با اعلامِ قابِ درست."""
    parsed = parse_start_message({"type": "start", "surah": 112, "ayah": 1})
    assert parsed["protocol_version"] == 1
    assert parsed["surah"] == 112 and parsed["ayah"] == 1
    parsed2 = parse_start_message(
        {
            "type": "start",
            "surah": 112,
            "ayah": 1,
            "protocol_version": 2,
            "audio": {
                "sample_rate": 16000,
                "channels": 1,
                "format": "pcm16le",
                "frame_samples": 4096,
            },
        }
    )
    assert parsed2["protocol_version"] == 2


def test_parse_start_rejects_unknown_version_and_forbidden_fields():
    """نسخهٔ ناشناخته و فیلدِ جعلِ هویت/مالکیت → خطای روشن."""
    with pytest.raises(APIError) as exc:
        parse_start_message(
            {"type": "start", "surah": 1, "ayah": 1, "protocol_version": 99}
        )
    assert exc.value.code == "hifz_protocol_unsupported"
    for forbidden in ("user_id", "attempt_id", "owner", "session_id"):
        with pytest.raises(APIError) as exc2:
            parse_start_message(
                {"type": "start", "surah": 1, "ayah": 1, forbidden: "x"}
            )
        assert exc2.value.code == "hifz_forbidden_field"


def test_parse_start_rejects_wrong_audio_format_and_ranges():
    """اعلامِ نرخِ دیگر (مثلاً ۴۸kHz) و surah/ayah خارج از بازه رد می‌شوند."""
    with pytest.raises(APIError) as exc:
        parse_start_message(
            {
                "type": "start",
                "surah": 1,
                "ayah": 1,
                "protocol_version": 2,
                "audio": {"sample_rate": 48000, "channels": 1, "format": "pcm16le"},
            }
        )
    assert exc.value.code == "hifz_audio_format_mismatch"
    with pytest.raises(APIError):
        parse_start_message({"type": "start", "surah": 200, "ayah": 1})
    with pytest.raises(APIError):
        parse_start_message({"type": "bogus", "surah": 1, "ayah": 1})


# ---------------------------------------------------------------------------
# Sequencer + state machine + limiter + frame validation
# ---------------------------------------------------------------------------


def test_sequencer_envelope_is_complete_and_monotonic():
    """پاکت: همهٔ فیلدهای قرارداد؛ sequence_no صعودی؛ event_id یکتا."""
    seq = LiveEventSequencer(session_id="sess-1")
    first = seq.envelope("stable_word", "correct", surah=112, ayah=1)
    second = seq.envelope("stable_word", "correct", surah=112, ayah=1)
    for event in (first, second):
        assert event["session_id"] == "sess-1"
        assert event["event_id"]
        assert event["event_type"] == "stable_word"
        assert event["type"] == "word"  # نامِ قدیمی می‌ماند
        assert event["status"] == "correct"
        assert event["audio_ts_ms"] == 0
    assert first["sequence_no"] == 1 and second["sequence_no"] == 2
    assert first["event_id"] != second["event_id"]


def test_state_machine_happy_path_and_invalid_transition():
    """مسیرِ خوش: idle تا completed؛ گذرِ نامجاز خطا می‌دهد."""
    machine = LiveSessionStateMachine()
    assert machine.state == LiveSessionState.IDLE
    machine.transition(LiveSessionState.CONNECTING)
    machine.transition(LiveSessionState.CONNECTED)
    machine.transition(LiveSessionState.ENGINE_LOADING)
    machine.transition(LiveSessionState.AUDIO_READY)
    machine.transition(LiveSessionState.LISTENING)
    machine.transition(LiveSessionState.PROCESSING)
    machine.transition(LiveSessionState.STOPPING)
    machine.transition(LiveSessionState.COMPLETED)
    with pytest.raises(ValueError):
        machine.transition(LiveSessionState.LISTENING)
    machine2 = LiveSessionStateMachine()
    with pytest.raises(ValueError):
        machine2.transition(LiveSessionState.LISTENING)


def test_frame_rate_limiter_burst_then_blocks_then_refills():
    """سطل توکن: انفجار مجاز است، بعد مسدود می‌شود، با زمان پر می‌شود."""
    limiter = FrameRateLimiter(rate_per_second=10, burst=3)
    assert [limiter.allow(now=1000.0) for _ in range(3)] == [True, True, True]
    assert limiter.allow(now=1000.0) is False
    # پس از ۰٫۲ ثانیه، ۲ توکن پر شده است.
    assert limiter.allow(now=1000.2) is True
    assert limiter.allow(now=1000.2) is True
    assert limiter.allow(now=1000.2) is False


def test_validate_frame_accepts_rejects():
    """قابِ معتبر، طولِ فرد، و بیش‌ازحد."""
    assert validate_frame(b"\x00\x00" * 4096) is None
    assert validate_frame(b"\x00") == "hifz_frame_malformed"
    assert validate_frame(b"\x00" * (MAX_FRAME_BYTES + 2)) == "hifz_frame_too_large"


# ---------------------------------------------------------------------------
# LiveSession: پاکت، correction، partial، final_word، progress، ساعت صوتی
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_session_events_carry_envelope(monkeypatch):
    """هر رویداد نشست، پاکت کامل دارد و sequence_no صعودی است."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_phonemes(
        ["q", "u", "l"] + ["h", "u", "w", "a"] + ["a", "l", "a", "h"]
    )
    assert len(events) >= 3
    seqs = []
    for event in events:
        assert event["session_id"] == str(session.attempt.id)
        assert event["event_id"]
        assert event["event_type"]
        assert "status" in event
        assert isinstance(event["audio_ts_ms"], int)
        seqs.append(event["sequence_no"])
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    words = _word_events(events)
    assert words[0]["event_type"] == "stable_word"
    assert words[0]["confidence"] == 0.95
    assert words[0]["type"] == "word"  # سازگاری با کلاینت قدیمی


@pytest.mark.asyncio
async def test_repeated_slot_emits_correction_not_duplicate(monkeypatch):
    """همان خانه دوباره نوشته نمی‌شود؛ اصلاحیه با corrects_event_id می‌آید."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_phonemes(["q", "u", "l"])
    first = _word_events(events)[0]
    assert first["expected"] == "قُلْ" and first["status"] == "correct"
    # تصمیمِ بعدی برای همان خانه (مثلاً بازبینی): مستقیم صدا می‌زنیم.
    session._emit_word(1, 0, "قُلْ", "close", 0.65, "قُلْ", "wrong_tashkeel")
    words = _word_events(events)
    assert len(words) == 1  # تکراری نماند
    corrections = [e for e in events if e["event_type"] == "correction"]
    assert len(corrections) == 1
    assert corrections[0]["corrects_event_id"] == first["event_id"]
    assert corrections[0]["status"] == "close"
    assert corrections[0]["reason"] == "wrong_tashkeel"
    assert corrections[0]["word_index"] == 0 and corrections[0]["ayah"] == 1


@pytest.mark.asyncio
async def test_partial_emitted_once_per_unit_while_mid_word(monkeypatch):
    """وسطِ کلمه (بافر، پیشوندِ واحدِ جاری) → یک partial؛ کلمه نوشته نمی‌شود."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_phonemes(["q", "u"])  # پیشوندِ «qul»
    partials = [e for e in events if e["event_type"] == "partial"]
    assert len(partials) == 1
    assert partials[0]["expected"] == "قُلْ"
    assert partials[0]["ayah"] == 1 and partials[0]["word_index"] == 0
    assert partials[0]["status"] == "partial"
    assert _word_events(events) == []
    # واجِ بیشتر برای همان واحد، partial تازه نمی‌سازد.
    await session.feed_phonemes(["l"])
    assert [e for e in events if e["event_type"] == "partial"] == partials
    assert len(_word_events(events)) == 1


@pytest.mark.asyncio
async def test_finish_trailing_words_are_final_word(monkeypatch):
    """کلمه‌های پایانیِ finish با event_type final_word می‌آیند."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_phonemes(["q", "u", "l"])
    await session.finish()
    finals = [e for e in events if e["event_type"] == "final_word"]
    assert [(w["ayah"], w["expected"], w["status"]) for w in finals] == [
        (1, "هُوَ", "skipped"),
        (1, "اللَّهُ", "skipped"),
        (1, "أَحَدٌ", "skipped"),
    ]
    assert all(w["type"] == "word" for w in finals)


@pytest.mark.asyncio
async def test_progress_emitted_on_ayah_advance(monkeypatch):
    """ورود به آیهٔ تازه → رویداد progress با شمارنده‌ها."""
    events = []
    session, _ = _session(monkeypatch, events)
    await session.feed_phonemes(
        ["q", "u", "l"]
        + ["h", "u", "w", "a"]
        + ["a", "l", "a", "h"]
        + ["a", "h", "a", "d"]
        + ["a", "l", "a", "h"]  # آیهٔ ۲
    )
    progress = [e for e in events if e["event_type"] == "progress"]
    assert len(progress) >= 1
    assert progress[-1]["ayah"] == 2
    # progress هنگام ورود به آیهٔ ۲ می‌آید، یعنی پیش از کلمهٔ پنجم:
    # ۴ کلمهٔ آیهٔ ۱ تا آن لحظه نوشته شده‌اند.
    assert progress[-1]["words"] == 4
    assert len(_word_events(events)) == 5


def test_note_audio_advances_audio_clock():
    """ساعتِ صوتی: ۴۰۹۶ نمونه در ۱۶ کیلوهرتز = ۲۵۶ میلی‌ثانیه."""
    attempt = SimpleNamespace(id=uuid.uuid4())
    session = LiveSession(
        db=None,
        attempt=attempt,
        surah=112,
        start_ayah=1,
        green=0.8,
        amber=0.5,
        sender=None,
        mapping=_FakeMapping(),
    )
    assert session._audio_ms == 0
    session.note_audio(4096)
    assert session._audio_ms == 256
    session.note_audio(8000)
    assert session._audio_ms == 756


# ---------------------------------------------------------------------------
# serve_stream: اعتبارسنجی قاب، سقف نرخ، پایان نشست
# ---------------------------------------------------------------------------


class _FakeWebSocket:
    """سوکت ساختگی (همانِ test_hifz_stream)."""

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


class _CloseRecordingWebSocket(_FakeWebSocket):
    def __init__(self, messages):
        super().__init__(messages)
        self.close_codes: list[int] = []

    async def close(self, code=1000, reason=""):
        self.close_codes.append(code)
        await super().close(code, reason)


class _FakePhonemeRecognizer:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.calls = 0

    def feed(self, pcm16: bytes):
        self.calls += 1
        return self._chunks.pop(0) if self._chunks else []

    def flush(self):
        return []


@pytest.mark.asyncio
async def test_serve_stream_malformed_frame_rejected_not_fed(monkeypatch):
    """قابِ با طولِ فرد → خطای روشنِ غیرکشنده؛ قاب خورانده نمی‌شود؛
    نشست ادامه پیدا می‌کند و با end ذخیره می‌شود."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, stored = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    ws = _FakeWebSocket(
        [
            {"bytes": b"\x00"},  # طولِ فرد: Int16LE ناقص
            {"bytes": b"\x00\x00" * 100},
            {"text": json.dumps({"type": "end"})},
        ]
    )
    recognizer = _FakePhonemeRecognizer(
        [["q", "u", "l", "a", "l", "a", "h", "a", "h", "a", "d"]]
    )
    await serve_stream(ws, session, recognizer, queue)
    assert recognizer.calls == 1
    errors = [e for e in ws.sent if e.get("code") == "hifz_frame_malformed"]
    assert len(errors) == 1
    assert errors[0]["fatal"] is False
    assert errors[0]["event_type"] == "error"
    assert ws.close_code == 1000
    assert stored and stored[0][0] == 1


@pytest.mark.asyncio
async def test_serve_stream_oversize_frame_rejected_then_closed(monkeypatch):
    """قابِ بیش‌ازحد → خطا؛ سه‌بارِ پی‌درپی → بستن ۱۰۰۹."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, _ = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    big = b"\x00" * (MAX_FRAME_BYTES + 2)
    ws = _CloseRecordingWebSocket(
        [{"bytes": big}, {"bytes": big}, {"bytes": big}]
    )
    recognizer = _FakePhonemeRecognizer([[]])
    await serve_stream(ws, session, recognizer, queue)
    assert recognizer.calls == 0
    errors = [e for e in ws.sent if e.get("code") == "hifz_frame_too_large"]
    assert len(errors) == 3
    assert 1009 in ws.close_codes


@pytest.mark.asyncio
async def test_serve_stream_rate_flood_warns_then_closes(monkeypatch):
    """سیلِ قاب → نخست هشدار، بعد بستن ۴۴۰۹؛ قاب‌های مجاز خورانده شدند."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, _ = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    ws = _CloseRecordingWebSocket(
        [{"bytes": b"\x00\x00" * 100} for _ in range(8)]
    )
    recognizer = _FakePhonemeRecognizer([[] for _ in range(8)])
    limiter = FrameRateLimiter(rate_per_second=1, burst=2)
    await serve_stream(ws, session, recognizer, queue, rate_limiter=limiter)
    assert recognizer.calls == 2
    warnings = [e for e in ws.sent if e.get("code") == "hifz_rate_limited"]
    assert len(warnings) == 2  # یکی هشدارِ غیرکشنده، یکی خطای کشنده
    assert warnings[0]["event_type"] == "warning"
    assert warnings[1]["event_type"] == "error"
    assert 4409 in ws.close_codes


@pytest.mark.asyncio
async def test_serve_stream_session_ended_after_disconnect(monkeypatch):
    """قطعِ بدون end: چیزی ذخیره نمی‌شود ولی `session_ended` با دلیل
    disconnect می‌آید."""
    from app.modules.quran.hifz_router import serve_stream

    events = []
    session, stored = _session(monkeypatch, events)
    queue: asyncio.Queue = asyncio.Queue()
    session.sender = queue.put_nowait
    ws = _FakeWebSocket([{"bytes": b"\x00\x00" * 100}])
    recognizer = _FakePhonemeRecognizer([["q", "u", "l"]])
    await serve_stream(ws, session, recognizer, queue)
    assert stored == []
    ended = [e for e in ws.sent if e.get("event_type") == "session_ended"]
    assert len(ended) == 1
    assert ended[0]["reason"] == "disconnect"
    assert ended[0]["state"] == "failed"
    assert ended[0]["audio_ms"] == 6  # ۱۰۰ نمونه در ۱۶ کیلوهرتز


# ---------------------------------------------------------------------------
# warmup بازشناس + سورهٔ start در برابر attempt
# ---------------------------------------------------------------------------


def _fake_sherpa_stream(monkeypatch, tmp_path):
    """sherpaی ساختگی + پوشهٔ مدلِ ساختگی (فقط برای آزمون warmup)."""
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "model.int8.onnx").write_bytes(b"fake")
    (model_dir / "tokens.txt").write_text("<blank> 250\n", encoding="utf-8")
    monkeypatch.setenv("HIFZ_ZIPFORMER_MODEL_DIR", str(model_dir))

    class _Stream:
        def __init__(self):
            self.accepted = 0

        def accept_waveform(self, sample_rate, samples):
            self.accepted += 1

        def input_finished(self):
            pass

    class _Recognizer:
        def __init__(self):
            self._stream = _Stream()
            self.decode_calls = 0

        def create_stream(self):
            return self._stream

        def is_ready(self, stream):
            return stream.accepted >= 2

        def decode_stream(self, stream):
            self.decode_calls += 1

        def get_result_as_json_string(self, stream):
            return json.dumps({"tokens": [], "text": ""})

    fake_module = SimpleNamespace(
        OnlineRecognizer=SimpleNamespace(
            from_zipformer2_ctc=lambda **kwargs: _Recognizer()
        )
    )
    monkeypatch.setitem(sys.modules, "sherpa_onnx", fake_module)
    return SherpaPhonemeStream()


def test_sherpa_warmup_feeds_silence_and_decodes(monkeypatch, tmp_path):
    """warmup: نیم ثانیه سکوت از مسیر بومی می‌گذرد و دیکد می‌شود."""
    stream = _fake_sherpa_stream(monkeypatch, tmp_path)
    ms = stream.warmup()
    assert ms >= 0.0
    assert stream._stream.accepted >= 1


@pytest.mark.asyncio
async def test_start_live_session_surah_mismatch_is_400(monkeypatch):
    """سورهٔ start با سورهٔ attempt نخواند → ۴۰۰ صادقانه، پیش از موتور."""

    async def fake_attempt_or_404(db, user, attempt_id):
        return SimpleNamespace(id=attempt_id, user_id=user.id, surah=112)

    monkeypatch.setattr(
        hifz_service, "_attempt_or_404", fake_attempt_or_404
    )
    user = SimpleNamespace(id=uuid.uuid4())
    with pytest.raises(APIError) as exc:
        await start_live_session(
            None, user, uuid.uuid4(), 1, 1, lambda e: None
        )
    assert exc.value.status_code == 400
    assert exc.value.code == "hifz_stream_surah_mismatch"
