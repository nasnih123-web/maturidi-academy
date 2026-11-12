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
import logging
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
    HifzUserSettings,
    HifzWordScore,
    User,
)

from . import alignment, hifz_engines, hifz_mapping
from . import service as quran_service

logger = logging.getLogger(__name__)

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
        "start_ayah": attempt.start_ayah,
        "end_ayah": attempt.end_ayah,
        "current_surah": attempt.current_surah,
        "current_ayah": attempt.current_ayah,
        "current_word_index": attempt.current_word_index,
        "repeat_ayah": attempt.repeat_ayah,
        "repeat_range": attempt.repeat_range,
    }


# ---------------------------------------------------------------------------
# فاز ۴ — تنظیم‌های حفظِ هر کاربر (یخ‌زدن، کشف خطا، ازسرگیری، نشان‌ها).
# پیش‌فرض‌ها رفتار پرمیومِ ویدیوها را می‌دهند: بدون یخ‌زدن، کشف خطا
# روشن، جلسهٔ تازه در هر شروع، نشان‌های آیه نمایان.
# ---------------------------------------------------------------------------

_SETTINGS_DEFAULTS = {
    "freeze_on_error": False,
    "mistake_detection": True,
    "tashkeel_detection": True,
    "resumable_sessions": False,
    "hide_ayah_markers": False,
    "daily_goal_ayahs": 0,
}

# کلیدهای عددی تنظیم‌ها (بقیه بولی‌اند و با bool() نرمال می‌شوند).
_SETTINGS_INT_KEYS = {"daily_goal_ayahs"}


def _settings_out(row: HifzUserSettings | None) -> dict:
    if row is None:
        return dict(_SETTINGS_DEFAULTS, updated_at=None)
    return {
        "freeze_on_error": row.freeze_on_error,
        "mistake_detection": row.mistake_detection,
        "tashkeel_detection": row.tashkeel_detection,
        "resumable_sessions": row.resumable_sessions,
        "hide_ayah_markers": row.hide_ayah_markers,
        "daily_goal_ayahs": row.daily_goal_ayahs,
        "updated_at": row.updated_at,
    }


async def get_user_settings(db: AsyncSession, user: User) -> dict:
    row = await db.get(HifzUserSettings, user.id)
    return _settings_out(row)


async def update_user_settings(
    db: AsyncSession, user: User, patch: dict[str, bool | int | None]
) -> dict:
    row = await db.get(HifzUserSettings, user.id)
    if row is None:
        row = HifzUserSettings(user_id=user.id, **_SETTINGS_DEFAULTS)
        db.add(row)
    for key, value in patch.items():
        if value is not None and key in _SETTINGS_DEFAULTS:
            if key in _SETTINGS_INT_KEYS:
                setattr(row, key, int(value))
            else:
                setattr(row, key, bool(value))
    row.updated_at = _utcnow()
    await db.commit()
    await db.refresh(row)
    return _settings_out(row)


