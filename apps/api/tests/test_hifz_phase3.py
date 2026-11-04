"""تست‌های فاز ۳ قرآن — حفاظ (record-then-grade).

پوشش:
- تراز موقعیتی خالص (بدون شبکه، بدون مدل): تطابق دقیق، ادامه پس از
  جاافتادگی (کلمه و آیه)، تشکل، نزدیک/غلط، کلمهٔ اضافه، آستانه‌ها.
- قرارداد نمره‌دهی HTTP با ASR ماک (هرگز دانلود مدل واقعی): نمرهٔ آیه،
  ادامه پس از آیهٔ کاملاً جاافتاده، Peek، اعتراض، ایزولاسیون کاربر،
  رد صدای غیرWAV، خطای صادقانهٔ موتور بدون تعویض بی‌صدا، گذرایی صوت.
- تنظیمات: اعتبارسنج موتور و آستانه‌ها (ثبت کلیدها در SETTING_DEFS در
  test_settings_polish پوشش داده می‌شود).
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest

from app.modules.quran.alignment import align_words

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
    text = _tanzil_ayah(surah, ayah)
    return {
        "surah": surah,
        "ayah": ayah,
        "editions": [{"edition": "quran-uthmani", "text": text}],
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


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class _FakeEngine:
    """ASR ماک: رونویسی از پیش تعیین‌شده، بدون مدل."""

    def __init__(self, words: list[str]):
        from app.modules.quran.hifz_engines import HeardWord, Transcription

        self._transcription = Transcription(
            text=" ".join(words),
            words=[HeardWord(w) for w in words],
        )

    def transcribe(self, wav_bytes: bytes):
        assert wav_bytes[:4] == b"RIFF", "mock expects a WAV payload"
        return self._transcription


# ---------------------------------------------------------------------------
# تراز خالص
# ---------------------------------------------------------------------------


def test_align_exact_match_all_correct():
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    aligned, extra = align_words(expected, list(expected))
    assert [w.status for w in aligned] == ["correct"] * 4
    assert [w.prob for w in aligned] == [0.95] * 4
    assert extra == []


def test_align_skip_continuation_middle_words():
    """جاافتادگی وسط: کلمه‌های بعد هنوز نمره می‌گیرند، نه حذف."""
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ", "لَمْ"]
    heard = ["قُلْ", "هُوَ", "أَحَدٌ", "لَمْ"]
    aligned, extra = align_words(expected, heard)
    assert [w.status for w in aligned] == [
        "correct", "correct", "skipped", "correct", "correct",
    ]
    skipped = aligned[2]
    assert skipped.expected == "اللَّهُ" and skipped.mistake_type == "skipped"
    assert extra == []


def test_align_empty_heard_all_skipped():
    aligned, extra = align_words(["اللَّهُ", "الصَّمَدُ"], [])
    assert [w.status for w in aligned] == ["skipped", "skipped"]
    assert extra == []


def test_align_tashkeel_only_is_close_wrong_tashkeel():
    aligned, _ = align_words(["اللَّهُ"], ["اللَّهِ"])
    assert len(aligned) == 1
    assert aligned[0].status == "close"
    assert aligned[0].mistake_type == "wrong_tashkeel"


def test_align_near_and_wrong_and_extra():
    aligned, extra = align_words(["السماء", "الأرض"], ["السماع", "القمر", "زيادة"])
    assert aligned[0].status == "close"  # فاصلهٔ ویرایش ۱
    assert aligned[1].status == "wrong"
    assert extra == ["زيادة"]


def test_align_thresholds_change_status():
    """آستانه‌های CRM واقعاً وضعیت را عوض می‌کنند."""
    aligned, _ = align_words(["السماء"], ["السماع"], green=0.9, amber=0.7)
    assert aligned[0].status == "wrong"  # 0.65 زیر amber جدید
    aligned, _ = align_words(["قُلْ"], ["قُلْ"], green=0.9, amber=0.7)
    assert aligned[0].status == "correct"  # 0.95 بالای green جدید


def test_align_heard_prob_below_green_is_close_not_wrong():
    """کلمهٔ کاملاً مطابق با اطمینان پایین موتور: close، نه wrong."""
    aligned, _ = align_words(["قُلْ"], ["قُلْ"], heard_probs=[0.4])
    assert aligned[0].status == "close"
    assert aligned[0].prob == 0.4


# ---------------------------------------------------------------------------
# قرارداد HTTP با ASR ماک
# ---------------------------------------------------------------------------


async def test_hifz_status_engine_not_configured(tc):
    r = await tc["client"].get(f"{HIFZ}/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "zipformer"
    assert body["available"] is False
    assert "HIFZ_ZIPFORMER_MODEL_DIR" in body["reason"]


async def test_grade_ayah_mock_exact(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    words = _tanzil_ayah(112, 1).split()
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(words)
    )
    token = await _user_token(tc["client"], "hifz-grade@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    attempt_id = r.json()["id"]
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine_used"] == "zipformer"
    assert body["counts"]["correct"] == len(words)
    assert body["counts"]["wrong"] == 0 and body["counts"]["skipped"] == 0
    assert all(w["status"] == "correct" for w in body["words"])
    # صوت در هیچ پاسخی نیست.
    assert "audio" not in str(body)


async def test_grade_continues_after_fully_skipped_ayah(tc, monkeypatch):
    """آیهٔ ۲ کاملاً جاافتاده، آیهٔ ۳ بعدش نمره می‌گیرد (برخلاف ترتیل)."""
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    token = await _user_token(tc["client"], "hifz-skip@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]

    async def grade(ayah: int, heard: list[str]):
        monkeypatch.setattr(
            hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(heard)
        )
        return await tc["client"].post(
            f"{HIFZ}/attempts/{attempt_id}/grade",
            data={"surah": 112, "ayah": ayah},
            files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
            headers=_auth(token),
        )

    r = await grade(2, [])
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["skipped"] == 2
    words3 = _tanzil_ayah(112, 3).split()
    r = await grade(3, words3)
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["correct"] == len(words3)

    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    detail = r.json()
    by_ayah: dict[int, list[dict]] = {}
    for w in detail["words"]:
        by_ayah.setdefault(w["ayah"], []).append(w)
    assert all(w["status"] == "skipped" for w in by_ayah[2])
    assert all(w["status"] == "correct" for w in by_ayah[3])
    assert "audio" not in str(detail)


async def test_peek_records_mistake_not_score(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    token = await _user_token(tc["client"], "hifz-peek@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/peek",
        json={"surah": 112, "ayah": 1, "word_index": 0},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["word_index"] == 0
    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}", headers=_auth(token)
    )
    detail = r.json()
    assert detail["words"] == []  # Peek ردیف نمره نمی‌سازد
    assert len(detail["mistakes"]) == 1
    assert detail["mistakes"][0]["mistake_type"] == "peek"


async def test_dispute_marks_word(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    # کلمهٔ اول غلط شنیده شود.
    words = _tanzil_ayah(112, 1).split()
    heard = ["خطا", *words[1:]]
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(heard)
    )
    token = await _user_token(tc["client"], "hifz-dispute@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["words"][0]["status"] == "wrong"
    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}", headers=_auth(token)
    )
    word_id = r.json()["words"][0]["id"]
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/dispute",
        json={"word_score_id": word_id},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["disputed"] is True


async def test_engine_failure_is_honest_503_without_fallback(tc, monkeypatch):
    """موتور کلمه‌ای خراب → ۵۰۳ صادقانه؛ موتور دیگر هرگز بی‌صدا صدا نمی‌شود."""
    from app.modules.quran import hifz_engines, hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    # موتور انتخاب‌شده را ویسپر کن تا نگهبان خروجی واجی (زیپ‌فورمر)
    # مسیر خرابی موتور را پنهان نکند.
    async def _resolve(db):
        return "whisper_quran"

    monkeypatch.setattr(hifz_service.hifz_engines, "resolve_engine_id", _resolve)

    def _fail(_self, _wav: bytes):
        raise hifz_engines.EngineError("engine_load_failed", "model missing")

    def _must_not_run(_self, _wav: bytes):
        raise AssertionError("silent fallback to the other engine happened")

    monkeypatch.setattr(hifz_engines.WhisperQuranEngine, "transcribe", _fail)
    monkeypatch.setattr(hifz_engines.ZipformerEngine, "transcribe", _must_not_run)
    token = await _user_token(tc["client"], "hifz-fail@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "engine_load_failed"
    assert "words" not in r.json()  # هرگز نمرهٔ جعلی


async def test_phoneme_engine_without_mapping_still_503(tc, monkeypatch):
    """خروجی واجی زیپ‌فورمر بدون نگاشت، نمرهٔ کلمه‌ای نمی‌گیرد: ۵۰۳
    مشخص، بدون نمرهٔ جعلی. (با نگاشت، نمره‌دهی قطعه‌ای در
    test_hifz_phoneme_grade پوشش داده می‌شود.)"""
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )

    class _PhonemeMock:
        output_level = "phoneme"

        def transcribe(self, wav_bytes: bytes):
            from app.modules.quran.hifz_engines import HeardWord, Transcription

            return Transcription(text="qul", words=[HeardWord("qul")])

    def _raise():
        from app.modules.quran.hifz_mapping import MappingPendingError

        raise MappingPendingError("نگاشت پیکربندی نشده است")

    monkeypatch.setattr(hifz_service.hifz_mapping, "load_phoneme_mapping", _raise)
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _PhonemeMock()
    )
    token = await _user_token(tc["client"], "hifz-phoneme@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "hifz_word_alignment_pending"
    assert "words" not in r.json()


def test_zipformer_ctc_discovery(tmp_path):
    """کشف فایل زیپ‌فورمر: یک onnx (ترجیح int8) + tokens.txt — نه اجزای ترنسدیوسر."""
    from app.modules.quran.hifz_engines import ZipformerEngine

    d = tmp_path / "model"
    d.mkdir()
    assert "*.onnx" in ZipformerEngine._missing_files(str(d))[0]
    assert "tokens.txt" in ZipformerEngine._missing_files(str(d))
    (d / "zipformer_p_arabic_v3.1.onnx").write_bytes(b"fake")
    (d / "zipformer_p_arabic_v3.1.int8.onnx").write_bytes(b"fake")
    (d / "tokens.txt").write_text("a 0\n")
    assert ZipformerEngine._missing_files(str(d)) == []
    assert ZipformerEngine._onnx_path(str(d)).endswith("int8.onnx")


async def test_grade_rejects_non_wav_and_requires_auth(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    token = await _user_token(tc["client"], "hifz-format@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    # بدون توکن → ۴۰۱
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.webm", b"not-a-wav", "audio/webm")},
    )
    assert r.status_code == 401, r.text
    # با توکن ولی غیرWAV → ۴۲۲
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.webm", b"not-a-wav", "audio/webm")},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text


async def test_attempt_isolation_between_users(tc):
    token_a = await _user_token(tc["client"], "hifz-alice@example.com")
    token_b = await _user_token(tc["client"], "hifz-bob@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token_a)
    )
    attempt_id = r.json()["id"]
    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}", headers=_auth(token_b)
    )
    assert r.status_code == 404, r.text


def test_settings_validators():
    from app.core.platform_settings import _validate_json_setting

    assert _validate_json_setting("quran.asr_engine", "whisper_quran") == "whisper_quran"
    assert _validate_json_setting("quran.asr_engine", "zipformer") == "zipformer"
    with pytest.raises(ValueError):
        _validate_json_setting("quran.asr_engine", "other")
    assert _validate_json_setting(
        "quran.hifz_thresholds", {"green": 0.85, "amber": 0.6}
    ) == {"green": 0.85, "amber": 0.6}
    with pytest.raises(ValueError):
        _validate_json_setting("quran.hifz_thresholds", {"green": 0.5, "amber": 0.6})
    with pytest.raises(ValueError):
        _validate_json_setting("quran.hifz_thresholds", "nope")
