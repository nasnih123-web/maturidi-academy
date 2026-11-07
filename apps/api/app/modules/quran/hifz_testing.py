"""Testing Mode + Voice Search — فاز ۱۰ قرآن.

Testing Mode (طبقهٔ A، مستند رسمی ترتیل — «Getting started with
Testing»): فلش‌کارت؛ کارت چند کلمهٔ اولِ گذر را نشان می‌دهد و کاربر
بقیه را از حفظ می‌خواند؛ پس از تکمیل، کارت سبز (درست) یا قرمز (خطا)
می‌شود؛ ردکردن با «بعدی». آزمون در این‌جا یک نشست موقت
(Temporary Session) است: سؤال‌ها و رویدادهای خام فقط در همین آزمون
می‌مانند و به تاریخچهٔ تمرین اضافه نمی‌شوند — پاسخ UI صریحاً
«نشست موقت» را نشان می‌دهد.

پارامترهای آزمون (همه configurable):
- question_count: ۱ تا ۹۹ (پیش‌فرض ۱۰).
- time_limit_minutes: ۱ تا ۶۰ یا null (نامحدود).
- question_length: short (۲ سطر) / medium (۵ سطر) / long (۱۲ سطر)
  — «سطر» یعنی سطرِ چاپیِ مصحف (دادهٔ `quran-mushaf-lines.json`).
- stop_rule: ayah_end (گذر تا انتهای آیه ادامه پیدا می‌کند) یا
  line_end (گذر دقیقاً در انتهای سطر می‌ایستد).

Peek در آزمون طبق قواعد scoring آزمون شمرده می‌شود: کلمهٔ Peekشده
اگر بعداً درست خوانده شود هم در شمار «درست» نمی‌آید (mistake_type
آن peek می‌ماند) و هر Peek پنج صدم از امتیاز سؤال کم می‌کند
(نگاه کنید به `hifz_plan.test_question_score` / `test_total_score`).
حذف خطای کاذب: رویداد خام حذف نمی‌شود؛ فقط `removed=true`
می‌خورد و امتیاز سؤال دوباره محاسبه می‌شود.

Voice Search (طبقهٔ A — «AI Voice Search» ترتیل، رایگان): رابط
مستقل از session grading؛ ضبط کوتاه → رونویسی → یافتنِ نامزدهای
سوره:آیه. match احتمالی هرگز قطعی جلوه داده نمی‌شود (برچسب
probable/possible + یادداشت صریح) و کاربر نتیجه را از میان
نامزدها انتخاب می‌کند. مسیر واجی از موتور locate فاز ۶
(`locate_ayah`) استفاده می‌کند.
"""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import HifzTest, HifzTestQuestion, User

from . import alignment, hifz_plan, hifz_service
from . import service as quran_service

QUESTION_LINES: dict[str, int] = {"short": 2, "medium": 5, "long": 12}
PROMPT_WORDS = 3  # کارت آزمون، سه کلمهٔ اولِ گذر را نشان می‌دهد.
MAX_QUESTIONS = 99


def _repo_root() -> Path:
    # apps/api/app/modules/quran/hifz_testing.py → parents[5] = repo root.
    return Path(__file__).resolve().parents[5]


def _mushaf_lines_path() -> Path:
    return _repo_root() / "apps" / "web" / "lib" / "quran-mushaf-lines.json"


_LINES_CACHE: list[dict] | None = None


