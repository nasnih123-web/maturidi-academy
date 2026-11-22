"""پیشینه‌های خطای شخصی حفاظ (پیشنهاد ۱۴).

- سطح تراز: پس از دقیق و نزدیک، پیش از پرشِ روبه‌جلو؛ جفت
  (موردانتظار ← شنیده‌شده) فقط وقتی نجات می‌دهد که رشتهٔ عادتی
  سرِ بافر باشد و فاصله‌اش از واجِ موردانتظار ≤ ۴ بماند؛ نتیجه
  همیشه «نزدیک» است (هرگز «درست») و برچسبِ prior_applied می‌خورد.
- سطح بارگذار: فقط سطرهای «غلط» با همان جفت، دست‌کم ۳ بار.
- سطح نمره‌دهی: پاسخ grade برچسب را نشان می‌دهد.
"""

from __future__ import annotations

import io
import uuid
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.models import HifzAttempt, HifzWordScore, User
from app.modules.quran import hifz_service
from app.modules.quran.alignment import align_phonemes
from app.modules.quran.hifz_mapping import Segment

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"

_TANZIL = Path(__file__).resolve().parent.parent / (
    "app/modules/quran/data/tanzil_uthmani.txt"
)

_EXPECTED = ["قُلْ", "هُوَ", "اللَّهُ"]
_UNITS = [((0,), "qul"), ((1,), "huwa"), ((2,), "alah")]


# ---------------------------------------------------------------------------
# سطح تراز (خالص)
# ---------------------------------------------------------------------------


def test_prior_rescues_repeated_pair_as_close():
    """جفت تکراری (huwa ← xxva، فاصله ۳): بدون پیشینه «غلط»،
    با پیشینه «نزدیک» + برچسب + بازهٔ واجیِ درست."""
    aligned, _ = align_phonemes(_EXPECTED, _UNITS, "qulxxvaalah")
    assert [(w.status, w.prior_applied) for w in aligned] == [
        ("correct", False),
        ("wrong", False),
        ("correct", False),
    ]
    aligned, _ = align_phonemes(
        _EXPECTED, _UNITS, "qulxxvaalah", priors={"huwa": [("xxva", 3)]}
    )
    by_index = {w.word_index: w for w in aligned}
    assert by_index[1].status == "close"
    assert by_index[1].prior_applied is True
    assert by_index[1].needs_review is True
    assert (by_index[1].phoneme_start, by_index[1].phoneme_end) == (3, 7)
    assert by_index[2].status == "correct"
    assert by_index[1].prob == 0.65


def test_prior_too_far_is_not_applied():
    """رشتهٔ عادتی با فاصلهٔ ۵ (> ۴): پیشینه نجات نمی‌دهد."""
    aligned, _ = align_phonemes(
        _EXPECTED, _UNITS, "qulzzzzzaalah", priors={"huwa": [("zzzzz", 3)]}
    )
    by_index = {w.word_index: w for w in aligned}
    assert by_index[1].status == "wrong"
    assert by_index[1].prior_applied is False


def test_prior_never_overrides_exact_or_near_miss():
    """دقیق و نزدیک اولویت دارند: پیشینه آن‌ها را نمی‌خورد."""
    aligned, _ = align_phonemes(
        _EXPECTED, _UNITS, "qulhuwaalah", priors={"huwa": [("xxva", 3)]}
    )
    assert aligned[1].status == "correct"
    assert aligned[1].prior_applied is False
    aligned, _ = align_phonemes(
        _EXPECTED, _UNITS, "qulhuvaalah", priors={"huwa": [("huva", 3)]}
    )
    assert aligned[1].status == "close"
    assert aligned[1].prior_applied is False


def test_prior_needs_buffer_prefix():
    """رشتهٔ عادتی اگر سرِ بافر نباشد، تطبیق نمی‌خورد."""
    aligned, _ = align_phonemes(
        _EXPECTED, _UNITS, "qulalahxxva", priors={"huwa": [("xxva", 3)]}
    )
    by_index = {w.word_index: w for w in aligned}
    assert by_index[1].status == "skipped"
    assert by_index[1].prior_applied is False


# ---------------------------------------------------------------------------
# سطح بارگذار (دیتابیس + نگاشت مصنوعی)
# ---------------------------------------------------------------------------


def _fake_mapping():
    return SimpleNamespace(
        segments_for=lambda s, a: (
            [Segment((0,), "qul"), Segment((1,), "huwa")]
            if (s, a) == (112, 1)
            else None
        )
    )


