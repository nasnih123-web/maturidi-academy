"""سرویس برنامهٔ حفظ، SRS، داشبورد، کارت‌های پیشنهادی و تسمی — فاز ۱۰.

جریان جداگانه از صفحهٔ مطالعه: هیچ‌کدام از این داده‌ها روی صفحهٔ
مطالعهٔ حفاظ نمایش داده نمی‌شوند (دستور کاربر ۲۰۲۶-۱۱-۰۶).
داشبورد فقط آمار واقعی و قابل‌ردیابی نشان می‌دهد (نشست‌ها، آیات،
کلمه‌های ارزیابی‌شده، خطاها و انواع‌شان، روند زمانی، موارد نیازمند
مرور) — هیچ عدد ساختگی‌ای نیست.

کارت‌های پیشنهادی (Warm Up / Weakest Link) فقط وقتی ساخته می‌شوند
که کاربر بازه‌های محفوظات و تاریخچهٔ کافی داشته باشد: دست‌کم یک
برنامهٔ فعال با دست‌کم یک آیهٔ «done» (محفوظاتِ اعلام‌شده) و دست‌کم
۱۰ کلمهٔ ارزیابی‌شده. در نبود داده، کارت ساخته نمی‌شود
(`available: false` + `reason: setup_required`) — هرگز از بازه‌ای
که کاربر به‌عنوان محفوظات معرفی نکرده، بدون رضایت او آزمون گرفته
نمی‌شود.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import (
    HifzAttempt,
    HifzMistake,
    HifzPlan,
    HifzPlanItem,
    HifzReview,
    HifzTasmiSession,
    HifzWordScore,
    User,
)

from . import hifz_plan, hifz_service
from . import service as quran_service

SUGGESTED_MIN_GRADED_WORDS = 10


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def _ayah_counts(db: AsyncSession) -> dict[int, int]:
    counts: dict[int, int] = {}
    for surah in range(1, 115):
        meta = quran_service.get_surah(surah)
        counts[surah] = int(meta.ayahs)
    return counts


# ---------------------------------------------------------------------------
# برنامهٔ حفظ
# ---------------------------------------------------------------------------

async def create_plan(
    db: AsyncSession,
    user: User,
    *,
    title: str,
    kind: str,
    direction: str,
    start_surah: int,
    start_ayah: int,
    end_surah: int,
    end_ayah: int,
    daily_target_new: int = 1,
    daily_target_review: int = 5,
) -> dict:
    if kind not in ("memorize", "review", "recite"):
        raise APIError(422, "hifz_plan_kind", "نوع برنامه باید memorize/review/recite باشد")
    if direction not in ("normal", "reverse"):
        raise APIError(422, "hifz_plan_direction", "جهت برنامه باید normal یا reverse باشد")
    if not (1 <= start_surah <= 114 and 1 <= end_surah <= 114):
        raise APIError(422, "hifz_plan_range", "شمارهٔ سوره باید ۱ تا ۱۱۴ باشد")
    if (start_surah, start_ayah) > (end_surah, end_ayah):
        raise APIError(422, "hifz_plan_range", "شروع بازه باید پیش از پایان آن باشد")
    counts = await _ayah_counts(db)
    if not (1 <= start_ayah <= counts[start_surah]):
        raise APIError(422, "hifz_plan_range", "آیهٔ شروع خارج از سوره است")
    if not (1 <= end_ayah <= counts[end_surah]):
        raise APIError(422, "hifz_plan_range", "آیهٔ پایان خارج از سوره است")
    if daily_target_new < 0 or daily_target_review < 0:
        raise APIError(422, "hifz_plan_target", "هدف روزانه نمی‌تواند منفی باشد")
    order = hifz_plan.plan_ayah_order(
        (start_surah, start_ayah), (end_surah, end_ayah),
        direction=direction, ayah_counts=counts,
    )
    plan = HifzPlan(
        user_id=user.id,
        title=title,
        kind=kind,
        direction=direction,
        start_surah=start_surah,
        start_ayah=start_ayah,
        end_surah=end_surah,
        end_ayah=end_ayah,
        daily_target_new=daily_target_new,
        daily_target_review=daily_target_review,
    )
    db.add(plan)
    await db.flush()
    for pos, (s, a) in enumerate(order):
        db.add(
            HifzPlanItem(
                plan_id=plan.id,
                user_id=user.id,
                surah=s,
                ayah=a,
                position=pos,
                is_new=(kind == "memorize"),
                status="pending",
            )
        )
    await db.commit()
    await db.refresh(plan)
    return _plan_out(plan, len(order), 0)


def _plan_out(plan: HifzPlan, total: int, done: int) -> dict:
    return {
        "id": plan.id,
        "title": plan.title,
        "kind": plan.kind,
        "direction": plan.direction,
        "start_surah": plan.start_surah,
        "start_ayah": plan.start_ayah,
        "end_surah": plan.end_surah,
        "end_ayah": plan.end_ayah,
        "daily_target_new": plan.daily_target_new,
        "daily_target_review": plan.daily_target_review,
        "status": plan.status,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
        "completed_at": plan.completed_at,
        "total_ayahs": total,
        "done_ayahs": done,
    }


async def _plan_or_404(db: AsyncSession, user: User, plan_id: UUID) -> HifzPlan:
    plan = await db.get(HifzPlan, plan_id)
    if plan is None or plan.user_id != user.id:
        raise APIError(404, "hifz_plan_not_found", "برنامه پیدا نشد")
    return plan


async def _plan_progress(db: AsyncSession, plan_id: UUID) -> tuple[int, int]:
    total = await db.execute(
        select(func.count()).select_from(HifzPlanItem).where(
            HifzPlanItem.plan_id == plan_id
        )
    )
    done = await db.execute(
        select(func.count()).select_from(HifzPlanItem).where(
            HifzPlanItem.plan_id == plan_id, HifzPlanItem.status == "done"
        )
    )
    return int(total.scalar_one()), int(done.scalar_one())


async def list_plans(db: AsyncSession, user: User) -> list[dict]:
    rows = await db.execute(
        select(HifzPlan)
        .where(HifzPlan.user_id == user.id)
        .order_by(HifzPlan.created_at.desc())
    )
    out = []
    for plan in rows.scalars().all():
        total, done = await _plan_progress(db, plan.id)
        out.append(_plan_out(plan, total, done))
    return out


async def get_plan(db: AsyncSession, user: User, plan_id: UUID) -> dict:
    plan = await _plan_or_404(db, user, plan_id)
    total, done = await _plan_progress(db, plan.id)
    items = await db.execute(
        select(HifzPlanItem)
        .where(HifzPlanItem.plan_id == plan.id)
        .order_by(HifzPlanItem.position)
    )
    return {
        **_plan_out(plan, total, done),
        "items": [
            {
                "id": it.id,
                "surah": it.surah,
                "ayah": it.ayah,
                "position": it.position,
                "is_new": it.is_new,
                "status": it.status,
                "completed_at": it.completed_at,
            }
            for it in items.scalars().all()
        ],
    }


async def set_plan_status(
    db: AsyncSession, user: User, plan_id: UUID, status: str
) -> dict:
    """توقف (paused) / ادامه (active) / تکمیل (completed) برنامه."""
    if status not in ("active", "paused", "completed"):
        raise APIError(422, "hifz_plan_status", "وضعیت برنامه نامعتبر است")
    plan = await _plan_or_404(db, user, plan_id)
    plan.status = status
    plan.completed_at = _utcnow() if status == "completed" else None
    await db.commit()
    total, done = await _plan_progress(db, plan.id)
    return _plan_out(plan, total, done)


async def set_plan_item(
    db: AsyncSession,
    user: User,
    plan_id: UUID,
    item_id: UUID,
    status: str,
) -> dict:
    """ثبت وضعیت یک آیهٔ برنامه: کامل (done) / ناقص (in_progress) /
    ردشده (skipped) / در انتظار (pending). پیشرفت واقعی است — فقط
    همین ثبت‌ها شمرده می‌شوند."""
    if status not in ("pending", "in_progress", "done", "skipped"):
        raise APIError(422, "hifz_plan_item_status", "وضعیت آیه نامعتبر است")
    plan = await _plan_or_404(db, user, plan_id)
    item = await db.get(HifzPlanItem, item_id)
    if item is None or item.plan_id != plan.id:
        raise APIError(404, "hifz_plan_item_not_found", "آیهٔ برنامه پیدا نشد")
    item.status = status
    item.completed_at = _utcnow() if status == "done" else None
    await db.commit()
    total, done = await _plan_progress(db, plan.id)
    return {
        **_plan_out(plan, total, done),
        "item": {
            "id": item.id, "surah": item.surah, "ayah": item.ayah,
            "status": item.status, "completed_at": item.completed_at,
        },
    }


async def delete_plan(db: AsyncSession, user: User, plan_id: UUID) -> None:
    """حذف برنامهٔ کاربر با همهٔ آیه‌هایش (حریم خصوصی).

    حذف، کامل و بی‌بازگشت است. ردیف‌های SRS (`hifz_reviews`) جدا
    می‌مانند — آن‌ها تاریخچهٔ مرورِ آیه‌اند، نه جزئی از برنامه؛
    اگر کاربر همهٔ دادهٔ حفظش را می‌خواهد، حذفِ نشست‌ها + برنامه‌ها
    + آزمون‌ها آن را می‌پوشاند و SRS با مرورِ بعدی بازسازی می‌شود.
    """
    await _plan_or_404(db, user, plan_id)
    await db.execute(
        delete(HifzPlanItem).where(HifzPlanItem.plan_id == plan_id)
    )
    await db.execute(delete(HifzPlan).where(HifzPlan.id == plan_id))
    await db.commit()


# ---------------------------------------------------------------------------
# SRS (SM-2)
# ---------------------------------------------------------------------------

async def record_review(
    db: AsyncSession,
    user: User,
    *,
    surah: int,
    ayah: int,
    quality: int | None = None,
    counts: dict[str, int] | None = None,
    peek_count: int = 0,
    now: datetime | None = None,
) -> dict:
    """ثبت یک مرور و محاسبهٔ موعد بعدی با SM-2.

    کیفیت یا مستقیم داده می‌شود (۰ تا ۵) یا از نمرهٔ ASR مشتق
    می‌شود (counts + peek_count) — نه از یک درصد ثابت.
    """
    if quality is None:
        if counts is None:
            raise APIError(
                422, "hifz_review_quality",
                "کیفیت یا نمره (counts) برای ثبت مرور لازم است",
            )
        quality = hifz_plan.quality_from_grade(counts, peek_count=peek_count)
    if not 0 <= quality <= 5:
        raise APIError(422, "hifz_review_quality", "کیفیت باید ۰ تا ۵ باشد")
    now = now or _utcnow()
    row = await db.execute(
        select(HifzReview).where(
            HifzReview.user_id == user.id,
            HifzReview.surah == surah,
            HifzReview.ayah == ayah,
        )
    )
    review = row.scalars().first()
    if review is None:
        review = HifzReview(
            user_id=user.id, surah=surah, ayah=ayah,
            ease=hifz_plan.SM2_PARAMS["initial_ease"],
            interval_days=0, repetitions=0,
        )
        db.add(review)
    nxt = hifz_plan.sm2_next(
        quality, review.repetitions, review.ease, review.interval_days, now=now
    )
    review.repetitions = nxt["repetitions"]
    review.ease = nxt["ease"]
    review.interval_days = nxt["interval_days"]
    review.due_at = nxt["due_at"]
    review.last_quality = quality
    review.last_reviewed_at = now
    review.params_version = nxt["params_version"]
    await db.commit()
    return {
        "surah": surah,
        "ayah": ayah,
        "quality": quality,
        "repetitions": review.repetitions,
        "ease": review.ease,
        "interval_days": review.interval_days,
        "due_at": review.due_at,
        "params_version": review.params_version,
    }


async def due_reviews(db: AsyncSession, user: User, limit: int = 100) -> list[dict]:
    """آیه‌های نیازمند مرور (موعدشان رسیده) + صف قدیمیِ خطاها.

    اول ردیف‌های SRS با due_at <= اکنون (مرتب بر اساس موعد)، بعد
    صف مرورِ مبتنی بر خطا (`review_queue`) برای آیه‌هایی که هنوز
    ردیف SRS ندارند — بدون تکرار.
    """
    now = _utcnow()
    rows = await db.execute(
        select(HifzReview)
        .where(HifzReview.user_id == user.id, HifzReview.due_at <= now)
        .order_by(HifzReview.due_at)
        .limit(limit)
    )
    out = [
        {
            "surah": r.surah,
            "ayah": r.ayah,
            "due_at": r.due_at,
            "repetitions": r.repetitions,
            "ease": r.ease,
            "interval_days": r.interval_days,
            "last_quality": r.last_quality,
            "source": "srs",
        }
        for r in rows.scalars().all()
    ]
    seen = {(o["surah"], o["ayah"]) for o in out}
    legacy = await hifz_service.review_queue(db, user)
    for entry in legacy:
        if (entry["surah"], entry["ayah"]) not in seen:
            out.append({**entry, "source": "mistakes"})
    return out[:limit]


# ---------------------------------------------------------------------------
# داشبورد (فقط آمار واقعی)
# ---------------------------------------------------------------------------

async def dashboard(db: AsyncSession, user: User) -> dict:
    attempts = await db.execute(
        select(func.count()).select_from(HifzAttempt).where(
            HifzAttempt.user_id == user.id
        )
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
    errors = await db.execute(
        select(HifzMistake.mistake_type, func.count())
        .where(HifzMistake.user_id == user.id)
        .group_by(HifzMistake.mistake_type)
    )
    errors_by_type = {t: int(n) for t, n in errors.all()}
    # روند روزانهٔ ۳۰ روز گذشته: نشست‌ها و کلمه‌های ارزیابی‌شده.
    since = _utcnow() - timedelta(days=30)
    daily_attempts = await db.execute(
        select(
            func.date(HifzAttempt.created_at), func.count()
        )
        .where(
            HifzAttempt.user_id == user.id, HifzAttempt.created_at >= since
        )
        .group_by(func.date(HifzAttempt.created_at))
        .order_by(func.date(HifzAttempt.created_at))
    )
    daily_words = await db.execute(
        select(
            func.date(HifzWordScore.created_at), func.count()
        )
        .join(HifzAttempt, HifzWordScore.attempt_id == HifzAttempt.id)
        .where(
            HifzAttempt.user_id == user.id,
            HifzWordScore.created_at >= since,
        )
        .group_by(func.date(HifzWordScore.created_at))
        .order_by(func.date(HifzWordScore.created_at))
    )
    attempts_by_day = {str(d): int(n) for d, n in daily_attempts.all()}
    words_by_day = {str(d): int(n) for d, n in daily_words.all()}
    days: list[dict] = []
    for i in range(30):
        day = (_utcnow() - timedelta(days=29 - i)).date()
        key = str(day)
        days.append(
            {
                "date": key,
                "attempts": attempts_by_day.get(key, 0),
                "graded_words": words_by_day.get(key, 0),
            }
        )
    due = await due_reviews(db, user, limit=100)
    plans = await list_plans(db, user)
    # پرخطاترین آیه‌ها (۵ آیهٔ اول) — فقط از خطاهای واقعی.
    worst = await db.execute(
        select(
            HifzMistake.surah, HifzMistake.ayah, func.count()
        )
        .where(HifzMistake.user_id == user.id)
        .group_by(HifzMistake.surah, HifzMistake.ayah)
        .order_by(func.count().desc())
        .limit(5)
    )
    return {
        "attempts": attempt_count,
        "graded_words": graded,
        "counts": counts,
        "errors_by_type": errors_by_type,
        "daily_series": days,
        "due_count": len(due),
        "due_ayahs": due[:10],
        "plans": plans,
        "weakest_ayahs": [
            {"surah": s, "ayah": a, "mistake_count": int(n)}
            for s, a, n in worst.all()
        ],
    }


# ---------------------------------------------------------------------------
# کارت‌های پیشنهادی (Warm Up / Weakest Link)
# ---------------------------------------------------------------------------

async def suggested_cards(db: AsyncSession, user: User) -> dict:
    """کارت‌های آزمون پیشنهادی — فقط با محفوظاتِ اعلام‌شده + تاریخچهٔ کافی.

    available=false یعنی کارت مخفی بماند یا با برچسب راه‌اندازی
    اولیه نشان داده شود (تصمیم UI)؛ دلیلش در reason می‌آید.
    """
    plans = await list_plans(db, user)
    memorized: set[tuple[int, int]] = set()
    for plan in plans:
        if plan["status"] != "active" or plan["done_ayahs"] == 0:
            continue
        detail = await get_plan(db, user, plan["id"])
        for it in detail["items"]:
            if it["status"] == "done":
                memorized.add((it["surah"], it["ayah"]))
    graded = await db.execute(
        select(func.count())
        .select_from(HifzWordScore)
        .join(HifzAttempt, HifzWordScore.attempt_id == HifzAttempt.id)
        .where(HifzAttempt.user_id == user.id)
    )
    graded_words = int(graded.scalar_one())
    if not memorized:
        return {
            "available": False,
            "reason": "setup_required",
            "detail": "هنوز بازهٔ محفوظات اعلام نشده است؛ اول یک برنامه بسازید و آیه‌های حفظ‌شده را کامل کنید.",
            "cards": [],
        }
    if graded_words < SUGGESTED_MIN_GRADED_WORDS:
        return {
            "available": False,
            "reason": "insufficient_history",
            "detail": f"تاریخچهٔ تمرین هنوز کم است ({graded_words} کلمهٔ ارزیابی‌شده؛ دست‌کم {SUGGESTED_MIN_GRADED_WORDS} لازم است).",
            "cards": [],
        }
    worst = await db.execute(
        select(HifzMistake.surah, HifzMistake.ayah, func.count())
        .where(HifzMistake.user_id == user.id)
        .group_by(HifzMistake.surah, HifzMistake.ayah)
        .order_by(func.count().desc())
        .limit(20)
    )
    cards = []
    for s, a, n in worst.all():
        if (s, a) not in memorized:
            continue
        kind = "weakest_link" if len(cards) == 0 else "warm_up"
        cards.append(
            {
                "surah": s,
                "ayah": a,
                "kind": kind,
                "mistake_count": int(n),
                "reason": "پرخطاترین آیهٔ محفوظات شما",
            }
        )
        if len(cards) >= 5:
            break
    if not cards:
        return {
            "available": False,
            "reason": "no_weak_ayahs",
            "detail": "در بازهٔ محفوظات شما آیهٔ پرخطایی نیست؛ کارت پیشنهادی‌ای نیست.",
            "cards": [],
        }
    return {"available": True, "reason": "ok", "detail": "", "cards": cards}


# ---------------------------------------------------------------------------
# تسمی
# ---------------------------------------------------------------------------

async def create_tasmi_session(
    db: AsyncSession,
    user: User,
    *,
    method: str,
    variant: str = "standard",
    start_surah: int,
    start_ayah: int,
    end_surah: int,
    end_ayah: int,
) -> dict:
    if method not in ("tasmi8", "method_6446", "method_3x3"):
        raise APIError(
            422, "hifz_tasmi_method", "روش باید tasmi8 یا method_6446 یا method_3x3 باشد"
        )
    if (start_surah, start_ayah) > (end_surah, end_ayah):
        raise APIError(422, "hifz_tasmi_range", "شروع بازه باید پیش از پایان آن باشد")
    counts = await _ayah_counts(db)
    ayahs = hifz_plan.plan_ayah_order(
        (start_surah, start_ayah), (end_surah, end_ayah),
        direction="normal", ayah_counts=counts,
    )
    if method == "tasmi8":
        state = hifz_plan.tasmi8_initial_state(variant)
    elif method == "method_6446":
        state = hifz_plan.method_6446_initial_state(ayahs)
    else:
        state = hifz_plan.method_3x3_initial_state(ayahs)
    session = HifzTasmiSession(
        user_id=user.id,
        method=method,
        variant=variant,
        start_surah=start_surah,
        start_ayah=start_ayah,
        end_surah=end_surah,
        end_ayah=end_ayah,
        state=state,
        self_assessed=True,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _tasmi_out(session)


def _tasmi_out(session: HifzTasmiSession) -> dict:
    if session.method == "tasmi8":
        current = hifz_plan.tasmi8_current(session.state or {})
    elif session.method == "method_6446":
        current = hifz_plan.method_6446_current(session.state or {})
    else:
        current = hifz_plan.method_3x3_current(session.state or {})
    return {
        "id": session.id,
        "method": session.method,
        "variant": session.variant,
        "start_surah": session.start_surah,
        "start_ayah": session.start_ayah,
        "end_surah": session.end_surah,
        "end_ayah": session.end_ayah,
        "state": session.state or {},
        "current": current,
        "self_assessed": session.self_assessed,
        "reflection": session.reflection,
        "status": session.status,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "completed_at": session.completed_at,
    }


async def _tasmi_or_404(
    db: AsyncSession, user: User, session_id: UUID
) -> HifzTasmiSession:
    session = await db.get(HifzTasmiSession, session_id)
    if session is None or session.user_id != user.id:
        raise APIError(404, "hifz_tasmi_not_found", "نشست تسمی پیدا نشد")
    return session


async def list_tasmi_sessions(db: AsyncSession, user: User) -> list[dict]:
    rows = await db.execute(
        select(HifzTasmiSession)
        .where(HifzTasmiSession.user_id == user.id)
        .order_by(HifzTasmiSession.updated_at.desc())
        .limit(20)
    )
    return [_tasmi_out(s) for s in rows.scalars().all()]


async def get_tasmi_session(
    db: AsyncSession, user: User, session_id: UUID
) -> dict:
    return _tasmi_out(await _tasmi_or_404(db, user, session_id))


async def advance_tasmi(
    db: AsyncSession,
    user: User,
    session_id: UUID,
    *,
    action: str,
    rating: str | None = None,
    reflection: str | None = None,
) -> dict:
    """پیشرفت نشست تسمی با خودارزیابی کاربر.

    action: tap (یک تکرار در 6446/3x3) | next_stage (تکمیل مرحلهٔ
    tasmi8) | rate (رتبه‌بندی مرور: forgot/hard/good/easy — موعد
    مرور بعدی را می‌سازد) | reflect (فقط ذخیرهٔ بازتاب) |
    pause | resume | complete.
    reflection: بازتاب اختیاریِ مرحلهٔ هشتم (خصوصی).
    """
    session = await _tasmi_or_404(db, user, session_id)
    if session.status == "completed" and action != "complete":
        raise APIError(422, "hifz_tasmi_closed", "این نشست تسمی تکمیل شده است")
    state = dict(session.state or {})
    if action == "tap":
        if session.method == "method_6446":
            state = hifz_plan.method_6446_tap(state)
        elif session.method == "method_3x3":
            state = hifz_plan.method_3x3_tap(state)
        else:
            raise APIError(
                422, "hifz_tasmi_action",
                "روش هشت‌مرحله‌ای tap ندارد؛ از next_stage استفاده کنید",
            )
    elif action == "next_stage":
        if session.method != "tasmi8":
            raise APIError(
                422, "hifz_tasmi_action",
                "next_stage فقط برای روش هشت‌مرحله‌ای است",
            )
        state = hifz_plan.tasmi8_advance(state)
    elif action == "rate":
        if rating is None:
            raise APIError(422, "hifz_tasmi_rating", "رتبه‌بندی مرور لازم است")
        due = hifz_plan.tasmi_review_due_at(rating)
        state["last_rating"] = rating
        state["review_due_at"] = due.isoformat()
    elif action == "reflect":
        pass  # فقط بازتاب ذخیره می‌شود (پایینِ تابع).
    elif action == "pause":
        session.status = "paused"
    elif action == "resume":
        session.status = "active"
    elif action == "complete":
        session.status = "completed"
        session.completed_at = _utcnow()
    else:
        raise APIError(422, "hifz_tasmi_action", "کنش نامعتبر است")
    if reflection is not None:
        session.reflection = reflection[:2000]
    session.state = state
    if state.get("done") and session.status == "active":
        session.status = "completed"
        session.completed_at = _utcnow()
    await db.commit()
    await db.refresh(session)
    return _tasmi_out(session)


async def delete_tasmi_session(db: AsyncSession, user: User, session_id: UUID) -> None:
    await _tasmi_or_404(db, user, session_id)
    await db.execute(
        delete(HifzTasmiSession).where(HifzTasmiSession.id == session_id)
    )
    await db.commit()