def load_mushaf_lines() -> list[dict]:
    """سطرهای چاپی مصحف (فقط سطرهای متنی)، به ترتیب صفحه/سطر.

    هر سطر: {page, text, surah_start, ayah_start, surah_end, ayah_end}.
    فایل در حافظه کش می‌شود (داده ثابت است). نبودِ فایل → ۵۰۳ صادقانه.
    """
    global _LINES_CACHE
    if _LINES_CACHE is not None:
        return _LINES_CACHE
    path = _mushaf_lines_path()
    if not path.exists():
        raise APIError(
            503,
            "hifz_mushaf_lines_unavailable",
            "دادهٔ سطرهای چاپی مصحف در دسترس نیست؛ ساخت آزمون ممکن نیست.",
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise APIError(
            503, "hifz_mushaf_lines_unavailable", "دادهٔ سطرهای مصحف خراب است."
        ) from exc
    lines: list[dict] = []
    for page_no, page in enumerate(data.get("pages", []), start=1):
        for line in page:
            if line.get("t") != "text":
                continue
            try:
                v_s, v_a = (int(p) for p in str(line["v"]).split(":"))
                w_s, w_a = (int(p) for p in str(line["w"]).split(":"))
            except (KeyError, ValueError):
                continue
            text = str(line.get("x", "")).strip()
            if not text:
                continue
            lines.append(
                {
                    "page": page_no,
                    "text": text,
                    "surah_start": v_s,
                    "ayah_start": v_a,
                    "surah_end": w_s,
                    "ayah_end": w_a,
                }
            )
    if not lines:
        raise APIError(
            503, "hifz_mushaf_lines_unavailable", "دادهٔ سطرهای مصحف خالی است."
        )
    _LINES_CACHE = lines
    return lines


def _prompt_words(text: str, n: int = PROMPT_WORDS) -> str:
    """چند کلمهٔ اولِ سطر — شماره‌های آیه (عدد عربی) نشانه نیستند."""
    words = [w for w in text.split() if w and not all(
        "\u0660" <= ch <= "\u0669" or "\u06f0" <= ch <= "\u06f9" or ch.isdigit()
        for ch in w
    )]
    return " ".join(words[:n])


def build_passages(
    surah_start: int,
    surah_end: int,
    *,
    count: int,
    length: str,
    stop_rule: str,
    seed: int | None = None,
    lines: list[dict] | None = None,
) -> list[dict]:
    """ساخت گذرهای آزمون از سطرهای چاپی.

    هر گذر: {surah, ayah_start, ayah_end, prompt} — surah همان سورهٔ
    سطرِ اولِ گذر است (گذر هرگز از مرز سوره رد نمی‌شود).
    - short/medium/long = ۲/۵/۱۲ سطر.
    - ayah_end: پس از N سطر، سطرها ادامه پیدا می‌کنند تا انتهای
      آیهٔ آخر (سطر بعدی که با همان آیه شروع می‌شود هم می‌آید).
    - line_end: گذر دقیقاً در انتهای سطرِ Nام می‌ایستد (ممکن است
      وسط آیه باشد).
    اگر سطرهای متمایزِ بازه کمتر از count باشند، همه‌شان برمی‌گردند
    (تعداد واقعی در پاسخ آزمون می‌آید) — به‌جای خطای بی‌مورد.
    """
    n_lines = QUESTION_LINES[length]
    all_lines = lines if lines is not None else load_mushaf_lines()
    starts = [
        i
        for i, ln in enumerate(all_lines)
        if surah_start <= ln["surah_start"] <= surah_end
    ]
    if not starts:
        raise APIError(
            422,
            "hifz_test_range_empty",
            "در این بازه هیچ سطر مصحفی برای آزمون نیست.",
        )
    rng = random.Random(seed)
    picked = rng.sample(starts, min(count, len(starts)))
    picked.sort()
    passages: list[dict] = []
    for start_idx in picked:
        first = all_lines[start_idx]
        surah = first["surah_start"]
        end_idx = start_idx
        taken = 1
        while taken < n_lines and end_idx + 1 < len(all_lines):
            nxt = all_lines[end_idx + 1]
            if nxt["surah_start"] != surah:
                break
            end_idx += 1
            taken += 1
        if stop_rule == "ayah_end":
            last = all_lines[end_idx]
            while end_idx + 1 < len(all_lines):
                nxt = all_lines[end_idx + 1]
                if nxt["surah_start"] != surah:
                    break
                if (nxt["surah_start"], nxt["ayah_start"]) != (
                    last["surah_end"],
                    last["ayah_end"],
                ):
                    break
                end_idx += 1
                last = nxt
        last = all_lines[end_idx]
        passages.append(
            {
                "surah": surah,
                "ayah_start": first["ayah_start"],
                "ayah_end": last["ayah_end"],
                "prompt": _prompt_words(first["text"]),
            }
        )
    return passages


async def _ayah_counts(db: AsyncSession, surah: int) -> int:
    meta = quran_service.get_surah(surah)
    return int(meta.ayahs)


async def create_test(
    db: AsyncSession,
    user: User,
    *,
    surah_start: int,
    surah_end: int,
    question_count: int = 10,
    time_limit_minutes: int | None = None,
    question_length: str = "medium",
    stop_rule: str = "ayah_end",
    seed: int | None = None,
) -> dict:
    """ساخت آزمون + سؤال‌ها (نشست موقت)."""
    if not 1 <= question_count <= MAX_QUESTIONS:
        raise APIError(422, "hifz_test_count", "تعداد سؤال باید ۱ تا ۹۹ باشد")
    if time_limit_minutes is not None and not 1 <= time_limit_minutes <= 60:
        raise APIError(
            422, "hifz_test_time_limit", "زمان آزمون باید ۱ تا ۶۰ دقیقه یا نامحدود باشد"
        )
    if question_length not in QUESTION_LINES:
        raise APIError(422, "hifz_test_length", "طول سؤال باید short/medium/long باشد")
    if stop_rule not in ("ayah_end", "line_end"):
        raise APIError(422, "hifz_test_stop_rule", "stop_rule باید ayah_end یا line_end باشد")
    if surah_start > surah_end:
        raise APIError(422, "hifz_test_range", "شروع بازه باید پیش از پایان آن باشد")
    from datetime import UTC, datetime, timedelta

    now = datetime.now(UTC)
    test = HifzTest(
        user_id=user.id,
        surah_start=surah_start,
        surah_end=surah_end,
        question_count=question_count,
        time_limit_minutes=time_limit_minutes,
        question_length=question_length,
        stop_rule=stop_rule,
        ends_at=(
            now + timedelta(minutes=time_limit_minutes)
            if time_limit_minutes is not None
            else None
        ),
    )
    db.add(test)
    await db.flush()
    passages = build_passages(
        surah_start,
        surah_end,
        count=question_count,
        length=question_length,
        stop_rule=stop_rule,
        seed=seed if seed is not None else int.from_bytes(
            test.id.bytes[:8], "little"
        ),
    )
    for pos, p in enumerate(passages):
        db.add(
            HifzTestQuestion(
                test_id=test.id,
                position=pos,
                surah=p["surah"],
                ayah_start=p["ayah_start"],
                ayah_end=p["ayah_end"],
                prompt_words=PROMPT_WORDS,
                prompt=p["prompt"],
                status="pending",
            )
        )
    await db.commit()
    await db.refresh(test)
    return _test_out(db, test, passages)


def _test_out(db: AsyncSession, test: HifzTest, passages: list[dict] | None = None) -> dict:
    return {
        "id": test.id,
        "surah_start": test.surah_start,
        "surah_end": test.surah_end,
        "question_count": test.question_count,
        "time_limit_minutes": test.time_limit_minutes,
        "question_length": test.question_length,
        "stop_rule": test.stop_rule,
        "status": test.status,
        "started_at": test.started_at,
        "ends_at": test.ends_at,
        "completed_at": test.completed_at,
        "temporary_session": True,
        "questions": passages or [],
    }


def _as_aware(dt: datetime | None) -> datetime | None:
    """SQLite tzinfo را نگه نمی‌دارد؛ مقدار naive را UTC فرض کن."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


async def _test_or_404(db: AsyncSession, user: User, test_id: UUID) -> HifzTest:
    test = await db.get(HifzTest, test_id)
    if test is None or test.user_id != user.id:
        raise APIError(404, "hifz_test_not_found", "آزمون پیدا نشد")
    return test


async def _question_or_404(
    db: AsyncSession, test: HifzTest, question_id: UUID
) -> HifzTestQuestion:
    q = await db.get(HifzTestQuestion, question_id)
    if q is None or q.test_id != test.id:
        raise APIError(404, "hifz_test_question_not_found", "سؤال آزمون پیدا نشد")
    return q


async def get_test(db: AsyncSession, user: User, test_id: UUID) -> dict:
    test = await _test_or_404(db, user, test_id)
    rows = await db.execute(
        select(HifzTestQuestion)
        .where(HifzTestQuestion.test_id == test.id)
        .order_by(HifzTestQuestion.position)
    )
    questions = list(rows.scalars().all())
    total = hifz_plan.test_total_score(
        [
            {"score": q.score, "peek_count": q.peek_count}
            for q in questions
        ]
    )
    return {
        **_test_out(db, test),
        "questions": [
            {
                "id": q.id,
                "position": q.position,
                "surah": q.surah,
                "ayah_start": q.ayah_start,
                "ayah_end": q.ayah_end,
                "prompt": q.prompt,
                "status": q.status,
                "score": q.score,
                "counts": q.counts or {},
                "peek_count": q.peek_count,
                "raw_events": q.raw_events or [],
                "answered_at": q.answered_at,
            }
            for q in questions
        ],
        "total_score": total,
    }


async def list_tests(db: AsyncSession, user: User, limit: int = 20) -> list[dict]:
    rows = await db.execute(
        select(HifzTest)
        .where(HifzTest.user_id == user.id)
        .order_by(HifzTest.started_at.desc())
        .limit(limit)
    )
    out = []
    for test in rows.scalars().all():
        qs = await db.execute(
            select(HifzTestQuestion).where(HifzTestQuestion.test_id == test.id)
        )
        questions = list(qs.scalars().all())
        total = hifz_plan.test_total_score(
            [{"score": q.score, "peek_count": q.peek_count} for q in questions]
        )
        out.append({**_test_out(db, test), "total_score": total,
                    "answered": sum(1 for q in questions if q.status == "answered")})
    return out


async def _grade_passage(
    db: AsyncSession,
    surah: int,
    ayah_start: int,
    ayah_end: int,
    wav_bytes: bytes,
    transcriber: object | None = None,
) -> list[dict]:
    """نمره‌دهی یک گذر (چندآیه‌ای) — همان منطق grade_ayah، بدون attempt.

    برمی‌گرداند فهرست رویدادهای خام: [{surah, ayah, word_index,
    expected, status, prob, heard, mistake_type, removed: False}].
    """
    hifz_service.validate_wav_16k_mono(wav_bytes)
    green, amber = await hifz_service.get_thresholds(db)
    _engine_id, transcription, level = await hifz_service._transcribe(
        db, wav_bytes, transcriber
    )
    # متن موردانتظار کل گذر + آفست هر آیه.
    expected_all: list[str] = []
    offsets: list[tuple[int, int]] = []  # (ayah, offset)
    for ayah in range(ayah_start, ayah_end + 1):
        words = await hifz_service._ayah_words(db, surah, ayah)
        offsets.append((ayah, len(expected_all)))
        expected_all.extend(words)
    if level == "phoneme":
        units: list[tuple[tuple[int, ...], str | None]] = []
        for ayah, offset in offsets:
            for widxs, phon in hifz_service._phoneme_units(surah, ayah):
                units.append((tuple(w + offset for w in widxs), phon))
        phoneme_text = "".join(
            w.text for w in transcription.words if w.text != "<blank>"
        )
        aligned, _extra = alignment.align_phonemes(
            expected_all, units, phoneme_text, green, amber
        )
    else:
        heard = [w.text for w in transcription.words]
        probs = [w.prob for w in transcription.words]
        aligned, _extra = alignment.align_words(
            expected_all, heard, probs, green, amber
        )
    events: list[dict] = []
    for w in aligned:
        ayah = ayah_start
        local_index = w.word_index
        for a, off in offsets:
            if w.word_index >= off:
                ayah, local_index = a, w.word_index - off
        events.append(
            {
                "surah": surah,
                "ayah": ayah,
                "word_index": local_index,
                "expected": w.expected,
                "status": w.status,
                "prob": w.prob,
                "heard": w.heard,
                "mistake_type": w.mistake_type,
                "removed": False,
            }
        )
    return events


def _apply_peek_marks(events: list[dict], peeked: set[tuple[int, int]]) -> list[dict]:
    """کلمهٔ Peekشده اگر درست خوانده شود هم «درست» نمی‌خورد:
    mistake_type آن peek می‌ماند و در شمار درست نمی‌آید."""
    for ev in events:
        if (ev["ayah"], ev["word_index"]) in peeked:
            ev["mistake_type"] = "peek"
    return events


async def answer_question(
    db: AsyncSession,
    user: User,
    test_id: UUID,
    question_id: UUID,
    wav_bytes: bytes,
    transcriber: object | None = None,
) -> dict:
    """پاسخ یک سؤال با صوت: نمره‌دهی گذر + ذخیرهٔ رویدادهای خام."""
    test = await _test_or_404(db, user, test_id)
    if test.status != "in_progress":
        raise APIError(422, "hifz_test_closed", "این آزمون بسته شده است")
    from datetime import UTC, datetime

    if test.ends_at is not None and datetime.now(UTC) > (_as_aware(test.ends_at) or datetime.now(UTC)):
        test.status = "expired"
        await db.commit()
        raise APIError(422, "hifz_test_expired", "زمان آزمون تمام شده است")
    q = await _question_or_404(db, test, question_id)
    if q.status == "answered":
        raise APIError(422, "hifz_test_question_answered", "این سؤال پاسخ داده شده است")
    events = await _grade_passage(
        db, q.surah, q.ayah_start, q.ayah_end, wav_bytes, transcriber
    )
    peeked = {
        (ev["ayah"], ev["word_index"])
        for ev in (q.raw_events or [])
        if ev.get("mistake_type") == "peek" and not ev.get("removed")
    }
    events = _apply_peek_marks(events, peeked)
    # رویدادهای Peekِ پیشین در فهرست خام می‌مانند (تاریخچهٔ سؤال).
    merged = list(q.raw_events or []) + events
    scored = hifz_plan.test_question_score(merged)
    q.raw_events = merged
    q.counts = scored["counts"]
    q.peek_count = scored["peek_count"]
    q.score = scored["score"]
    q.status = "answered"
    from datetime import UTC, datetime

    q.answered_at = datetime.now(UTC)
    await db.commit()
    return {
        "question_id": q.id,
        "status": q.status,
        "score": q.score,
        "counts": q.counts,
        "peek_count": q.peek_count,
        "raw_events": q.raw_events,
    }


async def skip_question(
    db: AsyncSession, user: User, test_id: UUID, question_id: UUID
) -> dict:
    test = await _test_or_404(db, user, test_id)
    q = await _question_or_404(db, test, question_id)
    if q.status != "pending":
        raise APIError(422, "hifz_test_question_closed", "این سؤال بسته شده است")
    q.status = "skipped"
    await db.commit()
    return {"question_id": q.id, "status": q.status}


async def peek_question(
    db: AsyncSession,
    user: User,
    test_id: UUID,
    question_id: UUID,
    surah: int,
    ayah: int,
    word_index: int,
) -> dict:
    """Peek در آزمون: کلمه آشکار می‌شود و در امتیاز آزمون شمرده
    می‌شود (نه در تاریخچهٔ تمرین — آزمون موقت است)."""
    test = await _test_or_404(db, user, test_id)
    q = await _question_or_404(db, test, question_id)
    if q.status != "pending":
        raise APIError(422, "hifz_test_question_closed", "این سؤال بسته شده است")
    words = await hifz_service._ayah_words(db, surah, ayah)
    if not (q.ayah_start <= ayah <= q.ayah_end):
        raise APIError(422, "hifz_test_peek_range", "Peek باید درون گذر سؤال باشد")
    if not 0 <= word_index < len(words):
        raise APIError(422, "hifz_word_index", "شمارهٔ کلمه خارج از آیه است")
    events = list(q.raw_events or [])
    events.append(
        {
            "surah": surah,
            "ayah": ayah,
            "word_index": word_index,
            "expected": words[word_index],
            "status": "peeked",
            "prob": None,
            "heard": None,
            "mistake_type": "peek",
            "removed": False,
        }
    )
    scored = hifz_plan.test_question_score(events)
    q.raw_events = events
    q.peek_count = scored["peek_count"]
    await db.commit()
    return {
        "question_id": q.id,
        "word": words[word_index],
        "surah": surah,
        "ayah": ayah,
        "word_index": word_index,
        "peek_count": q.peek_count,
    }


async def remove_false_positive(
    db: AsyncSession,
    user: User,
    test_id: UUID,
    question_id: UUID,
    event_index: int,
    removed: bool = True,
) -> dict:
    """حذف خطای کاذب: رویداد خام می‌ماند (removed=true) ولی امتیاز
    سؤال دوباره محاسبه می‌شود."""
    test = await _test_or_404(db, user, test_id)
    q = await _question_or_404(db, test, question_id)
    events = list(q.raw_events or [])
    if not 0 <= event_index < len(events):
        raise APIError(422, "hifz_test_event_index", "شمارهٔ رویداد خارج از فهرست است")
    events[event_index]["removed"] = bool(removed)
    scored = hifz_plan.test_question_score(events)
    q.raw_events = events
    q.counts = scored["counts"]
    q.peek_count = scored["peek_count"]
    q.score = scored["score"]
    await db.commit()
    return {
        "question_id": q.id,
        "event_index": event_index,
        "removed": bool(removed),
        "score": q.score,
        "counts": q.counts,
        "peek_count": q.peek_count,
        "raw_events": q.raw_events,
    }


async def complete_test(db: AsyncSession, user: User, test_id: UUID) -> dict:
    test = await _test_or_404(db, user, test_id)
    if test.status != "in_progress":
        raise APIError(422, "hifz_test_closed", "این آزمون بسته شده است")
    from datetime import UTC, datetime

    test.status = "completed"
    test.completed_at = datetime.now(UTC)
    await db.commit()
    return await get_test(db, user, test_id)


async def delete_test(db: AsyncSession, user: User, test_id: UUID) -> None:
    """حذف آزمونِ کاربر با همهٔ سؤال‌هایش (حریم خصوصی).

    حذف، کامل و بی‌بازگشت است — رویدادهای خامِ سؤال‌ها هم پاک
    می‌شوند، چون خودِ آزمون مالِ کاربر است و او حذفش را خواسته
    است. این با «حذف خطای کاذب» فرق می‌کند: آن‌جا رویداد خام
    می‌ماند و فقط `removed=true` می‌خورد (audit trail).
    """
    await _test_or_404(db, user, test_id)
    await db.execute(
        delete(HifzTestQuestion).where(HifzTestQuestion.test_id == test_id)
    )
    await db.execute(delete(HifzTest).where(HifzTest.id == test_id))
    await db.commit()
