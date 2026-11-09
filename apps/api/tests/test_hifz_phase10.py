"""تست‌های فاز ۱۰ قرآن — Testing Mode، Voice Search، متشابهات، برنامه/
SRS/داشبورد، کارت‌های پیشنهادی، تسمی، قاری‌های Listen.

پوشش:
- منطق خالص (بدون شبکه/مدل): SM-2، کیفیت از نمره، ترتیب معکوس،
  ماشین‌های 6446 و 3x3 و هشت‌مرحله‌ای، امتیاز آزمون + حذف خطای کاذب،
  متشابهات روی دادهٔ مصنوعی و واقعی، رتبه‌بندی جستجوی صوتی.
- قرارداد HTTP با ASR ماک (مثل فاز ۳): برنامه، SRS، داشبورد،
  کارت‌های پیشنهادی، آزمون (ساخت/پاسخ/Peek/حذف کاذب/تکمیل)،
  جستجوی صوتی، متشابهات، تسمی.
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest

from app.modules.quran import hifz_plan
from app.modules.quran.hifz_mutashabihat import compute_mutashabihat
from app.modules.quran.hifz_voice_search import (
    rank_phoneme_candidates,
    rank_word_candidates,
)

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


def _tanzil_words(surah: int, ayah_start: int, ayah_end: int) -> list[str]:
    words: list[str] = []
    for ayah in range(ayah_start, ayah_end + 1):
        words.extend(_tanzil_ayah(surah, ayah).split())
    return words


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
# منطق خالص: SM-2 و کیفیت
# ---------------------------------------------------------------------------


def test_sm2_first_reviews_intervals():
    now = hifz_plan._utcnow()
    first = hifz_plan.sm2_next(5, 0, 2.5, 0, now=now)
    assert first["repetitions"] == 1 and first["interval_days"] == 1
    second = hifz_plan.sm2_next(5, 1, first["ease"], 1, now=now)
    assert second["repetitions"] == 2 and second["interval_days"] == 6
    third = hifz_plan.sm2_next(5, 2, second["ease"], 6, now=now)
    assert third["repetitions"] == 3 and third["interval_days"] > 6


def test_sm2_lapse_resets_and_penalises_ease():
    nxt = hifz_plan.sm2_next(1, 4, 2.5, 10)
    assert nxt["repetitions"] == 0 and nxt["interval_days"] == 1
    assert nxt["ease"] < 2.5
    assert nxt["ease"] >= hifz_plan.SM2_PARAMS["min_ease"]


def test_quality_from_grade_cases():
    assert hifz_plan.quality_from_grade({"correct": 10, "close": 0, "wrong": 0, "skipped": 0}) == 5
    assert hifz_plan.quality_from_grade({"correct": 10, "close": 0, "wrong": 0, "skipped": 0}, peek_count=1) == 4
    assert hifz_plan.quality_from_grade({"correct": 0, "close": 0, "wrong": 0, "skipped": 5}) == 0
    assert hifz_plan.quality_from_grade({"correct": 0, "close": 2, "wrong": 3, "skipped": 0}) == 1
    assert hifz_plan.quality_from_grade({"correct": 8, "close": 2, "wrong": 0, "skipped": 0}) in (3, 4)


def test_plan_order_reverse_keeps_ayah_order():
    counts = {113: 5, 114: 6}
    order = hifz_plan.plan_ayah_order(
        (113, 1), (114, 3), direction="reverse", ayah_counts=counts
    )
    assert order == [
        (114, 1), (114, 2), (114, 3),
        (113, 1), (113, 2), (113, 3), (113, 4), (113, 5),
    ]
    normal = hifz_plan.plan_ayah_order(
        (113, 1), (114, 3), direction="normal", ayah_counts=counts
    )
    assert normal[0] == (113, 1) and normal[-1] == (114, 3)


# ---------------------------------------------------------------------------
# منطق خالص: تسمی
# ---------------------------------------------------------------------------


def test_method_6446_twenty_taps_per_ayah_and_resume():
    ayahs = [(112, 1), (112, 2)]
    state = hifz_plan.method_6446_initial_state(ayahs)
    # ۷ tap: وسط ست اول (خواندن ۶×) + یک tap از ست دوم.
    for _ in range(7):
        state = hifz_plan.method_6446_tap(state)
    cur = hifz_plan.method_6446_current(state)
    assert cur["ayah"] == [112, 1]
    assert cur["set_kind"] == "recite" and cur["count_in_set"] == 1
    # قطع و ادامه از همان state: ۱۳ tap دیگر آیهٔ اول را تمام می‌کند.
    for _ in range(13):
        state = hifz_plan.method_6446_tap(state)
    cur = hifz_plan.method_6446_current(state)
    assert cur["ayah"] == [112, 2] and cur["set_pos"] == 0
    for _ in range(20):
        state = hifz_plan.method_6446_tap(state)
    assert hifz_plan.method_6446_current(state)["done"] is True


def test_method_3x3_group_steps():
    ayahs = [(112, 1), (112, 2), (112, 3), (112, 4)]
    state = hifz_plan.method_3x3_initial_state(ayahs)
    assert len(state["groups"]) == 2  # گروه‌های سه‌آیه‌ای
    cur = hifz_plan.method_3x3_current(state)
    assert cur["group"] == [[112, 1], [112, 2], [112, 3]]
    assert cur["step_kind"] == "read_all" and cur["step_target"] == 5
    for _ in range(5 + 3 + 3 + 3 + 3 + 3 + 3):
        state = hifz_plan.method_3x3_tap(state)
    cur = hifz_plan.method_3x3_current(state)
    assert cur["group"] == [[112, 4]]  # گروه دوم (تک‌آیه‌ای)
    assert cur["done"] is False


def test_tasmi8_variants():
    assert len(hifz_plan.tasmi8_initial_state("standard")["stages"]) == 8
    assert len(hifz_plan.tasmi8_initial_state("gentle")["stages"]) == 11
    assert hifz_plan.tasmi8_initial_state("revision")["stages"] == [
        "first_recall", "recite_sequence", "bridge_gaps", "chain_challenge",
    ]
    state = hifz_plan.tasmi8_initial_state("standard")
    for _ in range(8):
        state = hifz_plan.tasmi8_advance(state)
    assert state["done"] is True
    with pytest.raises(ValueError):
        hifz_plan.tasmi8_initial_state("unknown")
    # بازه‌های مرور تسمی از سایت رسمی.
    assert hifz_plan.tasmi_review_due_at("forgot") < hifz_plan.tasmi_review_due_at("easy")


# ---------------------------------------------------------------------------
# منطق خالص: امتیاز آزمون
# ---------------------------------------------------------------------------


def test_test_question_score_ignores_removed_and_counts_peek():
    events = [
        {"status": "correct", "mistake_type": None, "removed": False},
        {"status": "correct", "mistake_type": None, "removed": False},
        {"status": "wrong", "mistake_type": "wrong_word", "removed": False},
        {"status": "wrong", "mistake_type": "wrong_word", "removed": True},
        {"status": "peeked", "mistake_type": "peek", "removed": False},
    ]
    scored = hifz_plan.test_question_score(events)
    assert scored["counts"] == {"correct": 2, "close": 0, "wrong": 1, "skipped": 0}
    assert scored["peek_count"] == 1
    assert scored["score"] == pytest.approx(0.6667, abs=1e-4)
    total = hifz_plan.test_total_score(
        [{"score": scored["score"], "peek_count": 1}]
    )
    assert total is not None
    assert total["score"] == pytest.approx(0.6667 - 0.05, abs=1e-4)


# ---------------------------------------------------------------------------
# منطق خالص: متشابهات و جستجوی صوتی
# ---------------------------------------------------------------------------


def test_mutashabihat_synthetic_not_hardcoded():
    ayahs = [
        (1, 1, ["بسم", "الله", "الرحمن", "الرحيم"], "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"),
        (1, 2, ["الحمد", "لله", "رب", "العلمين"], "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"),
        (27, 30, ["انه", "من", "سليمن", "وانه", "بسم", "الله", "الرحمن", "الرحيم"], "إِنَّهُ مِن سُلَيْمَانَ وَإِنَّهُ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"),
    ]
    result = compute_mutashabihat(ayahs)
    phrases = {g["phrase"] for g in result["groups"]}
    assert "بسم الله الرحمن الرحيم" in phrases
    group = next(g for g in result["groups"] if g["phrase"] == "بسم الله الرحمن الرحيم")
    assert {(o["surah"], o["ayah"]) for o in group["occurrences"]} == {(1, 1), (27, 30)}


def test_mutashabihat_real_tanzil_has_groups():
    result = compute_mutashabihat()
    assert result["phrase_count"] > 100
    groups_1_1 = [
        g for g in result["groups"]
        if any(o["surah"] == 1 and o["ayah"] == 1 for o in g["occurrences"])
    ]
    assert groups_1_1  # بسمله در ۱:۱ و ۲۷:۳۰ مشترک است


def test_voice_search_word_ranking_finds_fatiha():
    heard = _tanzil_ayah(1, 2).split()
    candidates = rank_word_candidates(heard)
    assert candidates
    assert candidates[0]["surah"] == 1 and candidates[0]["ayah"] == 2
    assert candidates[0]["confidence"] == "probable"
    assert all(c["confidence"] in ("probable", "possible") for c in candidates)
    assert rank_word_candidates(["واحد"]) == []  # خیلی کوتاه: بدون نامزد


def test_voice_search_phoneme_ranking_with_stub_locate():
    def locate(surah, buf):
        if surah == 112 and buf.startswith("qulhuwallaahuahad"):
            return (1, 20)
        if surah == 1 and buf.startswith("qul"):
            return (1, 8)
        return None

    out = rank_phoneme_candidates("qulhuwallaahuahad", locate_fn=locate)
    assert out[0]["surah"] == 112 and out[0]["confidence"] == "possible"
    assert rank_phoneme_candidates("ab", locate_fn=locate) == []


def test_listen_reciters_extended_with_verified_quran_com_ids():
    from app.modules.quran.recitation_timing import RECITERS

    assert RECITERS["alafasy"] == 7
    assert RECITERS["abdul_basit"] == 2
    assert RECITERS["husary"] == 6
    assert RECITERS["sudais"] == 3
    assert RECITERS["minshawi"] == 9
    assert RECITERS["shuraym"] == 10
    assert len(RECITERS) == 12


def test_locate_ayah_return_length():
    from app.modules.quran.hifz_stream import locate_ayah

    # نگاشت مصنوعیِ تست‌های فاز ۶ (همان سازوکار test_hifz_stream).
    from tests.test_hifz_stream import _FakeMapping  # type: ignore

    mapping = _FakeMapping()
    hit = locate_ayah(mapping, 112, "qulhuwaalahahad" + "alahsamad", hint_ayah=1, return_length=True)
    assert hit is not None and len(hit) == 3
    assert hit[0] == 1 and hit[2] >= 8


# ---------------------------------------------------------------------------
# HTTP: برنامهٔ حفظ (معکوس) + SRS + داشبورد + کارت‌های پیشنهادی
# ---------------------------------------------------------------------------


async def test_plan_reverse_order_and_pause_resume(tc, monkeypatch):
    token = await _user_token(tc["client"], "p10-plan@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/plans",
        json={
            "title": "حفظ معکوس",
            "kind": "memorize",
            "direction": "reverse",
            "start_surah": 113, "start_ayah": 1,
            "end_surah": 114, "end_ayah": 3,
            "daily_target_new": 2, "daily_target_review": 5,
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["total_ayahs"] == 8
    assert plan["direction"] == "reverse"
    r = await tc["client"].get(f"{HIFZ}/plans/{plan['id']}", headers=_auth(token))
    items = r.json()["items"]
    assert [(i["surah"], i["ayah"]) for i in items] == [
        (114, 1), (114, 2), (114, 3),
        (113, 1), (113, 2), (113, 3), (113, 4), (113, 5),
    ]
    # توقف و ادامه.
    r = await tc["client"].patch(
        f"{HIFZ}/plans/{plan['id']}", json={"status": "paused"}, headers=_auth(token)
    )
    assert r.json()["status"] == "paused"
    r = await tc["client"].patch(
        f"{HIFZ}/plans/{plan['id']}", json={"status": "active"}, headers=_auth(token)
    )
    assert r.json()["status"] == "active"
    # ثبت یک آیه به‌عنوان کامل.
    r = await tc["client"].patch(
        f"{HIFZ}/plans/{plan['id']}/items/{items[0]['id']}",
        json={"status": "done"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["done_ayahs"] == 1


async def test_plan_validation_rejects_bad_range(tc):
    token = await _user_token(tc["client"], "p10-plan-bad@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/plans",
        json={
            "title": "x", "kind": "memorize", "direction": "reverse",
            "start_surah": 114, "start_ayah": 1,
            "end_surah": 113, "end_ayah": 1,
        },
        headers=_auth(token),
    )
    assert r.status_code == 422


async def test_srs_record_and_due_and_dashboard(tc):
    from app.models.models import HifzReview

    token = await _user_token(tc["client"], "p10-srs@example.com")
    r = await tc["client"].post(
        f"{HIFZ}/reviews",
        json={"surah": 112, "ayah": 1, "counts": {"correct": 4, "close": 0, "wrong": 0, "skipped": 0}},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quality"] == 5
    assert body["repetitions"] == 1 and body["interval_days"] == 1
    assert body["params_version"] == hifz_plan.SM2_PARAMS_VERSION
    # مرور دوم با کیفیت ۵ → فاصلهٔ ۶ روز.
    r = await tc["client"].post(
        f"{HIFZ}/reviews",
        json={"surah": 112, "ayah": 1, "quality": 5},
        headers=_auth(token),
    )
    assert r.json()["repetitions"] == 2 and r.json()["interval_days"] == 6
    # هنوز موعدش نرسیده → خالی.
    r = await tc["client"].get(f"{HIFZ}/reviews/due", headers=_auth(token))
    assert r.status_code == 200 and r.json() == []
    # یک ردیف SRS با موعد گذشته، مستقیم در DB → در صف مرور می‌آید.
    from app.models.models import User

    async with tc["maker"]() as session:
        from sqlalchemy import select

        user = (
            await session.execute(
                select(User).where(User.email == "p10-srs@example.com")
            )
        ).scalars().first()
        assert user is not None
        from datetime import UTC, datetime, timedelta

        session.add(
            HifzReview(
                user_id=user.id, surah=112, ayah=2, ease=2.5,
                interval_days=1, repetitions=1,
                due_at=datetime.now(UTC) - timedelta(hours=1),
                last_quality=4,
            )
        )
        await session.commit()
    r = await tc["client"].get(f"{HIFZ}/reviews/due", headers=_auth(token))
    assert r.status_code == 200
    assert any(
        row["surah"] == 112 and row["ayah"] == 2 and row["source"] == "srs"
        for row in r.json()
    )
    # داشبورد: فقط آمار واقعی (هنوز نشستی نیست).
    r = await tc["client"].get(f"{HIFZ}/dashboard", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attempts"] == 0 and body["graded_words"] == 0
    assert body["due_count"] >= 1
    assert len(body["daily_series"]) == 30


async def test_suggested_requires_memorized_range_and_history(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    token = await _user_token(tc["client"], "p10-suggested@example.com")
    r = await tc["client"].get(f"{HIFZ}/suggested", headers=_auth(token))
    assert r.json()["available"] is False
    assert r.json()["reason"] == "setup_required"
    # برنامه + یک آیهٔ کامل، ولی هنوز تاریخچهٔ کافی نیست.
    r = await tc["client"].post(
        f"{HIFZ}/plans",
        json={
            "title": "اخلاص", "kind": "memorize", "direction": "normal",
            "start_surah": 112, "start_ayah": 1,
            "end_surah": 112, "end_ayah": 4,
        },
        headers=_auth(token),
    )
    plan = r.json()
    r = await tc["client"].get(f"{HIFZ}/plans/{plan['id']}", headers=_auth(token))
    items = { (i["surah"], i["ayah"]): i["id"] for i in r.json()["items"] }
    await tc["client"].patch(
        f"{HIFZ}/plans/{plan['id']}/items/{items[(112, 2)]}",
        json={"status": "done"},
        headers=_auth(token),
    )
    r = await tc["client"].get(f"{HIFZ}/suggested", headers=_auth(token))
    assert r.json()["available"] is False
    assert r.json()["reason"] == "insufficient_history"
    # تاریخچهٔ واقعی بساز: نمره‌دهی ۴ آیه (۱۵ کلمه) با یک خطا در ۱۱۲:۲.
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

    for ayah in (1, 3, 4):
        r = await grade(ayah, _tanzil_ayah(112, ayah).split())
        assert r.status_code == 200, r.text
    r = await grade(2, ["غلط"])
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["wrong"] >= 1
    r = await tc["client"].get(f"{HIFZ}/suggested", headers=_auth(token))
    body = r.json()
    assert body["available"] is True, body
    assert any(
        c["surah"] == 112 and c["ayah"] == 2 and c["kind"] == "weakest_link"
        for c in body["cards"]
    )


# ---------------------------------------------------------------------------
# HTTP: آزمون
# ---------------------------------------------------------------------------


async def test_testing_mode_full_flow(tc, monkeypatch):
    from app.modules.quran import hifz_service

    monkeypatch.setattr(
        hifz_service.quran_service, "get_ayah_bundle", _fake_ayah_bundle
    )
    token = await _user_token(tc["client"], "p10-test@example.com")
    # اعتبارسنجی پارامترها.
    r = await tc["client"].post(
        f"{HIFZ}/tests",
        json={"surah_start": 112, "surah_end": 114, "question_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 422
    r = await tc["client"].post(
        f"{HIFZ}/tests",
        json={"surah_start": 112, "surah_end": 114, "question_count": 2, "time_limit_minutes": 61},
        headers=_auth(token),
    )
    assert r.status_code == 422
    # ساخت آزمون موقت.
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
    test = r.json()
    assert test["temporary_session"] is True
    assert test["time_limit_minutes"] == 30
    assert len(test["questions"]) == 2
    # جزئیات آزمون: سؤال‌ها با شناسه.
    r = await tc["client"].get(f"{HIFZ}/tests/{test['id']}", headers=_auth(token))
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["total_score"] is None
    qq1, qq2 = detail["questions"][0], detail["questions"][1]
    # پاسخ سؤال اول با خواندنِ دقیقِ گذر → نمرهٔ ۱.
    heard = _tanzil_words(qq1["surah"], qq1["ayah_start"], qq1["ayah_end"])
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(heard)
    )
    r = await tc["client"].post(
        f"{HIFZ}/tests/{test['id']}/questions/{qq1['id']}/answer",
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["score"] == 1.0
    assert r.json()["counts"]["correct"] == len(heard)
    # Peek در سؤال دوم، بعد پاسخ دقیق → کلمهٔ Peekشده «درست» نمی‌خورد.
    r = await tc["client"].post(
        f"{HIFZ}/tests/{test['id']}/questions/{qq2['id']}/peek",
        json={"surah": qq2["surah"], "ayah": qq2["ayah_start"], "word_index": 0},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["peek_count"] == 1
    heard2 = _tanzil_words(qq2["surah"], qq2["ayah_start"], qq2["ayah_end"])
    heard2_wrong = list(heard2)
    heard2_wrong[1] = "غلط"  # یک خطای واقعی تا حذفِ آن، امتیاز را عوض کند.
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(heard2_wrong)
    )
    r = await tc["client"].post(
        f"{HIFZ}/tests/{test['id']}/questions/{qq2['id']}/answer",
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["peek_count"] == 1
    assert body["counts"]["correct"] == len(heard2) - 2  # یکی Peek، یکی غلط.
    assert body["counts"]["wrong"] == 1
    # حذف خطای کاذب: رویدادِ غلط را removed کن — رویداد می‌ماند،
    # امتیاز دوباره محاسبه می‌شود (از کمتر از ۱ به ۱ می‌رسد).
    events = body["raw_events"]
    wrong_idx = next(
        i for i, e in enumerate(events)
        if e.get("status") == "wrong" and not e.get("removed")
    )
    score_before = body["score"]
    assert score_before < 1.0
    r = await tc["client"].post(
        f"{HIFZ}/tests/{test['id']}/questions/{qq2['id']}/events/{wrong_idx}/remove",
        json={"removed": True},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    removed_body = r.json()
    assert len(removed_body["raw_events"]) == len(events)
    assert removed_body["raw_events"][wrong_idx]["removed"] is True
    assert removed_body["score"] == 1.0
    assert removed_body["counts"]["wrong"] == 0
    assert removed_body["score"] != score_before
    # تکمیل آزمون + امتیاز کل.
    r = await tc["client"].post(
        f"{HIFZ}/tests/{test['id']}/complete", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    assert r.json()["total_score"] is not None
    assert r.json()["total_score"]["answered"] == 2


# ---------------------------------------------------------------------------
# HTTP: جستجوی صوتی، متشابهات، تسمی
# ---------------------------------------------------------------------------


async def test_voice_search_word_level(tc, monkeypatch):
    from app.modules.quran import hifz_service

    token = await _user_token(tc["client"], "p10-vs@example.com")
    heard = _tanzil_ayah(1, 2).split()
    monkeypatch.setattr(
        hifz_service.hifz_engines, "get_engine", lambda _id: _FakeEngine(heard)
    )
    r = await tc["client"].post(
        f"{HIFZ}/voice-search",
        files={"audio": ("rec.wav", _wav_bytes(), "audio/wav")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["level"] == "word"
    assert body["candidates"]
    assert body["candidates"][0]["surah"] == 1
    assert body["candidates"][0]["ayah"] == 2
    assert body["candidates"][0]["confidence"] == "probable"
    assert "احتمالی" in body["note"]


async def test_mutashabihat_endpoints(tc):
    token = await _user_token(tc["client"], "p10-mut@example.com")
    r = await tc["client"].get(
        f"{HIFZ}/mutashabihat/count", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["phrase_count"] > 100
    r = await tc["client"].get(
        f"{HIFZ}/mutashabihat?surah=1&ayah=1", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    groups = r.json()
    assert groups
    assert any(
        g["phrase"] == "بسم الله الرحمن الرحيم" for g in groups
    )
    r = await tc["client"].get(
        f"{HIFZ}/mutashabihat/phrase?phrase=بسم الله الرحمن الرحيم",
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert {(o["surah"], o["ayah"]) for o in r.json()["occurrences"]} >= {
        (1, 1), (27, 30)
    }


async def test_tasmi_sessions_lifecycle(tc):
    token = await _user_token(tc["client"], "p10-tasmi@example.com")
    # 6446: یک آیه، ۲۰ tap تا پایان.
    r = await tc["client"].post(
        f"{HIFZ}/tasmi/sessions",
        json={
            "method": "method_6446", "start_surah": 112, "start_ayah": 1,
            "end_surah": 112, "end_ayah": 1,
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    session = r.json()
    assert session["self_assessed"] is True
    assert session["current"]["set_kind"] == "read"
    for _ in range(7):
        r = await tc["client"].patch(
            f"{HIFZ}/tasmi/sessions/{session['id']}",
            json={"action": "tap"},
            headers=_auth(token),
        )
        assert r.status_code == 200, r.text
    assert r.json()["current"]["set_kind"] == "recite"
    # مکث و ادامه.
    r = await tc["client"].patch(
        f"{HIFZ}/tasmi/sessions/{session['id']}",
        json={"action": "pause"},
        headers=_auth(token),
    )
    assert r.json()["status"] == "paused"
    r = await tc["client"].patch(
        f"{HIFZ}/tasmi/sessions/{session['id']}",
        json={"action": "resume"},
        headers=_auth(token),
    )
    assert r.json()["status"] == "active"
    for _ in range(13):
        r = await tc["client"].patch(
            f"{HIFZ}/tasmi/sessions/{session['id']}",
            json={"action": "tap"},
            headers=_auth(token),
        )
    assert r.json()["status"] == "completed"
    # هشت‌مرحله‌ای با بازتاب.
    r = await tc["client"].post(
        f"{HIFZ}/tasmi/sessions",
        json={
            "method": "tasmi8", "variant": "revision",
            "start_surah": 112, "start_ayah": 1,
            "end_surah": 112, "end_ayah": 3,
        },
        headers=_auth(token),
    )
    session8 = r.json()
    assert session8["current"]["stage_total"] == 4
    assert session8["current"]["stage"] == "first_recall"
    r = await tc["client"].patch(
        f"{HIFZ}/tasmi/sessions/{session8['id']}",
        json={"action": "next_stage"},
        headers=_auth(token),
    )
    assert r.json()["current"]["stage"] == "recite_sequence"
    r = await tc["client"].patch(
        f"{HIFZ}/tasmi/sessions/{session8['id']}",
        json={"action": "rate", "rating": "good", "reflection": "بازتاب خصوصی"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reflection"] == "بازتاب خصوصی"
    assert r.json()["state"]["last_rating"] == "good"
    assert "review_due_at" in r.json()["state"]
