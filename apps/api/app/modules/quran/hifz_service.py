"""سرویس حفاظ — فاز ۳ قرآن (record-then-grade).

قواعد:
- صوت گذراست: بایت‌های WAV فقط برای اعتبارسنجی سربرگ و رونویسی خوانده
  می‌شوند، هرگز در دیتابیس یا دیسک (به‌جز فایل موقت آداپتور که همان‌جا
  پاک می‌شود) ذخیره نمی‌شوند و هرگز از دروازهٔ ClamAV کتابخانه نمی‌گذرند.
- نمره‌دهی موتور را هر بار از تنظیم ذخیره‌شده می‌خواند؛ خرابی موتور
  خطای صادقانهٔ ۵۰۳ است، هرگز تعویض بی‌صدا با موتور دیگر.
- تراز موقعیتی پس از جاافتادگی ادامه پیدا می‌کند (alignment.py):
  کلمه‌های بعد از یک آیهٔ جاافتاده هنوز نمره می‌گیرند.
- نمرهٔ دوبارهٔ همان آیه در همان نشست، ردیف نمره را به‌روز می‌کند
  (یکتایی attempt/ayah/word) ولی ردیف‌های خطا تاریخچه می‌مانند.
"""

from __future__ import annotations

import asyncio
import io
import wave
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.platform_settings import get_typed_setting
from app.models.models import (
    HifzAttempt,
    HifzMistake,
    HifzWordScore,
    User,
)

from . import alignment, hifz_engines, hifz_mapping
from . import service as quran_service

MAX_AUDIO_BYTES = 32 * 1024 * 1024  # ~۱۵ دقیقه WAV تک‌کانالهٔ ۱۶ کیلوهرتز
DEFAULT_GREEN = 0.8
DEFAULT_AMBER = 0.5


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def get_thresholds(db: AsyncSession) -> tuple[float, float]:
    """آستانه‌های رنگ از CRM؛ مقدار خراب → پیش‌فرض، هرگز ۵۰۰."""
    raw = await get_typed_setting(
        db, "quran.hifz_thresholds", {"green": DEFAULT_GREEN, "amber": DEFAULT_AMBER}
    )
    if not isinstance(raw, dict):
        return DEFAULT_GREEN, DEFAULT_AMBER
    try:
        green = float(raw.get("green", DEFAULT_GREEN))
        amber = float(raw.get("amber", DEFAULT_AMBER))
    except (TypeError, ValueError):
        return DEFAULT_GREEN, DEFAULT_AMBER
    if not (0.0 < amber < green <= 1.0):
        return DEFAULT_GREEN, DEFAULT_AMBER
    return green, amber


def validate_wav_16k_mono(data: bytes) -> None:
    """WAV باید PCM تک‌کانالهٔ ۱۶ کیلوهرتز باشد (کاربر سمت مرورگر
    ری‌سمپل می‌کند). هر چیز دیگر → ۴۲۲ صادقانه، نه تبدیل بی‌صدا."""
    if len(data) > MAX_AUDIO_BYTES:
        raise APIError(413, "hifz_audio_too_large", "فایل صوت بیش از حد بزرگ است")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels = wav.getnchannels()
            rate = wav.getframerate()
            width = wav.getsampwidth()
    except (wave.Error, EOFError, ValueError) as exc:
        raise APIError(422, "hifz_audio_format", "صدا باید فایل WAV معتبر باشد") from exc
    if channels != 1 or rate != 16000 or width != 2:
        raise APIError(
            422,
            "hifz_audio_format",
            "صدا باید WAV تک‌کانالهٔ ۱۶ بیتی با نرخ ۱۶ کیلوهرتز باشد",
            {"channels": channels, "sample_rate": rate, "sample_width": width},
        )


async def _ayah_words(db: AsyncSession, surah: int, ayah: int) -> list[str]:
    """کلمه‌های موردانتظار یک آیه از متن معیار آکادمی (provider متن)."""
    bundle = await quran_service.get_ayah_bundle(db, surah, ayah)
    text = None
    for edition in bundle.get("editions", []):
        if edition.get("edition") == "quran-uthmani":
            text = edition.get("text")
            break
    if not text:
        raise APIError(
            503, "quran_text_unavailable", "متن قرآن برای نمره‌دهی در دسترس نیست"
        )
    words = [w for w in str(text).split() if w]
    if not words:
        raise APIError(503, "quran_text_unavailable", "متن آیه خالی است")
    return words