async def _seed_user(db):
    user = User(
        full_name="کاربر تست پیشینه",
        email=f"prior-{uuid.uuid4().hex[:12]}@example.com",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_wrong(db, user, *, word_index, heard, n=1, status="wrong"):
    for _ in range(n):
        attempt = HifzAttempt(user_id=user.id, surah=112)
        db.add(attempt)
        await db.flush()
        db.add(
            HifzWordScore(
                attempt_id=attempt.id,
                surah=112,
                ayah=1,
                word_index=word_index,
                expected_text="هُوَ",
                status=status,
                prob=0.30,
                heard=heard,
            )
        )
    await db.commit()


@pytest.mark.asyncio
async def test_load_priors_needs_three_repeats(db_session):
    """همان جفت ۳ بار → پیشینه است؛ ۲ بار → نیست."""
    user = await _seed_user(db_session)
    await _seed_wrong(db_session, user, word_index=1, heard="xxva", n=2)
    assert await hifz_service.load_user_priors(
        db_session, user.id, mapping=_fake_mapping()
    ) == {}
    await _seed_wrong(db_session, user, word_index=1, heard="xxva", n=1)
    assert await hifz_service.load_user_priors(
        db_session, user.id, mapping=_fake_mapping()
    ) == {"huwa": [("xxva", 3)]}


@pytest.mark.asyncio
async def test_load_priors_counts_and_orders(db_session):
    """دو جفتِ متفاوت جدا شمرده می‌شوند؛ پرتکرارتر اول است."""
    user = await _seed_user(db_session)
    await _seed_wrong(db_session, user, word_index=1, heard="xxva", n=3)
    await _seed_wrong(db_session, user, word_index=1, heard="huva", n=4)
    priors = await hifz_service.load_user_priors(
        db_session, user.id, mapping=_fake_mapping()
    )
    assert priors == {"huwa": [("huva", 4), ("xxva", 3)]}


@pytest.mark.asyncio
async def test_load_priors_ignores_non_wrong_and_untranslatable(db_session):
    """سطر «نزدیک»، شنیده‌شدهٔ برابرِ واجِ موردانتظار، و آیهٔ
    بدون قطعه — هیچ‌کدام پیشینه نمی‌شوند."""
    user = await _seed_user(db_session)
    await _seed_wrong(db_session, user, word_index=1, heard="xxva", n=3)
    await _seed_wrong(db_session, user, word_index=1, heard="xxva", n=3,
                      status="close")
    await _seed_wrong(db_session, user, word_index=1, heard="huwa", n=3)
    priors = await hifz_service.load_user_priors(
        db_session, user.id, mapping=_fake_mapping()
    )
    assert priors == {"huwa": [("xxva", 3)]}


@pytest.mark.asyncio
async def test_load_priors_is_per_user(db_session):
    """پیشینهٔ کاربرِ دیگر، پیشینهٔ این کاربر نمی‌شود."""
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    await _seed_wrong(db_session, other, word_index=1, heard="xxva", n=3)
    assert await hifz_service.load_user_priors(
        db_session, user.id, mapping=_fake_mapping()
    ) == {}


# ---------------------------------------------------------------------------
# سطح نمره‌دهی (مسیر کامل grade)
# ---------------------------------------------------------------------------


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
        # نمونه‌های ۱۰۰۰ (‎~−۳۰ dBFS): دروازهٔ VAD (پیشنهاد ۱۲) سکوت را
        # با ۴۲۲ رد می‌کند، پس صوتِ تست باید انرژیِ گفتار داشته باشد.
        wav.writeframes(b"\xe8\x03" * frames)
    return buf.getvalue()


async def _fake_ayah_bundle(db, surah: int, ayah: int, **kwargs):
    return {
        "surah": surah,
        "ayah": ayah,
        "editions": [{"edition": "quran-uthmani", "text": _tanzil_ayah(surah, ayah)}],
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


class _FakePhonemeEngine:
    output_level = "phoneme"

    def __init__(self, tokens: list[str]):
        from app.modules.quran.hifz_engines import HeardWord, Transcription

        self._transcription = Transcription(
            text=" ".join(tokens),
            words=[HeardWord(t) for t in tokens],
        )

    def transcribe(self, wav_bytes: bytes):
        assert wav_bytes[:4] == b"RIFF", "mock expects a WAV payload"
        return self._transcription


class _FakeMapping:
    def __init__(self):
        self._segs = [
            Segment((0,), "basm1"),
            Segment((1,), "basm2"),
            Segment((2,), "basm3"),
            Segment((3,), "basm4"),
            Segment((4,), "qul"),
            Segment((5,), "huwa"),
            Segment((6,), "alah"),
            Segment((7,), "ahad"),
        ]

    def segments_for(self, surah, ayah):
        if (surah, ayah) == (112, 1):
            return list(self._segs)
        return None


_TOKENS_HABITUAL = [
    "basm1", "basm2", "basm3", "basm4", "qul", "xxva", "alah", "ahad",
]


async def _grade(tc, token, attempt_id, tokens, monkeypatch):
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine",
        lambda _id: _FakePhonemeEngine(tokens),
    )
    return await tc["client"].post(
        f"{HIFZ}/attempts/{attempt_id}/grade",
        data={"surah": 112, "ayah": 1},
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.mark.asyncio
async def test_grade_labels_prior_applied(tc, db_session, monkeypatch):
    """با ۳ «غلط»ِ پیشین برای (huwa ← xxva)، نمره‌دهیِ همان
    تلفظ «نزدیک» + prior_applied=True می‌دهد."""
    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping, "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    email = f"prior-grade-{uuid.uuid4().hex[:8]}@example.com"
    token = await _user_token(tc["client"], email)
    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "page": 604},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    attempt_id = r.json()["id"]
    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalars().one()
    await _seed_wrong(db_session, user, word_index=5, heard="xxva", n=3)
    r = await _grade(tc, token, attempt_id, _TOKENS_HABITUAL, monkeypatch)
    assert r.status_code == 200, r.text
    body = r.json()
    by_index = {w["word_index"]: w for w in body["words"]}
    assert by_index[5]["status"] == "close"
    assert by_index[5]["prior_applied"] is True
    assert by_index[4]["status"] == "correct"
    assert by_index[4]["prior_applied"] is False
    assert body["counts"] == {"correct": 7, "close": 1, "wrong": 0, "skipped": 0}


@pytest.mark.asyncio
async def test_grade_without_history_marks_habitual_wrong(tc, monkeypatch):
    """بدون تاریخچه، همان تلفظ «غلط» است و برچسب نمی‌خورد."""
    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping, "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    email = f"prior-ctrl-{uuid.uuid4().hex[:8]}@example.com"
    token = await _user_token(tc["client"], email)
    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "page": 604},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    r = await _grade(tc, token, r.json()["id"], _TOKENS_HABITUAL, monkeypatch)
    assert r.status_code == 200, r.text
    by_index = {w["word_index"]: w for w in r.json()["words"]}
    assert by_index[5]["status"] == "wrong"
    assert by_index[5]["prior_applied"] is False