async def create_attempt(
    db: AsyncSession,
    user: User,
    surah: int,
    page: int | None,
    start_ayah: int | None = None,
    end_ayah: int | None = None,
    repeat_ayah: int = 1,
    repeat_range: int = 1,
) -> dict:
    """ساخت نشست. engine نمایشی لحظهٔ ساخت است؛ نمره‌دهی هر بار موتور
    را از تنظیم می‌خواند. بازهٔ تمرین (start/end_ayah) و شمار تکرار
    روی نشست ذخیره می‌شوند؛ start>end → ۴۲۲."""
    if start_ayah is not None and end_ayah is not None and start_ayah > end_ayah:
        raise APIError(
            422, "hifz_range_invalid", "آیهٔ شروع بازه نمی‌تواند پس از آیهٔ پایان باشد"
        )
    raw = await get_typed_setting(db, "quran.asr_engine", "zipformer")
    engine_snapshot = raw if raw in hifz_engines.ENGINE_IDS else "zipformer"
    attempt = HifzAttempt(
        user_id=user.id,
        surah=surah,
        page=page,
        engine=engine_snapshot,
        start_ayah=start_ayah,
        end_ayah=end_ayah,
        current_surah=surah,
        current_ayah=start_ayah or 1,
        current_word_index=0,
        repeat_ayah=repeat_ayah,
        repeat_range=repeat_range,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return _attempt_out(attempt, {"correct": 0, "close": 0, "wrong": 0, "skipped": 0})


async def update_position(
    db: AsyncSession,
    user: User,
    attempt_id: UUID,
    current_surah: int,
    current_ayah: int,
    current_word_index: int | None,
) -> dict:
    """ثبت آخرین موقعیتِ دنبال‌شدهٔ نشست — سرور-side، برای ازسرگیری
    پس از خروج از برنامه. فقط نشست‌های باز (in_progress/paused)
    موقعیت می‌گیرند؛ نشستِ تکمیل‌شده ۴۰۹ می‌گیرد."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    if attempt.status == "completed":
        raise APIError(
            409, "hifz_attempt_completed", "نشست تکمیل شده است؛ موقعیت آن ثبت نمی‌شود"
        )
    attempt.current_surah = current_surah
    attempt.current_ayah = current_ayah
    attempt.current_word_index = current_word_index
    attempt.updated_at = _utcnow()
    await db.commit()
    return _attempt_out(attempt, await _attempt_counts(db, attempt_id))


async def pause_attempt(db: AsyncSession, user: User, attempt_id: UUID) -> dict:
    """مکثِ سرور-side نشست (رفع G-05 ممیزی فاز ۱: مکث دیگر فقط
    سمت کلاینت نیست). فقط in_progress → paused."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    if attempt.status == "completed":
        raise APIError(409, "hifz_attempt_completed", "نشست تکمیل شده است")
    if attempt.status == "paused":
        return _attempt_out(attempt, await _attempt_counts(db, attempt_id))
    attempt.status = "paused"
    attempt.updated_at = _utcnow()
    await db.commit()
    return _attempt_out(attempt, await _attempt_counts(db, attempt_id))


async def resume_attempt(db: AsyncSession, user: User, attempt_id: UUID) -> dict:
    """ازسرگیری نشستِ مکث‌کرده (یا در جریان): paused → in_progress.
    موقعیتِ ذخیره‌شده (current_*) دست نمی‌خورد؛ کلاینت از همان‌جا
    ادامه می‌دهد."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    if attempt.status == "completed":
        raise APIError(409, "hifz_attempt_completed", "نشست تکمیل شده است")
    if attempt.status == "paused":
        attempt.status = "in_progress"
        attempt.updated_at = _utcnow()
        await db.commit()
    return _attempt_out(attempt, await _attempt_counts(db, attempt_id))


async def resumable_attempt(db: AsyncSession, user: User) -> dict | None:
    """تازه‌ترین نشستِ باز (in_progress یا paused) برای ازسرگیری.
    None یعنی جلسهٔ بازی نیست — کلاینت جلسهٔ تازه می‌سازد. فقط
    وقتی تنظیم resumable_sessions روشن باشد فراخوانده می‌شود؛
    تصمیمِ روشن/خاموش با کلاینت است (سرور این‌جا فیلتر نمی‌کند)."""
    rows = await db.execute(
        select(HifzAttempt)
        .where(
            HifzAttempt.user_id == user.id,
            HifzAttempt.status.in_(("in_progress", "paused")),
        )
        .order_by(HifzAttempt.updated_at.desc().nullslast(), HifzAttempt.created_at.desc())
        .limit(1)
    )
    attempt = rows.scalars().first()
    if attempt is None:
        return None
    return _attempt_out(attempt, await _attempt_counts(db, attempt.id))


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


# ---------------------------------------------------------------------------
# گام ۹ برابری (ایراد ۷) — ترازِ واجیِ اجباری برای مسیرِ دسته‌ای/Whisper.
#
# مسیرِ Whisper تا پیش از این گام زمان‌بندیِ کلمه‌ای نداشت (زمان‌های DTW
# faster-whisper محاسبه و دور ریخته می‌شدند) و ترازِ متنیِ آن
# (align_words) هیچ اتکایی به صدا نداشت. حالا پس از رونویسیِ Whisper،
# همان صوت با خطِ لولهٔ واجیِ Zipformer (همان مدل و دارایی‌های مسیرِ
# زنده) دیکد می‌شود و کلمه‌های موردانتظار با align_phonemes روی رشتهٔ
# واجی تراز می‌شوند؛ زمانِ هر کلمه از بازهٔ واجی‌اش می‌آید، نه از DTW.
# DTW فقط وقتی به کار می‌رود که پس‌پردازشِ واجی در دسترس نباشد و
# همیشه با برچسبِ `dtw_fallback` گزارش می‌شود.
# ---------------------------------------------------------------------------


def _basmala_phoneme_string() -> str:
    """رشتهٔ واجیِ فروپاشیدهٔ بسمله (۱:۱) — همان قاعدهٔ مسیرِ زنده."""
    try:
        mapping = hifz_mapping.load_phoneme_mapping()
    except APIError:
        return ""
    segs = mapping.segments_for(1, 1)
    if not segs:
        return ""
    return "".join(
        hifz_mapping.collapse_phoneme_runs(s.phoneme)
        for s in segs
        if s.phoneme is not None
    )


def _collapse_with_token_map(
    timed: list[hifz_engines.TimedPhoneme],
) -> tuple[str, list[int]]:
    """فروپاشیِ رشتهٔ واجیِ شنیده‌شده با ردِ توکنِ هر نویسه.

    دقیقاً همان قاعدهٔ `collapse_phoneme_runs` (فقط نشانه‌های کششِ
    مد فرومی‌پاشند؛ تشدید دست نمی‌خورد) روی رشتهٔ به‌هم‌چسبیدهٔ
    توکن‌ها، با این اضافه که برای هر نویسهٔ باقی‌مانده شمارهٔ توکنِ
    مبدأش ثبت می‌شود تا بازهٔ واجی به زمان برگردد.
    """
    chars: list[str] = []
    token_of_char: list[int] = []
    prev: str | None = None
    for ti, ph in enumerate(timed):
        for ch in ph.text:
            if ch == prev and ch in hifz_mapping.PHONEME_LENGTH_MARKERS:
                continue
            chars.append(ch)
            token_of_char.append(ti)
            prev = ch
    return "".join(chars), token_of_char


def _prepare_phoneme_alignment(
    units: list[tuple[tuple[int, ...], str | None]],
    timed: list[hifz_engines.TimedPhoneme],
) -> tuple[list[tuple[tuple[int, ...], str | None]], str, list[int]]:
    """آماده‌سازیِ ورودی‌های ترازِ واجی، دقیقاً مثل مسیرِ زنده.

    - هر دو سو فرومی‌پاشند: تکرارِ نشانه‌های کشش در رشتهٔ شنیده‌شده
      با صوت تغییر می‌کند ولی در نگاشت ثابت است؛ ترازِ خام‌به‌خام
      شکننده است و مسیرِ زنده از اول هر دو سو را فرومی‌پاشید.
    - بسملهٔ آغازینِ شنیده‌شده مصرف می‌شود وقتی قطعه‌های آیه با
      بسمله شروع نمی‌شوند (بسملهٔ آغازِ تلاوت جزو آیه نیست؛ ر.ک.
      ایراد ۱۴)؛ برای آیه‌هایی که قطعه‌هایشان با بسمله شروع می‌شوند
      (۱:۱ و ۷:۱ و مانندشان) نگه داشته می‌شود.
    برمی‌گرداند: (قطعه‌های فروپاشیده، رشتهٔ شنیده‌شدهٔ فروپاشیده،
    نقشهٔ نویسه→توکن).
    """
    collapsed_units = [
        (
            widxs,
            hifz_mapping.collapse_phoneme_runs(phon)
            if phon is not None
            else None,
        )
        for (widxs, phon) in units
    ]
    heard, char_token = _collapse_with_token_map(timed)
    basmala = _basmala_phoneme_string()
    if basmala and heard.startswith(basmala):
        first_phon = next(
            (phon for (_w, phon) in collapsed_units if phon is not None),
            None,
        )
        units_begin_with_basmala = first_phon is not None and (
            basmala.startswith(first_phon) or first_phon.startswith(basmala)
        )
        if not units_begin_with_basmala:
            heard = heard[len(basmala):]
            char_token = char_token[len(basmala):]
    return collapsed_units, heard, char_token


def _spans_to_timings(
    aligned: list[alignment.AlignedWord],
    timed: list[hifz_engines.TimedPhoneme],
    char_token: list[int],
) -> dict[int, tuple[float, float]]:
    """بازه‌های واجیِ `align_phonemes` را به زمانِ (شروع، پایان) برگردان.

    قرارداد: کلمه از زمانِ نخستین توکنِ واجیِ بازه‌اش شروع می‌شود و
    تا زمانِ شروعِ نخستین توکنِ پس از بازه ادامه دارد؛ دمِ آخرین توکن،
    میانهٔ فاصله‌های بین توکنیِ همین دیکد است. کلمهٔ جاافتاده (بدون
    بازه) زمان ندارد. قطعه‌ای که چند کلمه را می‌پوشاند، یک بازه دارد
    و همهٔ کلمه‌هایش همان زمان را می‌گیرند.
    """
    if not timed or not char_token:
        return {}
    starts = [float(p.start) for p in timed]
    gaps = sorted(b - a for a, b in zip(starts, starts[1:]) if b > a)
    tail = gaps[len(gaps) // 2] if gaps else 0.16
    out: dict[int, tuple[float, float]] = {}
    for w in aligned:
        if w.phoneme_start is None or w.phoneme_end is None:
            continue
        s, e = w.phoneme_start, w.phoneme_end
        if s < 0 or e <= s or e > len(char_token):
            continue
        first_tok = char_token[s]
        last_tok = char_token[e - 1]
        end = (
            starts[last_tok + 1]
            if last_tok + 1 < len(starts)
            else starts[last_tok] + tail
        )
        out[w.word_index] = (round(starts[first_tok], 3), round(end, 3))
    return out


def _phoneme_post_pass_possible(
    phoneme_engine: object | None = None,
) -> bool:
    """کاوشِ ارزان (بدون بارگذاریِ مدل) برای تصمیمِ پیش از رونویسی:
    آیا پس‌پردازشِ واجی در دسترس است؟ فقط برای این تصمیم است؛
    در دسترس نبودنش به‌معنای درخواستِ DTW از Whisper است."""
    try:
        engine = phoneme_engine
        if engine is None:
            engine = hifz_engines.get_engine("zipformer")
        return bool(engine.is_configured()[0])
    except Exception:
        return False


async def _phoneme_post_pass(
    wav_bytes: bytes,
    expected: list[str],
    units: list[tuple[tuple[int, ...], str | None]],
    green: float,
    amber: float,
    phoneme_engine: object | None = None,
) -> dict[int, tuple[float, float]] | None:
    """پس‌پردازشِ ترازِ واجیِ اجباری برای مسیرِ Whisper (گام ۹).

    همان صوت با خطِ لولهٔ واجیِ Zipformer دیکد می‌شود و کلمه‌های
    موردانتظار با `align_phonemes` — همان تابعی که مسیرِ ضبطیِ
    Zipformer استفاده می‌کند — روی رشتهٔ واجی تراز می‌شوند. در صورتِ
    در دسترس نبودنِ پس‌پردازش به هر دلیل (موتور پیکربندی نشده،
    دیکد ناموفق، نگاشت در دسترس نیست) None برمی‌گردد تا فراخواننده
    به DTW بیفتد؛ هرگز برای نبودِ پس‌پردازش خطا نمی‌دهد — نمره‌دهی
    به آن وابسته نیست.
    """
    try:
        engine = phoneme_engine
        if engine is None:
            engine = hifz_engines.get_engine("zipformer")
        ok, _reason = engine.is_configured()
        if not ok:
            return None
        timed = await asyncio.to_thread(
            engine.transcribe_timed_phonemes, wav_bytes
        )
        prep_units, heard, char_token = _prepare_phoneme_alignment(
            units, timed
        )
        aligned, _extra = alignment.align_phonemes(
            expected, prep_units, heard, green, amber
        )
        return _spans_to_timings(aligned, timed, char_token)
    except (hifz_engines.EngineError, APIError) as exc:
        logger.warning("hifz phoneme post-pass unavailable: %s", exc)
        return None


def _dtw_timings_from_aligned(
    aligned: list[alignment.AlignedWord],
    transcription: hifz_engines.Transcription,
) -> dict[int, tuple[float, float]]:
    """زمان‌های DTW کلمه‌های Whisper، نگاشت‌شده روی کلمهٔ موردانتظار
    از راهِ `heard_index`.

    فقط آخرین راهِ جایگزین است (گام ۹): وقتی پس‌پردازشِ واجی در
    دسترس نیست و فراخواننده آن را با برچسبِ `dtw_fallback` گزارش
    می‌کند. کلمهٔ بدونِ همتای شنیده‌شده (جاافتاده) زمان ندارد.
    """
    out: dict[int, tuple[float, float]] = {}
    words = transcription.words
    for w in aligned:
        hi = w.heard_index
        if hi is None or not 0 <= hi < len(words):
            continue
        hw = words[hi]
        if hw.start is not None and hw.end is not None:
            out[w.word_index] = (
                round(float(hw.start), 3),
                round(float(hw.end), 3),
            )
    return out


async def _whisper_timings(
    db: AsyncSession,
    wav_bytes: bytes,
    expected: list[str],
    units: list[tuple[tuple[int, ...], str | None]] | None,
    aligned: list[alignment.AlignedWord],
    transcription: hifz_engines.Transcription,
    green: float,
    amber: float,
    transcriber: object | None = None,
    phoneme_engine: object | None = None,
) -> tuple[dict[int, tuple[float, float]], str]:
    """زمان‌بندیِ کلمه‌ای برای مسیرِ Whisper (گام ۹).

    ترتیب: (۱) ترازِ واجیِ اجباری — همان خطِ لولهٔ Zipformerِ مسیرِ
    زنده (وقتی `units` هست)؛ (۲) DTWِ رونویسیِ Whisper، فقط
    به‌عنوانِ آخرین راهِ جایگزین و با برچسبِ `dtw_fallback`؛
    (۳) بدونِ زمان (`none`). برچسب همان چیزی است که API با
    `timing_source` گزارش می‌دهد، پس گیرنده همیشه می‌داند زمان از
    کجا آمده است.
    """
    post = None
    if units is not None:
        post = await _phoneme_post_pass(
            wav_bytes, expected, units, green, amber, phoneme_engine
        )
    if post:
        return post, "phoneme"
    dtw = _dtw_timings_from_aligned(aligned, transcription)
    if dtw:
        return dtw, "dtw_fallback"
    if transcriber is None:
        # پس‌پردازش پس از کاوشِ مثبت ناموفق شد: یک رونویسیِ دوباره
        # با DTW روشن، به‌عنوانِ آخرین راهِ جایگزین.
        try:
            _eid, retry, _level = await _transcribe(
                db, wav_bytes, None, word_timestamps=True
            )
        except APIError:
            return {}, "none"
        dtw = _dtw_timings_from_aligned(aligned, retry)
        if dtw:
            return dtw, "dtw_fallback"
    return {}, "none"


async def _transcribe(
    db: AsyncSession,
    wav_bytes: bytes,
    transcriber: object | None,
    word_timestamps: bool = False,
) -> tuple[str, hifz_engines.Transcription, str]:
    """رونویسی با موتور انتخاب‌شده؛ خرابی → ۵۰۳ صادقانه، بدون جایگزین.

    برمی‌گرداند: (شناسهٔ موتور، رونویسی، سطح خروجی «word» یا «phoneme»).
    خروجی واجی (Zipformer) هرگز به‌عنوان کلمه تراز نمی‌شود؛ نمره‌دهی،
    آن را از مسیر قطعه‌ای (align_phonemes) می‌گذراند.
    `word_timestamps` فقط برای موتورهایی که DTW می‌دهند معنا دارد
    (Whisper) و پیش‌فرض خاموش است (گام ۹): DTW فقط آخرین راهِ
    جایگزینِ زمان‌بندی است، نه پیش‌فرض.
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
        if word_timestamps and getattr(
            engine, "supports_dtw_timestamps", False
        ):
            result = await asyncio.to_thread(engine.transcribe, wav_bytes, True)
        else:
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
            "wrong_word", "wrong_tashkeel", "skipped", "transposed",
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
    # Extra words (فاز ۴): کلمه‌های اضافه هرگز روی صفحه نوشته
    # نمی‌شوند، ولی در برگهٔ خطاها می‌مانند — یک ردیف خطا با نوع
    # "extra" برای هر کلمهٔ اضافه، با heard=کلمهٔ اضافه و
    # expected_text خالی (مقابلِ موردانتظاری ندارد؛ کارت «كلمات
    # زائدة» فقط یک ردیف دارد). نمره‌دهیِ دوبارهٔ همان آیه، ردیف‌های
    # extra قدیمیِ همان آیه را جایگزین می‌کند تا برگه کهنه نشود.
    if extra:
        await db.execute(
            delete(HifzMistake).where(
                HifzMistake.attempt_id == attempt.id,
                HifzMistake.surah == surah,
                HifzMistake.ayah == ayah,
                HifzMistake.mistake_type == "extra",
            )
        )
        for extra_word in extra:
            db.add(
                HifzMistake(
                    attempt_id=attempt.id,
                    user_id=attempt.user_id,
                    surah=surah,
                    ayah=ayah,
                    word_index=None,
                    mistake_type="extra",
                    expected_text="",
                    heard=extra_word,
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
    phoneme_engine: object | None = None,
) -> dict:
    """نمره‌دهی یک آیهٔ کامل.

    `phoneme_engine` درزِ تستِ پس‌پردازشِ واجی است (شیئی با
    `is_configured()` و `transcribe_timed_phonemes(bytes)`)؛ در
    محصول None می‌ماند و موتورِ واقعیِ Zipformer استفاده می‌شود.
    پاسخ هر کلمه `start`/`end` (ثانیه، یا None) و سطحِ پاسخ
    `timing_source` دارد: `phoneme` (ترازِ واجی)، `dtw_fallback`
    (DTWِ Whisper، آخرین راهِ جایگزین) یا `none`.
    """
    attempt = await _attempt_or_404(db, user, attempt_id)
    validate_wav_16k_mono(wav_bytes)
    expected = await _ayah_words(db, surah, ayah)
    green, amber = await get_thresholds(db)
    # تصمیمِ DTW پیش از رونویسی (گام ۹): فقط وقتی پس‌پردازشِ واجی
    # از اساس در دسترس نیست، از Whisper زمانِ DTW خواسته می‌شود.
    want_dtw = not _phoneme_post_pass_possible(phoneme_engine)
    engine_id, transcription, level = await _transcribe(
        db, wav_bytes, transcriber, word_timestamps=want_dtw
    )
    if level == "phoneme":
        # مسیر واجی Zipformer: رشتهٔ واجی روی قطعه‌های نگاشت تراز
        # می‌شود؛ واجِ اضافهٔ پایانی، «مادهٔ واجیِ تجزیه‌نشده» است، نه کلمه.
        # (گام ۹: آماده‌سازیِ مسیرِ زنده — فروپاشیِ هر دو سو + مصرفِ
        # بسملهٔ آغازین — تا تراز روی صدای واقعی هم درست بماند؛
        # زمان‌بندی هم از همان تراز می‌آید، نه از دیکدِ دوم.)
        units = _phoneme_units(surah, ayah)
        timed = getattr(transcription, "timed_phonemes", None)
        if timed:
            prep_units, phoneme_text, char_token = _prepare_phoneme_alignment(
                units, timed
            )
            aligned, extra = alignment.align_phonemes(
                expected, prep_units, phoneme_text, green, amber
            )
            timings = _spans_to_timings(aligned, timed, char_token)
            timing_source = "phoneme" if timings else "none"
        else:
            phoneme_text = "".join(
                w.text for w in transcription.words if w.text != "<blank>"
            )
            aligned, extra = alignment.align_phonemes(
                expected, units, phoneme_text, green, amber
            )
            timings, timing_source = {}, "none"
    else:
        heard = [w.text for w in transcription.words]
        probs = [w.prob for w in transcription.words]
        aligned, extra = alignment.align_words(expected, heard, probs, green, amber)
        # نگاشتِ واجی برای پس‌پردازش لازم است، ولی نبودنش نمره‌دهیِ
        # متنیِ Whisper را نمی‌شکند — فقط پس‌پردازش رد می‌شود و
        # زمان‌بندی به DTW می‌افتد (برچسب‌دار).
        try:
            units = _phoneme_units(surah, ayah)
        except APIError:
            units = None
        timings, timing_source = await _whisper_timings(
            db, wav_bytes, expected, units, aligned, transcription,
            green, amber, transcriber=transcriber, phoneme_engine=phoneme_engine,
        )
    stored = await _store_grade(db, attempt, surah, ayah, aligned, extra)
    counts = _counts_for(stored)
    return {
        "attempt_id": attempt.id,
        "surah": surah,
        "ayah": ayah,
        "word_index": None,
        "engine_used": engine_id,
        "thresholds": {"green": green, "amber": amber},
        "timing_source": timing_source,
        "words": [
            {
                "word_index": w.word_index,
                "expected": w.expected,
                "status": w.status,
                "prob": w.prob,
                "heard": w.heard,
                "mistake_type": w.mistake_type,
                "needs_review": w.needs_review,
                "start": timings.get(w.word_index, (None, None))[0],
                "end": timings.get(w.word_index, (None, None))[1],
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
    phoneme_engine: object | None = None,
) -> dict:
    """تمرین تک‌کلمه: فقط همان یک کلمه نمره می‌گیرد."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    validate_wav_16k_mono(wav_bytes)
    words = await _ayah_words(db, surah, ayah)
    if not 0 <= word_index < len(words):
        raise APIError(422, "hifz_word_index", "شمارهٔ کلمه خارج از آیه است")
    expected = [words[word_index]]
    green, amber = await get_thresholds(db)
    want_dtw = not _phoneme_post_pass_possible(phoneme_engine)
    engine_id, transcription, level = await _transcribe(
        db, wav_bytes, transcriber, word_timestamps=want_dtw
    )
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
        timed = getattr(transcription, "timed_phonemes", None)
        if timed:
            prep_units, phoneme_text, char_token = _prepare_phoneme_alignment(
                single_units, timed
            )
            aligned, extra = alignment.align_phonemes(
                expected, prep_units, phoneme_text, green, amber
            )
            timings = _spans_to_timings(aligned, timed, char_token)
            timing_source = "phoneme" if timings else "none"
        else:
            phoneme_text = "".join(
                w.text for w in transcription.words if w.text != "<blank>"
            )
            aligned, extra = alignment.align_phonemes(
                expected, single_units, phoneme_text, green, amber
            )
            timings, timing_source = {}, "none"
    else:
        heard = [w.text for w in transcription.words]
        probs = [w.prob for w in transcription.words]
        aligned, extra = alignment.align_words(expected, heard, probs, green, amber)
        try:
            units = _phoneme_units(surah, ayah)
            covering = [u for u in units if word_index in u[0]]
            single_units = (
                [((0,), phon) for (widxs, phon) in covering] if covering else None
            )
        except APIError:
            single_units = None
        timings, timing_source = await _whisper_timings(
            db, wav_bytes, expected, single_units, aligned, transcription,
            green, amber, transcriber=transcriber, phoneme_engine=phoneme_engine,
        )
    # The single aligned word is indexed 0 in the alignment above;
    # its timing is keyed by that index (re-indexed below for storage).
    timing = timings.get(0, (None, None))
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
        "timing_source": timing_source,
        "words": [
            {
                "word_index": word_index,
                "expected": expected[0],
                "status": aligned[0].status if aligned else "skipped",
                "prob": aligned[0].prob if aligned else 0.0,
                "heard": aligned[0].heard if aligned else None,
                "mistake_type": aligned[0].mistake_type if aligned else "skipped",
                "needs_review": aligned[0].needs_review if aligned else False,
                "start": timing[0],
                "end": timing[1],
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
    kind: str = "word",
) -> dict:
    """Peek: نمایش کلمه(ها) = ثبت خطا. ردیف نمره نمی‌سازد. One call
    reveals one word or a whole list (the rest of the ayah): every
    word gets its own peek mistake in a single transaction, each
    with status `peeked` on the page.

    فاز ۴ — `kind` معنای دکمه را از روی شواهد ویدیو می‌گوید: "word"
    = دکمهٔ `<` (پیش‌نمایش کلمهٔ بعد، یک کلمه)، "ayah" = دکمهٔ `<<`
    (پیش‌نمایش بقیهٔ آیه). جریمهٔ Peek در نمرهٔ SRS همان ۰٫۰۵
    به‌ازای هر Peek است (hifz_plan.py) و این‌جا عوض نشده؛ مقدارش
    نیازمند تأیید کاربر است (یادداشت فاز ۴)."""
    if kind not in ("word", "ayah"):
        raise APIError(422, "hifz_peek_kind", "kind باید word یا ayah باشد")
    if kind == "ayah" and word_indices is None:
        raise APIError(
            422, "hifz_peek_target", "peek آیه به word_indices نیاز دارد"
        )
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
    # revealed دقیقاً به‌ترتیب indices ساخته شده (یک ردیف به‌ازای هر
    # اندیس)؛ پس کلمه را با همان اندیسِ اعتبارسنجی‌شده می‌خوانیم، نه با
    # word_index مدل که nullable است.
    return {
        "mistake_id": first.id,
        "surah": surah,
        "ayah": ayah,
        "word_index": first.word_index,
        "word": words[indices[0]],
        "revealed": [
            {
                "mistake_id": m.id,
                "word_index": m.word_index,
                "word": words[i],
            }
            for m, i in zip(revealed, indices)
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


async def delete_attempt_admin(db: AsyncSession, attempt_id: UUID) -> None:
    """حذفِ نشستِ هر کاربر توسط ادمین (CRM) — بدون بررسیِ مالکیت.

    مکانیکِ حذف یک‌جاست با حذفِ مالک (delete_attempt)؛ تفاوت فقط
    نگهبانِ مسیر است (_admin_perm به‌جای مالکیت). حذفِ یک‌جای
    همهٔ دادهٔ یک کاربر (P1-5) همچنان نیازمندِ تصمیمِ کاربر است.
    """
    attempt = await db.get(HifzAttempt, attempt_id)
    if attempt is None:
        raise APIError(404, "hifz_attempt_not_found", "نشست حفظ پیدا نشد")
    await db.execute(
        delete(HifzWordScore).where(HifzWordScore.attempt_id == attempt_id)
    )
    await db.execute(
        delete(HifzMistake).where(HifzMistake.attempt_id == attempt_id)
    )
    await db.delete(attempt)
    await db.commit()


# ---------------------------------------------------------------------------
# فاز ۴ — برگهٔ خطاها (گروهی، مثل ترتیل) + حذفِ تکیِ یک خطا.
# ---------------------------------------------------------------------------

_WRONG_MISTAKE_TYPES = ("wrong_word", "wrong_tashkeel", "skipped", "transposed")


async def mistakes_grouped(db: AsyncSession, user: User, attempt_id: UUID) -> list[dict]:
    """برگهٔ خطاها، گروه‌شده به‌ازای هر آیه — همان شکل ترتیل (§۸
    مشخصات فاز ۲): هر کارت یک دسته («كلمات خاطئة» / «كلمات زائدة»)
    + برچسب «سوره:آیه» دارد؛ کارت «خاطئة» دو ردیف دارد (موردانتظار
    سبز / خوانده‌شده قرمز) و کارت «زائدة» فقط یک ردیف (کلمهٔ اضافهٔ
    قرمز). Peek در برگه نمی‌آید (نمایش است، نه خطا)؛ «نزدیک» هم
    ردیف تاریخچه ندارد (مثل قبل). ترتیب: آیهٔ صعودی، بعد زمان."""
    attempt = await _attempt_or_404(db, user, attempt_id)
    rows = await db.execute(
        select(HifzMistake)
        .where(HifzMistake.attempt_id == attempt.id)
        .order_by(
            HifzMistake.surah, HifzMistake.ayah, HifzMistake.created_at
        )
    )
    groups: dict[tuple[int, int, str], dict] = {}
    for m in rows.scalars().all():
        if m.mistake_type == "extra":
            category = "extra_words"
        elif m.mistake_type in _WRONG_MISTAKE_TYPES:
            category = "wrong_words"
        else:
            continue  # peek و جز آن در برگه نمی‌آیند
        key = (m.surah, m.ayah, category)
        group = groups.setdefault(
            key,
            {"surah": m.surah, "ayah": m.ayah, "category": category, "items": []},
        )
        group["items"].append(
            {
                "id": m.id,
                "mistake_type": m.mistake_type,
                "word_index": m.word_index,
                "expected_text": m.expected_text,
                "heard": m.heard,
                "created_at": m.created_at,
            }
        )
    return sorted(
        groups.values(), key=lambda g: (g["surah"], g["ayah"], g["category"])
    )


async def delete_mistake(db: AsyncSession, user: User, mistake_id: UUID) -> None:
    """حذفِ تکیِ یک ردیف خطا (مکانیک P1-5: حذفِ دانه‌ای موجود است؛
    حذفِ یک‌جای همهٔ دادهٔ حفظ هنوز تصمیم کاربر را می‌خواهد و این‌جا
    ساخته نشده است). فقط خطای خودِ کاربر حذف می‌شود."""
    row = await db.get(HifzMistake, mistake_id)
    if row is None or row.user_id != user.id:
        raise APIError(404, "hifz_mistake_not_found", "خطا پیدا نشد")
    await db.delete(row)
    await db.commit()
