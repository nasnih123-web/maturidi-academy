"""تست‌های فاز ۴ بازطراحی حفاظ — چرخهٔ نشست، تنظیم‌ها، Peek، برگهٔ خطاها، تراز.

پوشش (بدون مدل واقعی؛ ASR ماکِ کلمه‌ای مثل فاز ۳):
- تنظیم‌های حفظِ هر کاربر: پیش‌فرض‌ها (یخ‌زدن خاموش = پرمیوم)،
  به‌روزرسانیِ جزئی، ماندگاری.
- نشست: بازه/تکرار در ساخت، بازهٔ نامعتبر ۴۲۲، ثبت موقعیت، مکثِ
  سرور-side، ازسرگیری، یافتنِ نشستِ قابل‌ازسرگیری، موقعیت روی
  نشستِ تکمیل‌شده ۴۰۹.
- نمره‌دهیِ واقعی (نه شبیه‌سازی): کلمهٔ جاافتاده، کلمهٔ اضافه
  (فقط در برگهٔ خطاها، هرگز روی صفحه)، کلمهٔ تکراری، تلفظِ غلط،
  جابه‌جاییِ دو کلمهٔ مجاور (transposed).
- برگهٔ خطاها (گروهی): کارت «كلمات خاطئة» با موردانتظار/خوانده‌شده
  + کارت «كلمات زائدة»، حذفِ تکیِ یک خطا (+ ۴۰۴ برای دیگری).
- Peek: kind نامعتبر ۴۲۲؛ kind=ayah بدون word_indices ۴۲۲.
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

from app.modules.quran import hifz_service
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
# ترازِ کلمه‌ای (واحد): جابه‌جایی، جاافتادن، اضافه، تکرار، تلفظ غلط
# ---------------------------------------------------------------------------


def test_align_transposed_adjacent_words():
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    heard = ["هُوَ", "قُلْ", "اللَّهُ", "أَحَدٌ"]
    aligned, extra = align_words(expected, heard)
    by_index = {w.word_index: w for w in aligned}
    assert by_index[0].status == "wrong"
    assert by_index[0].mistake_type == "transposed"
    assert by_index[0].heard == "هُوَ"
    assert by_index[1].status == "wrong"
    assert by_index[1].mistake_type == "transposed"
    assert by_index[1].heard == "قُلْ"
    assert by_index[2].status == "correct"
    assert by_index[3].status == "correct"
    assert extra == []


def test_align_transposed_does_not_fire_for_non_adjacent():
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    heard = ["اللَّهُ", "هُوَ", "قُلْ", "أَحَدٌ"]
    aligned, _ = align_words(expected, heard)
    assert not any(w.mistake_type == "transposed" for w in aligned)


def test_align_skipped_extra_repeated():
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    # جاافتادنِ کلمهٔ دوم
    aligned, extra = align_words(expected, ["قُلْ", "اللَّهُ", "أَحَدٌ"])
    assert [w.status for w in aligned] == ["correct", "skipped", "correct", "correct"]
    assert aligned[1].mistake_type == "skipped"
    assert extra == []
    # کلمهٔ اضافه در انتها — هرگز به‌عنوان کلمهٔ موردانتظار نمی‌نشیند
    aligned, extra = align_words(expected, expected + ["زائد"])
    assert all(w.status == "correct" for w in aligned)
    assert extra == ["زائد"]
    # تکرارِ کلمهٔ اول — یک بار درست، بار دوم اضافه
    aligned, extra = align_words(expected, ["قُلْ", "قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"])
    assert all(w.status == "correct" for w in aligned)
    assert extra == ["قُلْ"]


def test_align_mispronunciation_is_wrong_not_skipped():
    expected = ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]
    aligned, extra = align_words(expected, ["قُلْ", "غلط", "اللَّهُ", "أَحَدٌ"])
    assert aligned[1].status == "wrong"
    assert aligned[1].mistake_type == "wrong_word"
    assert aligned[1].heard == "غلط"
    assert extra == []


# ---------------------------------------------------------------------------
# تنظیم‌های حفظِ هر کاربر
# ---------------------------------------------------------------------------


async def test_hifz_settings_defaults_and_update(tc):
    token = await _user_token(tc["client"], "p4-settings@example.com")
    r = await tc["client"].get(f"{HIFZ}/settings", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    # پیش‌فرض‌ها = رفتار پرمیومِ ویدیوها: بدون یخ‌زدن، کشف خطا روشن.
    assert body["freeze_on_error"] is False
    assert body["mistake_detection"] is True
    assert body["tashkeel_detection"] is True
    assert body["resumable_sessions"] is False
    assert body["hide_ayah_markers"] is False

    r = await tc["client"].put(
        f"{HIFZ}/settings",
        json={"freeze_on_error": True, "hide_ayah_markers": True},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["freeze_on_error"] is True
    assert body["hide_ayah_markers"] is True
    # فیلدهای نفرستاده‌شده دست نمی‌خورند.
    assert body["mistake_detection"] is True

    r = await tc["client"].get(f"{HIFZ}/settings", headers=_auth(token))
    assert r.json()["freeze_on_error"] is True
    assert r.json()["hide_ayah_markers"] is True


async def test_hifz_settings_require_auth(tc):
    r = await tc["client"].get(f"{HIFZ}/settings")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# نشست: بازه/تکرار، موقعیت، مکث، ازسرگیری
# ---------------------------------------------------------------------------


async def test_attempt_range_and_repeat(tc):
    token = await _user_token(tc["client"], "p4-range@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={
            "surah": 112,
            "page": 604,
            "start_ayah": 1,
            "end_ayah": 3,
            "repeat_ayah": 3,
            "repeat_range": 2,
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["start_ayah"] == 1 and body["end_ayah"] == 3
    assert body["repeat_ayah"] == 3 and body["repeat_range"] == 2
    assert body["current_surah"] == 112 and body["current_ayah"] == 1

    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "start_ayah": 3, "end_ayah": 1},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text


async def test_attempt_position_pause_resume(tc):
    token = await _user_token(tc["client"], "p4-session@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]

    # یافتنِ نشستِ قابل‌ازسرگیری: همین نشستِ باز است.
    r = await tc["client"].get(f"{HIFZ}/attempts/resume", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == attempt_id

    # ثبت موقعیت (مثلاً کاربر تا آیهٔ ۳ کلمهٔ ۲ پیش رفته).
    r = await tc["client"].patch(
        f"{HIFZ}/attempts/{attempt_id}/position",
        json={"current_surah": 112, "current_ayah": 3, "current_word_index": 2},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["current_ayah"] == 3
    assert r.json()["current_word_index"] == 2

    # مکثِ سرور-side، بعد ازسرگیری از همان موقعیت.
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/pause", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paused"
    r = await tc["client"].get(f"{HIFZ}/attempts/resume", headers=_auth(token))
    assert r.json()["id"] == attempt_id
    assert r.json()["status"] == "paused"
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/resume", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_progress"
    assert r.json()["current_ayah"] == 3

    # نشستِ تکمیل‌شده دیگر موقعیت نمی‌گیرد و قابل‌ازسرگیری نیست.
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/complete", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    r = await tc["client"].patch(
        f"{HIFZ}/attempts/{attempt_id}/position",
        json={"current_surah": 112, "current_ayah": 4},
        headers=_auth(token),
    )
    assert r.status_code == 409, r.text
    r = await tc["client"].get(f"{HIFZ}/attempts/resume", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json() is None


# ---------------------------------------------------------------------------
# نمره‌دهی + برگهٔ خطاها (گروهی) + حذفِ تکی
# ---------------------------------------------------------------------------


async def _grade(tc, monkeypatch, token, attempt_id, ayah, heard):
    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(heard)
    )
    return await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": ayah},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )


async def test_grade_extra_word_only_in_mistake_sheet(tc, monkeypatch):
    token = await _user_token(tc["client"], "p4-extra@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    # آیهٔ ۴ (۵ کلمه؛ آیهٔ ۱ تنزیل بسمله را پیشوند دارد و ۸ کلمه است).
    words = _tanzil_ayah(112, 4).split()
    assert len(words) == 5
    # یک کلمهٔ غلط + یک کلمهٔ اضافه.
    r = await _grade(tc, monkeypatch, token, attempt_id, 4, [words[0], "غلط", words[2], words[3], words[4], "زائد"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"]["correct"] == 4
    assert body["counts"]["wrong"] == 1
    assert body["extra_words"] == ["زائد"]
    # کلمهٔ اضافه هرگز جزو کلمه‌های نمره‌خورده نیست.
    assert len(body["words"]) == 5

    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}/mistakes", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    groups = r.json()
    assert len(groups) == 2
    wrong = next(g for g in groups if g["category"] == "wrong_words")
    extra = next(g for g in groups if g["category"] == "extra_words")
    assert wrong["surah"] == 112 and wrong["ayah"] == 4
    assert len(wrong["items"]) == 1
    assert wrong["items"][0]["expected_text"] == words[1]
    assert wrong["items"][0]["heard"] == "غلط"
    assert len(extra["items"]) == 1
    assert extra["items"][0]["heard"] == "زائد"


async def test_grade_transposed_words_recorded(tc, monkeypatch):
    token = await _user_token(tc["client"], "p4-transposed@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    # آیهٔ ۳ (۴ کلمه؛ بدون بسمله).
    words = _tanzil_ayah(112, 3).split()
    assert len(words) == 4
    r = await _grade(tc, monkeypatch, token, attempt_id, 3, [words[1], words[0], words[2], words[3]])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"]["wrong"] == 2
    assert body["counts"]["correct"] == 2
    assert all(w["mistake_type"] == "transposed" for w in body["words"][:2])
    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}/mistakes", headers=_auth(token)
    )
    assert any(
        item["mistake_type"] == "transposed"
        for g in r.json()
        for item in g["items"]
    )


async def test_mistake_delete_per_item_and_ownership(tc, monkeypatch):
    token = await _user_token(tc["client"], "p4-del@example.com")
    other = await _user_token(tc["client"], "p4-del-other@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    # آیهٔ ۴ (۵ کلمه؛ بدون بسمله).
    words = _tanzil_ayah(112, 4).split()
    assert len(words) == 5
    r = await _grade(tc, monkeypatch, token, attempt_id, 4, ["غلط", words[1], words[2], words[3], words[4]])
    assert r.status_code == 200, r.text
    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}/mistakes", headers=_auth(token)
    )
    mistake_id = r.json()[0]["items"][0]["id"]
    # کاربرِ دیگر نمی‌تواند حذف کند.
    r = await tc["client"].delete(
        f"{HIFZ}/mistakes/{mistake_id}", headers=_auth(other)
    )
    assert r.status_code == 404, r.text
    r = await tc["client"].delete(
        f"{HIFZ}/mistakes/{mistake_id}", headers=_auth(token)
    )
    assert r.status_code == 204, r.text
    r = await tc["client"].get(
        f"{HIFZ}/attempts/{attempt_id}/mistakes", headers=_auth(token)
    )
    assert r.json() == []


# ---------------------------------------------------------------------------
# Peek: kind
# ---------------------------------------------------------------------------


async def test_peek_kind_validation(tc, monkeypatch):
    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    token = await _user_token(tc["client"], "p4-peek@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    attempt_id = r.json()["id"]
    # kind نامعتبر
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/peek",
        json={"surah": 112, "ayah": 1, "word_index": 0, "kind": "page"},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text
    # kind=ayah بدون word_indices
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/peek",
        json={"surah": 112, "ayah": 1, "word_index": 0, "kind": "ayah"},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text
    # kind=word مثل قبل کار می‌کند.
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/peek",
        json={"surah": 112, "ayah": 1, "word_index": 0, "kind": "word"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    # kind=ayah با فهرست، بقیهٔ آیه را آشکار می‌کند.
    r = await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/peek",
        json={"surah": 112, "ayah": 1, "word_indices": [1, 2, 3], "kind": "ayah"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["revealed"]) == 3


async def _admin_headers(tc) -> dict:
    """سرفصلِ ادمین با مجوز platform.settings (الگوی تست‌های فاز ۱۴)."""
    import uuid as _uuid

    from sqlalchemy import select

    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uuid.uuid4().hex[:12]
    async with tc["maker"]() as db:
        perm = (
            await db.execute(
                select(Permission).where(Permission.key == "platform.settings")
            )
        ).scalar_one_or_none()
        if perm is None:
            perm = Permission(key="platform.settings", description="platform.settings")
            db.add(perm)
            await db.flush()
        role = Role(name=f"p4_admin_role_{suffix}", description="phase4 admin test role")
        db.add(role)
        await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        user = User(
            full_name="ادمین تست فاز ۴",
            email=f"p4-admin-{suffix}@example.com",
            phone=f"+98901{abs(hash(suffix)) % 10**7:07d}",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {token}"}


async def test_admin_delete_attempt(tc):
    """ادمین از CRM نشستِ کاربرِ دیگری را حذف می‌کند (۲۰۴)؛ نشست می‌رود."""
    token = await _user_token(tc["client"], "p4-admin-del-owner@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    attempt_id = r.json()["id"]
    admin = await _admin_headers(tc)
    r = await tc["client"].delete(f"{HIFZ}/admin/attempts/{attempt_id}", headers=admin)
    assert r.status_code == 204, r.text
    r = await tc["client"].get(f"{HIFZ}/attempts/{attempt_id}", headers=_auth(token))
    assert r.status_code == 404, r.text


async def test_admin_delete_attempt_forbidden_and_missing(tc):
    """کاربرِ عادی ۴۰۳ می‌گیرد؛ ادمین روی نشستِ ناموجود ۴۰۴."""
    token = await _user_token(tc["client"], "p4-admin-del-user@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    attempt_id = r.json()["id"]
    r = await tc["client"].delete(
        f"{HIFZ}/admin/attempts/{attempt_id}", headers=_auth(token)
    )
    assert r.status_code in (401, 403), r.text
    admin = await _admin_headers(tc)
    r = await tc["client"].delete(
        f"{HIFZ}/admin/attempts/00000000-0000-0000-0000-000000000000",
        headers=admin,
    )
    assert r.status_code == 404, r.text
