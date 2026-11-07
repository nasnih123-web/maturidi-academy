"""تست‌های فاز ۱۱ حفاظ — امنیت، حریم خصوصی و مهاجرت داده.

پوشش:
- آپلود صوتی با سقف (read_capped_upload در روتر، نه audio.read بی‌سقف).
- عدم افشای مسیر/جزئیات داخلی در /hifz/status و پیام‌های خطای موتور/نگاشت.
- سقف اتصال زندهٔ هم‌زمان (LiveStreamLimiter: هر کاربر ۱، کل ۴).
- بررسی Origin در handshake وب‌سوکت (check_ws_origin).
- حذف آزمون و برنامه (مالکیت + cascade)؛ rate limit روی endpointهای صوتی.
"""

from __future__ import annotations

import io
import uuid
import wave
from types import SimpleNamespace

import pytest

from app.modules.quran import hifz_service
from app.modules.quran.hifz_mapping import (
    MappingPendingError,
    _load_tanzil,
    _load_tokens,
    map_files_present,
)
from app.modules.quran.hifz_ws_contract import (
    LiveStreamLimiter,
    live_stream_limiter,
)

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"


def _wav_bytes(frames: int = 1600) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


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


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _make_attempt(client, token: str) -> str:
    r = await client.post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# ۱. سقف آپلود صوتی (chunked هم نمی‌تواند سقف را دور بزند)
# ---------------------------------------------------------------------------