# ---------------------------------------------------------------------------
# پیشنهاد ۱۵ — یادگیری از اعتراض
# ---------------------------------------------------------------------------


async def _seed_wrong_row(db, user, *, word_index, heard, status="wrong"):
    """یک سطر نمرهٔ «غلط» برمی‌گرداند (attempt + row)."""
    attempt = HifzAttempt(user_id=user.id, surah=112)
    db.add(attempt)
    await db.flush()
    row = HifzWordScore(
        attempt_id=attempt.id,
        surah=112,
        ayah=1,
        word_index=word_index,
        expected_text="هُوَ",
        status=status,
        prob=0.30,
        heard=heard,
    )
    db.add(row)
    await db.commit()
    return attempt, row


async def _feedback_count(db, user_id):
    from app.models.models import HifzDisputeFeedback

    rows = (
        await db.execute(
            select(HifzDisputeFeedback).where(
                HifzDisputeFeedback.user_id == user_id
            )
        )
    ).scalars().all()
    return {r.expected_phoneme: (r.heard_phoneme, r.count) for r in rows}


@pytest.mark.asyncio
async def test_dispute_feedback_needs_two_repeats(db_session):
    """یک اعتراض → شمار ۱ و هنوز بی‌اثر؛ اعتراضِ دوم به همان
    جفت → شمار ۲ و پیشینه می‌شود."""
    user = await _seed_user(db_session)
    mapping = _fake_mapping()
    _, row1 = await _seed_wrong_row(
        db_session, user, word_index=1, heard="xxva"
    )
    assert await hifz_service.record_dispute_feedback(
        db_session, user.id, row1, mapping=mapping
    ) is True
    assert await _feedback_count(db_session, user.id) == {
        "huwa": ("xxva", 1)
    }
    assert await hifz_service.load_user_priors(
        db_session, user.id, mapping=mapping
    ) == {}
    _, row2 = await _seed_wrong_row(
        db_session, user, word_index=1, heard="xxva"
    )
    assert await hifz_service.record_dispute_feedback(
        db_session, user.id, row2, mapping=mapping
    ) is True
    assert await _feedback_count(db_session, user.id) == {
        "huwa": ("xxva", 2)
    }
    assert await hifz_service.load_user_priors(
        db_session, user.id, mapping=mapping
    ) == {"huwa": [("xxva", 2)]}