async def _attempt_or_404(
    db: AsyncSession, user: User, attempt_id: UUID
) -> HifzAttempt:
    attempt = await db.get(HifzAttempt, attempt_id)
    if attempt is None or attempt.user_id != user.id:
        raise APIError(404, "hifz_attempt_not_found", "نشست حفظ پیدا نشد")
    return attempt


def _counts_for(words: list[HifzWordScore]) -> dict[str, int]:
    counts = {"correct": 0, "close": 0, "wrong": 0, "skipped": 0}
    for w in words:
        if w.status in counts:
            counts[w.status] += 1
    return counts


async def _attempt_counts(db: AsyncSession, attempt_id: UUID) -> dict[str, int]:
    rows = await db.execute(
        select(HifzWordScore).where(HifzWordScore.attempt_id == attempt_id)
    )
    return _counts_for(list(rows.scalars().all()))


def _attempt_out(attempt: HifzAttempt, counts: dict[str, int]) -> dict:
    return {
        "id": attempt.id,
        "surah": attempt.surah,
        "page": attempt.page,
        "status": attempt.status,
        "engine": attempt.engine,
        "counts": counts,
        "created_at": attempt.created_at,
        "updated_at": attempt.updated_at,
        "completed_at": attempt.completed_at,
    }


async def create_attempt(
    db: AsyncSession, user: User, surah: int, page: int | None
) -> dict:
    """ساخت نشست. engine نمایشی لحظهٔ ساخت است؛ نمره‌دهی هر بار موتور
    را از تنظیم می‌خواند."""
    raw = await get_typed_setting(db, "quran.asr_engine", "zipformer")
    engine_snapshot = raw if raw in hifz_engines.ENGINE_IDS else "zipformer"
    attempt = HifzAttempt(
        user_id=user.id, surah=surah, page=page, engine=engine_snapshot
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return _attempt_out(attempt, {"correct": 0, "close": 0, "wrong": 0, "skipped": 0})


async def list_attempts(
    db: AsyncSession, user: User, limit: int, offset: int
) -> list[dict]:
    rows = await db.execute(
        select(HifzAttempt)
        .where(HifzAttempt.user_id == user.id)
        .order_by(HifzAttempt.updated_at.desc().nullslast(), HifzAttempt.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    attempts = list(rows.scalars().all())
    if not attempts:
        return []
    ids = [a.id for a in attempts]
    scores = await db.execute(
        select(HifzWordScore).where(HifzWordScore.attempt_id.in_(ids))
    )
    by_attempt: dict[UUID, list[HifzWordScore]] = {}
    for s in scores.scalars().all():
        by_attempt.setdefault(s.attempt_id, []).append(s)
    return [
        _attempt_out(a, _counts_for(by_attempt.get(a.id, []))) for a in attempts
    ]


async def attempt_detail(db: AsyncSession, user: User, attempt_id: UUID) -> dict:
    attempt = await _attempt_or_404(db, user, attempt_id)
    words = await db.execute(
        select(HifzWordScore)
        .where(HifzWordScore.attempt_id == attempt_id)
        .order_by(
            HifzWordScore.surah, HifzWordScore.ayah, HifzWordScore.word_index
        )
    )
    word_rows = list(words.scalars().all())
    mistakes = await db.execute(
        select(HifzMistake)
        .where(HifzMistake.attempt_id == attempt_id)
        .order_by(HifzMistake.created_at.desc())
        .limit(100)
    )
    return {
        "attempt": _attempt_out(attempt, _counts_for(word_rows)),
        "words": [
            {
                "id": w.id,
                "attempt_id": w.attempt_id,
                "surah": w.surah,
                "ayah": w.ayah,
                "word_index": w.word_index,
                "expected_text": w.expected_text,
                "status": w.status,
                "prob": w.prob,
                "heard": w.heard,
                "mistake_type": w.mistake_type,
                "disputed": w.disputed,
            }
            for w in word_rows
        ],
        "mistakes": [
            {
                "id": m.id,
                "attempt_id": m.attempt_id,
                "surah": m.surah,
                "ayah": m.ayah,
                "word_index": m.word_index,
                "mistake_type": m.mistake_type,
                "expected_text": m.expected_text,
                "heard": m.heard,
                "created_at": m.created_at,
            }
            for m in mistakes.scalars().all()
        ],
    }


async def complete_attempt(db: AsyncSession, user: User, attempt_id: UUID) -> dict:
    attempt = await _attempt_or_404(db, user, attempt_id)
    attempt.status = "completed"
    attempt.completed_at = _utcnow()
    await db.commit()
    return _attempt_out(attempt, await _attempt_counts(db, attempt_id))


def _phoneme_units(surah: int, ayah: int) -> list[tuple[tuple[int, ...], str | None]]:
    """قطعه‌های یک آیه از نگاشت اعتبارسنجی‌شده؛ نبود/رد → خطای صادقانه."""
    mapping = hifz_mapping.load_phoneme_mapping()
    segs = mapping.segments_for(surah, ayah)
    if segs is None:
        raise APIError(
            503,
            "hifz_mapping_ayah_unavailable",
            f"تراز واجی آیهٔ {surah}:{ayah} پذیرفته نشده است؛ "
            "نمره‌دهی برای این آیه در دسترس نیست.",
            {},
        )
    return [(s.word_indices, s.phoneme) for s in segs]


async def _transcribe(
    db: AsyncSession, wav_bytes: bytes, transcriber: object | None
) -> tuple[str, hifz_engines.Transcription, str]:
    """رونویسی با موتور انتخاب‌شده؛ خرابی → ۵۰۳ صادقانه، بدون جایگزین.

    برمی‌گرداند: (شناسهٔ موتور، رونویسی، سطح خروجی «word» یا «phoneme»).
    خروجی واجی (Zipformer) هرگز به‌عنوان کلمه تراز نمی‌شود؛ نمره‌دهی،
    آن را از مسیر قطعه‌ای (align_phonemes) می‌گذراند.
    """
    if transcriber is not None:
        # Test seam: an object with .transcribe(bytes) -> Transcription,
        # optionally with .output_level ("word" by default, "phoneme"
        # for a Zipformer-like mock).
        result = await asyncio.to_thread(transcriber.transcribe, wav_bytes)  # type: ignore[attr-defined]
        level = getattr(transcriber, "output_level", "word")
        return "mock", result, level
    try:
        engine_id = await hifz_engines.resolve_engine_id(db)
        engine = hifz_engines.get_engine(engine_id)
        result = await asyncio.to_thread(engine.transcribe, wav_bytes)
    except hifz_engines.EngineError as exc:
        raise APIError(503, exc.code, exc.message, {}) from exc
    return engine_id, result, getattr(engine, "output_level", "word")


async def _store_grade(
    db: AsyncSession,
    attempt: HifzAttempt,
    surah: int,
    ayah: int,
    aligned: list[alignment.AlignedWord],
    extra: list[str],
) -> list[HifzWordScore]:
    """Upsert نمره‌ها + درج ردیف‌های خطا (تاریخچه)."""
    stored: list[HifzWordScore] = []
    for word in aligned:
        existing = await db.execute(
            select(HifzWordScore).where(
                HifzWordScore.attempt_id == attempt.id,
                HifzWordScore.surah == surah,
                HifzWordScore.ayah == ayah,
                HifzWordScore.word_index == word.word_index,
            )
        )
        row = existing.scalars().first()
        if row is None:
            row = HifzWordScore(
                attempt_id=attempt.id,
                surah=surah,
                ayah=ayah,
                word_index=word.word_index,
                expected_text=word.expected,
                status=word.status,
                prob=word.prob,
                heard=word.heard,
                mistake_type=word.mistake_type,
                disputed=False,
            )
            db.add(row)
        else:
            row.expected_text = word.expected
            row.status = word.status
            row.prob = word.prob
            row.heard = word.heard
            row.mistake_type = word.mistake_type
            row.disputed = False
        stored.append(row)
        # History rows only for actionable failures (wrong/skipped).
        # A "close" word keeps its mistake_type on the score (visible
        # in the strip, usable for practice) but creates no history row.
        if word.status in ("wrong", "skipped") and word.mistake_type in (
            "wrong_word", "wrong_tashkeel", "skipped",
        ):
            db.add(
                HifzMistake(
                    attempt_id=attempt.id,
                    user_id=attempt.user_id,
                    surah=surah,
                    ayah=ayah,
                    word_index=word.word_index,
                    mistake_type=word.mistake_type,
                    expected_text=word.expected,
                    heard=word.heard,
                )
            )
    attempt.extra_words = extra
    attempt.updated_at = _utcnow()
    await db.commit()
    return stored


async def grade_ayah(
    db: AsyncSession,
    user: User,
    attempt_id: UUID,
    surah: int,
    ayah: int,
    wav_bytes: bytes,
    transcriber: object | None = None,
) -> dict:
    """نمره‌دهی یک آیهٔ کامل."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    validate_wav_16k_mono(wav_bytes)
    expected = await _ayah_words(db, surah, ayah)
    green, amber = await get_thresholds(db)
    engine_id, transcription, level = await _transcribe(db, wav_bytes, transcriber)
    if level == "phoneme":
        # مسیر واجی Zipformer: رشتهٔ واجی روی قطعه‌های نگاشت تراز
        # می‌شود؛ واجِ اضافهٔ پایانی، «مادهٔ واجیِ تجزیه‌نشده» است، نه کلمه.
        units = _phoneme_units(surah, ayah)
        phoneme_text = "".join(
            w.text for w in transcription.words if w.text != "<blank>"
        )
        aligned, extra = alignment.align_phonemes(
            expected, units, phoneme_text, green, amber
        )
    else:
        heard = [w.text for w in transcription.words]
        probs = [w.prob for w in transcription.words]
        aligned, extra = alignment.align_words(expected, heard, probs, green, amber)
    stored = await _store_grade(db, attempt, surah, ayah, aligned, extra)
    counts = _counts_for(stored)
    return {
        "attempt_id": attempt.id,
        "surah": surah,
        "ayah": ayah,
        "word_index": None,
        "engine_used": engine_id,
        "thresholds": {"green": green, "amber": amber},
        "words": [
            {
                "word_index": w.word_index,
                "expected": w.expected,
                "status": w.status,
                "prob": w.prob,
                "heard": w.heard,
                "mistake_type": w.mistake_type,
                "needs_review": w.needs_review,
            }
            for w in aligned
        ],
        "counts": counts,
        "extra_words": extra,
    }


async def grade_word(
    db: AsyncSession,
    user: User,
    attempt_id: UUID,
    surah: int,
    ayah: int,
    word_index: int,
    wav_bytes: bytes,
    transcriber: object | None = None,
) -> dict:
    """تمرین تک‌کلمه: فقط همان یک کلمه نمره می‌گیرد."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    validate_wav_16k_mono(wav_bytes)
    words = await _ayah_words(db, surah, ayah)
    if not 0 <= word_index < len(words):
        raise APIError(422, "hifz_word_index", "شمارهٔ کلمه خارج از آیه است")
    expected = [words[word_index]]
    green, amber = await get_thresholds(db)
    engine_id, transcription, level = await _transcribe(db, wav_bytes, transcriber)
    if level == "phoneme":
        units = _phoneme_units(surah, ayah)
        covering = [u for u in units if word_index in u[0]]
        if covering and len(covering[0][0]) > 1:
            # کلمه در یک قطعهٔ چندکلمه‌ای ادغام شده است: رشتهٔ واجیِ
            # آن به‌تنهایی تعریف نشده؛ تمرین آیهٔ کامل، راه درست است.
            raise APIError(
                422,
                "hifz_word_in_merged_unit",
                "این کلمه با کلمهٔ همسایه در یک قطعهٔ واجی ادغام شده "
                "است؛ تمرین تک‌کلمه برای آن تعریف نشده — آیه را کامل "
                "تمرین کنید.",
                {},
            )
        single_units = [((0,), phon) for (widxs, phon) in covering]
        phoneme_text = "".join(
            w.text for w in transcription.words if w.text != "<blank>"
        )
        aligned, extra = alignment.align_phonemes(
            expected, single_units, phoneme_text, green, amber
        )
    else:
        heard = [w.text for w in transcription.words]
        probs = [w.prob for w in transcription.words]
        aligned, extra = alignment.align_words(expected, heard, probs, green, amber)
    # Re-index the single result back to the ayah-level word position.
    for w in aligned:
        w.word_index = word_index
    stored = await _store_grade(db, attempt, surah, ayah, aligned, extra)
    counts = _counts_for(stored)
    return {
        "attempt_id": attempt.id,
        "surah": surah,
        "ayah": ayah,
        "word_index": word_index,
        "engine_used": engine_id,
        "thresholds": {"green": green, "amber": amber},
        "words": [
            {
                "word_index": word_index,
                "expected": expected[0],
                "status": aligned[0].status if aligned else "skipped",
                "prob": aligned[0].prob if aligned else 0.0,
                "heard": aligned[0].heard if aligned else None,
                "mistake_type": aligned[0].mistake_type if aligned else "skipped",
                "needs_review": aligned[0].needs_review if aligned else False,
            }
        ],
        "counts": counts,
        "extra_words": extra,
    }


async def peek_word(
    db: AsyncSession,
    user: User,
    attempt_id: UUID,
    surah: int,
    ayah: int,
    word_index: int | None = None,
    word_indices: list[int] | None = None,
) -> dict:
    """Peek: نمایش کلمه(ها) = ثبت خطا. ردیف نمره نمی‌سازد. One call
    reveals one word or a whole list (the rest of the ayah): every
    word gets its own peek mistake in a single transaction, each
    with status `peeked` on the page."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    words = await _ayah_words(db, surah, ayah)
    if (word_index is None) == (word_indices is None):
        raise APIError(
            422, "hifz_peek_target", "exactly one of word_index / word_indices is required"
        )
    if word_indices is not None and len(word_indices) == 0:
        raise APIError(422, "hifz_peek_target", "word_indices must not be empty")
    indices = [word_index] if word_index is not None else list(word_indices or [])
    indices = list(dict.fromkeys(indices))
    if not indices:
        raise APIError(422, "hifz_word_index", "شمارهٔ کلمه خارج از آیه است")
    for i in indices:
        if not 0 <= i < len(words):
            raise APIError(422, "hifz_word_index", "شمارهٔ کلمه خارج از آیه است")
    revealed: list[HifzMistake] = []
    for i in indices:
        mistake = HifzMistake(
            attempt_id=attempt.id,
            user_id=user.id,
            surah=surah,
            ayah=ayah,
            word_index=i,
            mistake_type="peek",
            expected_text=words[i],
            heard=None,
        )
        db.add(mistake)
        revealed.append(mistake)
    attempt.updated_at = _utcnow()
    await db.commit()
    for mistake in revealed:
        await db.refresh(mistake)
    first = revealed[0]
    return {
        "mistake_id": first.id,
        "surah": surah,
        "ayah": ayah,
        "word_index": first.word_index,
        "word": words[first.word_index],
        "revealed": [
            {
                "mistake_id": m.id,
                "word_index": m.word_index,
                "word": words[m.word_index],
            }
            for m in revealed
        ],
    }


async def dispute_word(
    db: AsyncSession, user: User, attempt_id: UUID, word_score_id: UUID
) -> dict:
    attempt = await _attempt_or_404(db, user, attempt_id)
    row = await db.get(HifzWordScore, word_score_id)
    if row is None or row.attempt_id != attempt.id:
        raise APIError(404, "hifz_word_score_not_found", "نمرهٔ کلمه پیدا نشد")
    row.disputed = True
    await db.commit()
    return {"word_score_id": row.id, "disputed": True}


async def stats(db: AsyncSession, user: User) -> dict:
    attempts = await db.execute(
        select(func.count()).select_from(HifzAttempt).where(HifzAttempt.user_id == user.id)
    )
    attempt_count = int(attempts.scalar_one())
    scores = await db.execute(
        select(HifzWordScore.status, func.count())
        .join(HifzAttempt, HifzWordScore.attempt_id == HifzAttempt.id)
        .where(HifzAttempt.user_id == user.id)
        .group_by(HifzWordScore.status)
    )
    counts = {"correct": 0, "close": 0, "wrong": 0, "skipped": 0}
    graded = 0
    for status, n in scores.all():
        if status in counts:
            counts[status] = int(n)
            graded += int(n)
    dominant = await db.execute(
        select(HifzMistake.mistake_type, func.count())
        .where(HifzMistake.user_id == user.id)
        .group_by(HifzMistake.mistake_type)
        .order_by(func.count().desc())
        .limit(1)
    )
    dom_row = dominant.first()
    review = await review_queue(db, user)
    return {
        "attempts": attempt_count,
        "graded_words": graded,
        "counts": counts,
        "dominant_mistake": dom_row[0] if dom_row else None,
        "due_ayahs": len(review),
    }


async def review_queue(db: AsyncSession, user: User) -> list[dict]:
    """صف مرور (SRS-lite): آیه‌هایی که در آخرین نمره‌شان هنوز خطای
    wrong/skipped دارند، یا فقط Peek خورده‌اند و هرگز نمرهٔ تمیز
    نگرفته‌اند. مرتب بر اساس تعداد خطا، بعد آخرین فعالیت."""
    mistakes = await db.execute(
        select(HifzMistake)
        .where(HifzMistake.user_id == user.id)
        .order_by(HifzMistake.created_at.desc())
        .limit(2000)
    )
    mistake_rows = list(mistakes.scalars().all())
    if not mistake_rows:
        return []
    keys: dict[tuple[int, int], dict] = {}
    for m in mistake_rows:
        entry = keys.setdefault(
            (m.surah, m.ayah),
            {"surah": m.surah, "ayah": m.ayah, "mistake_count": 0,
             "last_activity_at": m.created_at},
        )
        entry["mistake_count"] += 1
        entry["last_activity_at"] = max(entry["last_activity_at"], m.created_at)
    # Latest scores per ayah: the most recently updated attempt that has
    # scores for the ayah decides whether it is still due.
    due: list[dict] = []
    for (surah, ayah), entry in keys.items():
        latest = await db.execute(
            select(HifzWordScore)
            .join(HifzAttempt, HifzWordScore.attempt_id == HifzAttempt.id)
            .where(
                HifzAttempt.user_id == user.id,
                HifzWordScore.surah == surah,
                HifzWordScore.ayah == ayah,
            )
            .order_by(HifzWordScore.updated_at.desc().nullslast())
            .limit(50)
        )
        rows = list(latest.scalars().all())
        if not rows:
            due.append(entry)  # peek-only: never graded clean
            continue
        # Rows may span attempts; group by attempt, take the newest one.
        newest_attempt = max(
            rows, key=lambda r: r.updated_at or r.created_at
        ).attempt_id
        newest = [r for r in rows if r.attempt_id == newest_attempt]
        if any(r.status in ("wrong", "skipped") for r in newest):
            due.append(entry)
    # Newest activity first within each mistake-count group (stable sorts).
    due.sort(key=lambda e: e["last_activity_at"], reverse=True)
    due.sort(key=lambda e: e["mistake_count"], reverse=True)
    return due[:100]


async def admin_attempts(db: AsyncSession, limit: int) -> list[dict]:
    rows = await db.execute(
        select(HifzAttempt)
        .order_by(HifzAttempt.updated_at.desc().nullslast(), HifzAttempt.created_at.desc())
        .limit(limit)
    )
    attempts = list(rows.scalars().all())
    if not attempts:
        return []
    ids = [a.id for a in attempts]
    scores = await db.execute(
        select(HifzWordScore).where(HifzWordScore.attempt_id.in_(ids))
    )
    by_attempt: dict[UUID, list[HifzWordScore]] = {}
    for s in scores.scalars().all():
        by_attempt.setdefault(s.attempt_id, []).append(s)
    return [
        {
            "id": a.id,
            "user_id": a.user_id,
            "surah": a.surah,
            "page": a.page,
            "status": a.status,
            "engine": a.engine,
            "counts": _counts_for(by_attempt.get(a.id, [])),
            "created_at": a.created_at,
        }
        for a in attempts
    ]


async def engine_status(db: AsyncSession) -> dict:
    """وضعیت موتور انتخاب‌شده — بدون بارگذاری مدل (فقط probe ارزان)."""
    raw = await get_typed_setting(db, "quran.asr_engine", "zipformer")
    if raw not in hifz_engines.ENGINE_IDS:
        # مقدار خامِ تنظیم در پیام عمومی برنمی‌گردد (جزئیات داخلی)؛
        # شناسهٔ موتور در فیلد `engine` هست و همان برای کلاینت کافی است.
        return {"engine": str(raw), "available": False,
                "reason": "موتور انتخاب‌شده معتبر نیست",
                "map_available": False, "map_reason": "نگاشت واجی در دسترس نیست"}
    engine = hifz_engines.get_engine(raw)
    available, reason = engine.is_configured()
    from app.modules.quran.hifz_mapping import map_files_present

    map_available, map_reason = map_files_present()
    return {"engine": raw, "available": available, "reason": reason,
            "map_available": map_available, "map_reason": map_reason}


async def delete_attempt(db: AsyncSession, user: User, attempt_id: UUID) -> None:
    """حذف نشست کاربر با همهٔ نمره‌ها و خطاهایش (حریم خصوصی)."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    await db.execute(
        delete(HifzWordScore).where(HifzWordScore.attempt_id == attempt_id)
    )
    await db.execute(
        delete(HifzMistake).where(HifzMistake.attempt_id == attempt_id)
    )
    await db.delete(attempt)
    await db.commit()