async def test_grade_upload_over_cap_is_413(tc, monkeypatch):
    """آپلود بزرگ‌تر از سقف، پیش از خواندن کامل، ۴۱۳ می‌گیرد."""
    token = await _user_token(tc["client"], "hifz-cap@example.com")
    attempt_id = await _make_attempt(tc["client"], token)
    monkeypatch.setattr(hifz_service, "MAX_AUDIO_BYTES", 100)
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("recitation.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 413, r.text
    assert r.json()["error"]["code"] == "hifz_audio_too_large"


async def test_voice_search_upload_over_cap_is_413(tc, monkeypatch):
    token = await _user_token(tc["client"], "hifz-cap-vs@example.com")
    monkeypatch.setattr(hifz_service, "MAX_AUDIO_BYTES", 100)
    r = await tc["client"].post(
        f"{HIFZ}/voice-search",
        files={"audio": ("recitation.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 413, r.text
    assert r.json()["error"]["code"] == "hifz_audio_too_large"


# ---------------------------------------------------------------------------
# ۲. عدم افشای مسیر/جزئیات داخلی در پیام‌های عمومی
# ---------------------------------------------------------------------------


def test_model_dir_reason_has_no_filesystem_path(monkeypatch, tmp_path):
    """دلیلِ «دایرکتوری مدل نیست»، مسیر مطلق ندارد (فقط نام متغیر)."""
    from app.modules.quran.hifz_engines import _model_dir

    secret = tmp_path / "secret-models"
    monkeypatch.setenv("HIFZ_ZIPFORMER_MODEL_DIR", str(secret))
    d, reason = _model_dir("HIFZ_ZIPFORMER_MODEL_DIR")
    assert d is None
    assert str(secret) not in reason
    assert "HIFZ_ZIPFORMER_MODEL_DIR" in reason


def test_map_files_present_reason_has_no_filesystem_path(tmp_path):
    """دلیلِ «فایل نگاشت نیست»، مسیر مطلق ندارد."""
    empty = tmp_path / "empty-map"
    empty.mkdir()
    ok, reason = map_files_present(empty)
    assert ok is False
    assert str(empty) not in reason
    assert reason == "map file missing or empty"


def test_mapping_pending_errors_are_generic(tmp_path):
    """خطای بارگذاری نگاشت، مسیر/جزئیات OSError را لو نمی‌دهد."""
    missing = tmp_path / "no-such-dir" / "tokens.txt"
    with pytest.raises(MappingPendingError) as excinfo:
        _load_tokens(missing)
    assert str(missing) not in str(excinfo.value)
    assert "Errno" not in str(excinfo.value)
    with pytest.raises(MappingPendingError) as excinfo:
        _load_tanzil(tmp_path / "nope.txt")
    assert "nope.txt" not in str(excinfo.value)


async def test_status_with_bad_model_dir_leaks_no_path(tc, monkeypatch):
    """GET /status عمومی، مسیر دیسک را برنمی‌گرداند."""
    monkeypatch.setenv("HIFZ_ZIPFORMER_MODEL_DIR", "/srv/secret/models")
    monkeypatch.setenv("QURAN_PHONEME_MAP_DIR", "/srv/secret/map")
    r = await tc["client"].get(f"{HIFZ}/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert "/srv/secret" not in body["reason"]
    assert "/srv/secret" not in body["map_reason"]


def test_engine_transcription_error_is_generic(monkeypatch):
    """خطای رونویسی موتور، جزئیات استثنای بومی را به کلاینت نمی‌دهد."""
    from app.modules.quran import hifz_engines

    engine = hifz_engines.ZipformerEngine()
    monkeypatch.setattr(engine, "is_configured", lambda: (True, ""))

    def _boom():
        raise RuntimeError("boom /srv/secret/model.onnx exploded")

    monkeypatch.setattr(engine, "_load", _boom)
    with pytest.raises(hifz_engines.EngineError) as excinfo:
        engine.transcribe(_wav_bytes())
    assert excinfo.value.code == "engine_transcription_failed"
    assert "/srv/secret" not in excinfo.value.message
    assert "boom" not in excinfo.value.message


# ---------------------------------------------------------------------------
# ۳. سقف اتصال زندهٔ هم‌زمان
# ---------------------------------------------------------------------------


async def test_live_stream_limiter_per_user_and_total():
    limiter = LiveStreamLimiter(max_per_user=1, max_total=2)
    u1, u2, u3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert await limiter.try_acquire(u1) is True
    assert await limiter.try_acquire(u1) is False  # سقف هر کاربر: ۱
    assert await limiter.try_acquire(u2) is True
    assert await limiter.try_acquire(u3) is False  # سقف کل: ۲
    assert limiter.active_total() == 2
    assert limiter.active_for(u1) == 1
    await limiter.release(u1)
    assert limiter.active_total() == 1
    assert await limiter.try_acquire(u3) is True
    await limiter.release(u1)  # آزادسازیِ اضافه، بی‌اثر و بی‌خطا
    assert limiter.active_total() == 2
    await limiter.release(u2)
    await limiter.release(u3)
    assert limiter.active_total() == 0


def test_live_stream_limiter_defaults():
    """مقادیر پیش‌فرض: هر کاربر ۱، کل فرایند ۴."""
    assert live_stream_limiter.active_total() == 0
    from app.modules.quran.hifz_ws_contract import (
        MAX_LIVE_STREAMS_PER_USER,
        MAX_LIVE_STREAMS_TOTAL,
    )

    assert MAX_LIVE_STREAMS_PER_USER == 1
    assert MAX_LIVE_STREAMS_TOTAL == 4


# ---------------------------------------------------------------------------
# ۴. بررسی Origin در handshake وب‌سوکت
# ---------------------------------------------------------------------------


def test_check_ws_origin(monkeypatch):
    from app.core import realtime

    monkeypatch.setattr(
        realtime,
        "get_settings",
        lambda: SimpleNamespace(cors_allow_origins="https://academy.example,https://web.example"),
    )

    def ws(origin):
        headers = {} if origin is None else {"origin": origin}
        return SimpleNamespace(headers=headers)

    assert realtime.check_ws_origin(ws(None)) is True  # موبایل/تست
    assert realtime.check_ws_origin(ws("null")) is True  # opaque origin
    assert realtime.check_ws_origin(ws("https://academy.example")) is True
    assert realtime.check_ws_origin(ws("https://web.example")) is True
    assert realtime.check_ws_origin(ws("https://evil.example")) is False


def test_check_ws_origin_no_allowlist_allows_all(monkeypatch):
    from app.core import realtime

    monkeypatch.setattr(
        realtime, "get_settings", lambda: SimpleNamespace(cors_allow_origins="")
    )
    ws = SimpleNamespace(headers={"origin": "https://anything.example"})
    assert realtime.check_ws_origin(ws) is True


# ---------------------------------------------------------------------------
# ۵. حذف آزمون و برنامه (مالکیت + cascade)
# ---------------------------------------------------------------------------


async def test_delete_test_owner_and_cascade(tc):
    token = await _user_token(tc["client"], "hifz-del-test@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/tests",
        json={
            "surah_start": 112, "surah_end": 114, "question_count": 2,
            "time_limit_minutes": 30, "question_length": "short",
            "stop_rule": "ayah_end",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    test_id = r.json()["id"]
    assert len(r.json()["questions"]) == 2
    r = await tc["client"].delete(f"{HIFZ}/tests/{test_id}", headers=_auth(token))
    assert r.status_code == 204, r.text
    r = await tc["client"].get(f"{HIFZ}/tests/{test_id}", headers=_auth(token))
    assert r.status_code == 404
    r = await tc["client"].delete(f"{HIFZ}/tests/{test_id}", headers=_auth(token))
    assert r.status_code == 404


async def test_delete_test_other_user_is_404(tc):
    token = await _user_token(tc["client"], "hifz-del-test-a@example.com")
    other = await _user_token(tc["client"], "hifz-del-test-b@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/tests",
        json={
            "surah_start": 112, "surah_end": 114, "question_count": 1,
            "question_length": "short", "stop_rule": "ayah_end",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    test_id = r.json()["id"]
    r = await tc["client"].delete(f"{HIFZ}/tests/{test_id}", headers=_auth(other))
    assert r.status_code == 404
    r = await tc["client"].get(f"{HIFZ}/tests/{test_id}", headers=_auth(token))
    assert r.status_code == 200  # مالک هنوز می‌بیندش


async def test_delete_plan_owner_and_cascade(tc):
    token = await _user_token(tc["client"], "hifz-del-plan@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/plans",
        json={
            "title": "برنامهٔ حذف",
            "kind": "memorize",
            "direction": "normal",
            "start_surah": 113, "start_ayah": 1,
            "end_surah": 114, "end_ayah": 3,
            "daily_target_new": 2, "daily_target_review": 5,
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    plan_id = r.json()["id"]
    assert r.json()["total_ayahs"] == 8
    r = await tc["client"].delete(f"{HIFZ}/plans/{plan_id}", headers=_auth(token))
    assert r.status_code == 204, r.text
    r = await tc["client"].get(f"{HIFZ}/plans/{plan_id}", headers=_auth(token))
    assert r.status_code == 404
    r = await tc["client"].get(f"{HIFZ}/plans", headers=_auth(token))
    assert r.status_code == 200
    assert all(p["id"] != plan_id for p in r.json())


async def test_delete_plan_other_user_is_404(tc):
    token = await _user_token(tc["client"], "hifz-del-plan-a@example.com")
    other = await _user_token(tc["client"], "hifz-del-plan-b@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/plans",
        json={
            "title": "برنامهٔ دیگری",
            "kind": "memorize",
            "direction": "normal",
            "start_surah": 113, "start_ayah": 1,
            "end_surah": 113, "end_ayah": 5,
            "daily_target_new": 1, "daily_target_review": 5,
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    plan_id = r.json()["id"]
    r = await tc["client"].delete(f"{HIFZ}/plans/{plan_id}", headers=_auth(other))
    assert r.status_code == 404
    r = await tc["client"].get(f"{HIFZ}/plans/{plan_id}", headers=_auth(token))
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# ۶. rate limit روی endpointهای صوتی (۳۰ در دقیقه برای هر نشست)
# ---------------------------------------------------------------------------


async def test_grade_rate_limited_after_30(tc, monkeypatch):
    """۳۱مین نمره‌دهی در یک دقیقه، ۴۲۹ می‌گیرد (نه ۵۰۰/۲۰۰)."""
    from app.modules.quran.hifz_engines import HeardWord, Transcription

    token = await _user_token(tc["client"], "hifz-rl@example.com")
    attempt_id = await _make_attempt(tc["client"], token)

    class _FakeEngine:
        output_level = "word"

        def transcribe(self, wav_bytes: bytes):
            return Transcription(
                text="قُلْ", words=[HeardWord("قُلْ", 1.0)]
            )

    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine()
    )
    from app.modules.quran import hifz_service as _svc

    async def _fake_bundle(db, surah: int, ayah: int, **kwargs):
        return {
            "surah": surah,
            "ayah": ayah,
            "editions": [{"edition": "quran-uthmani", "text": "قُلْ هُوَ اللَّهُ أَحَدٌ"}],
        }

    monkeypatch.setattr(_svc.quran_service, "get_ayah_bundle", _fake_bundle)
    last_status = None
    for _ in range(31):
        r = await tc["client"].post(
            f"{HIFZ}/attempts/{attempt_id}/grade",
            data={"surah": 112, "ayah": 1},
            files={"audio": ("recitation.wav", _wav_bytes(), "audio/wav")},
            headers=_auth(token),
        )
        last_status = r.status_code
    assert last_status == 429, f"expected 429 on the 31st call, got {last_status}"


def test_hifz_audio_rate_limit_key_is_session_scoped():
    """کلید نرخ، بر اساس نشست است — نه IP مشترک (VPN)."""
    from app.modules.quran.hifz_router import _hifz_audio_rl_key

    req = SimpleNamespace(state=SimpleNamespace(session_id=uuid.uuid4()))
    assert _hifz_audio_rl_key(req).startswith("hifz-audio:")
    assert "unknown" not in _hifz_audio_rl_key(req)
    req2 = SimpleNamespace(state=SimpleNamespace())
    assert _hifz_audio_rl_key(req2) == "hifz-audio:unknown"