@pytest.mark.asyncio
async def test_dispute_feedback_ignores_close_and_heardless(db_session):
    """اعتراض به «نزدیک» (heard متن است، نه واج) و به سطرِ
    بی-heard، جفتی نمی‌سازد."""
    user = await _seed_user(db_session)
    mapping = _fake_mapping()
    _, close_row = await _seed_wrong_row(
        db_session, user, word_index=1, heard="xxva", status="close"
    )
    assert await hifz_service.record_dispute_feedback(
        db_session, user.id, close_row, mapping=mapping
    ) is False
    _, no_heard = await _seed_wrong_row(
        db_session, user, word_index=1, heard=None
    )
    assert await hifz_service.record_dispute_feedback(
        db_session, user.id, no_heard, mapping=mapping
    ) is False
    assert await _feedback_count(db_session, user.id) == {}


@pytest.mark.asyncio
async def test_dispute_word_records_feedback_only_once(db_session, monkeypatch):
    """اعتراضِ دوباره به همان کلمه، همان جفت را دوباره
    نمی‌شمارد — فقط گذارِ تازهٔ False → True جفت می‌سازد."""
    monkeypatch.setattr(
        hifz_service.hifz_mapping, "load_phoneme_mapping",
        lambda: _fake_mapping(),
    )
    user = await _seed_user(db_session)
    attempt, row = await _seed_wrong_row(
        db_session, user, word_index=1, heard="xxva"
    )
    await hifz_service.dispute_word(db_session, user, attempt.id, row.id)
    assert await _feedback_count(db_session, user.id) == {
        "huwa": ("xxva", 1)
    }
    await hifz_service.dispute_word(db_session, user, attempt.id, row.id)
    assert await _feedback_count(db_session, user.id) == {
        "huwa": ("xxva", 1)
    }


@pytest.mark.asyncio
async def test_dispute_feedback_merges_with_row_priors(db_session):
    """جفت با ۳ سطر «غلط» و ۲ اعتراض: ادغام، شمارِ بیشتر (۳)
    را نگه می‌دارد."""
    user = await _seed_user(db_session)
    mapping = _fake_mapping()
    await _seed_wrong(db_session, user, word_index=1, heard="xxva", n=3)
    rows = (
        await db_session.execute(
            select(HifzWordScore)
            .join(HifzAttempt, HifzWordScore.attempt_id == HifzAttempt.id)
            .where(
                HifzAttempt.user_id == user.id,
                HifzWordScore.status == "wrong",
                HifzWordScore.heard == "xxva",
            )
        )
    ).scalars().all()
    assert len(rows) == 3
    for row in rows[:2]:
        assert await hifz_service.record_dispute_feedback(
            db_session, user.id, row, mapping=mapping
        ) is True
    assert await hifz_service.load_user_priors(
        db_session, user.id, mapping=mapping
    ) == {"huwa": [("xxva", 3)]}


@pytest.mark.asyncio
async def test_dispute_loop_changes_later_grade(tc, db_session, monkeypatch):
    """حلقهٔ کامل: دو نمرهٔ «غلط» با همان تلفظِ عادتی + اعتراض
    به هر دو → نمرهٔ سوم «نزدیک» + prior_applied."""
    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    monkeypatch.setattr(
        hifz_service.hifz_mapping, "load_phoneme_mapping",
        lambda: _FakeMapping(),
    )
    email = f"prior-loop-{uuid.uuid4().hex[:8]}@example.com"
    token = await _user_token(tc["client"], email)
    attempt_ids = []
    for _ in range(2):
        r = await tc["client"].post(
            f"{HIFZ}/attempts",
            json={"surah": 112, "page": 604},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        attempt_ids.append(r.json()["id"])
        r = await _grade(tc, token, attempt_ids[-1], _TOKENS_HABITUAL, monkeypatch)
        assert r.status_code == 200, r.text
        assert {w["word_index"]: w for w in r.json()["words"]}[5]["status"] == "wrong"
    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalars().one()
    wrong_rows = (
        await db_session.execute(
            select(HifzWordScore)
            .join(HifzAttempt, HifzWordScore.attempt_id == HifzAttempt.id)
            .where(
                HifzAttempt.user_id == user.id,
                HifzWordScore.status == "wrong",
                HifzWordScore.word_index == 5,
            )
        )
    ).scalars().all()
    assert len(wrong_rows) == 2
    for row in wrong_rows:
        await hifz_service.dispute_word(db_session, user, row.attempt_id, row.id)
    assert await _feedback_count(db_session, user.id) == {
        "huwa": ("xxva", 2)
    }
    r = await tc["client"].post(
        f"{HIFZ}/attempts",
        json={"surah": 112, "page": 604},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    r = await _grade(tc, token, r.json()["id"], _TOKENS_HABITUAL, monkeypatch)
    assert r.status_code == 200, r.text
    by_index = {w["word_index"]: w for w in r.json()["words"]}
    assert by_index[5]["status"] == "close"
    assert by_index[5]["prior_applied"] is True
