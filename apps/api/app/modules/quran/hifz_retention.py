"""سیاست نگهداری دادهٔ حفظ (P1-4) — پیکربندی‌پذیر، پیش‌فرض خاموش.

کلیدها (`quran.hifz_retention.*` در SETTING_DEFS، بدون مهاجرت و
بدون ری‌استارت — hot-reload): هر کلید یا null است (نامحدود = حذف
خودکار خاموش) یا عدد روز (۱ تا ۳۶۵۰). **پیش‌فرضِ همهٔ کلیدها null
است** — هیچ حذفی بدون تصمیم صریح کاربر روشن نمی‌شود؛ حتی قانونِ
پیشنهادی «آزمون‌های تکمیل‌شده پس از ۳۰ روز» فقط به‌صورت یک قانونِ
پیکربندی‌پذیرِ پیش‌فرض‌خاموش پیاده شده است (تصمیم نهایی با کاربر).

ایمنی‌های سفت:
- فقط ردیف‌های **پایانی** مشمول‌اند (نشست/آزمون/تسمی/برنامهٔ
  `completed`؛ SRS فقط وقتی غیرفعال است). نشستِ `in_progress/paused`،
  برنامهٔ `active` و SRS فعال هرگز با گذر زمان حذف نمی‌شوند.
- ساعت انقضا = جدیدترینِ (`completed_at`، `updated_at`،
  `last_reviewed_at`)، نه `created_at`.
- نمرهٔ کلمه هرگز جدا حذف نمی‌شود (تابع نشست است — حذف جداگانه،
  صف مرور را خراب می‌کند)؛ خطا فقط وقتی جدا حذف می‌شود که نشستش
  تکمیل شده باشد.
- ترجیح‌های کاربر (`hifz_user_settings`) هیچ انقضایی ندارند.
- هر اجرا تعداد حذف‌شده به‌تفکیک جدول را لاگ می‌کند (فقط تعداد،
  هرگز محتوا). حلقهٔ روزانه اول یک دورهٔ dry-run می‌بیند (فقط لاگ
  «چه چیزی حذف می‌شد») و از دورهٔ بعد حذف واقعی می‌کند.

اثر حذف (مستند — Wave-1 §۲٫۳): آزمون‌ها در هیچ آمار/داشبوردی
خوانده نمی‌شوند (اثر صفر)؛ حذف نشست، آمار کل را کم می‌کند ولی
سری روزانه (فقط ۳۰ روز اخیر) را نه؛ حذف SRS منحنی یادگیری را به
صفر برمی‌گرداند و قابل‌بازسازی نیست — پس `reviews_inactive_days`
هرگز نباید بدون تأیید صریح کاربر ست شود.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_settings import get_typed_setting
from app.models.models import (
    HifzAttempt,
    HifzMistake,
    HifzPlan,
    HifzPlanItem,
    HifzReview,
    HifzTasmiSession,
    HifzTest,
    HifzTestQuestion,
    HifzWordScore,
)

logger = logging.getLogger("maturidi.hifz_retention")

RETENTION_KEYS: tuple[str, ...] = (
    "quran.hifz_retention.attempts_days",
    "quran.hifz_retention.mistakes_days",
    "quran.hifz_retention.tests_days",
    "quran.hifz_retention.reviews_inactive_days",
    "quran.hifz_retention.tasmi_days",
    "quran.hifz_retention.plans_days",
)

# پیش‌فرضِ امن: همه null (نامحدود) — هیچ حذف خودکاری روشن نیست.
RETENTION_DEFAULTS: dict[str, int | None] = {key: None for key in RETENTION_KEYS}

RETENTION_INTERVAL_S = 86400  # روزانه — حذف داده حساس است، نه ساعتی


async def get_retention_policy(db: AsyncSession) -> dict[str, int | None]:
    """خواندن سیاست از platform_settings (null = نامحدود)."""
    policy: dict[str, int | None] = {}
    for key in RETENTION_KEYS:
        raw = await get_typed_setting(db, key, None)
        policy[key] = None if raw is None else int(raw)
    return policy


def _cutoff(now: datetime, days: int) -> datetime:
    return now - timedelta(days=days)


async def _ids(db: AsyncSession, stmt) -> list[UUID]:
    return list((await db.execute(stmt)).scalars().all())


async def purge_expired_hifz_data(
    db: AsyncSession,
    *,
    policy: dict[str, int | None] | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> dict[str, int]:
    """حذف ردیف‌های منقضی‌شدهٔ حفظ بر اساس سیاست — یک تراکنش.

    برمی‌گرداند: تعداد حذف‌شده (یا در dry_run، تعدادِ قابل‌حذف)
    به‌تفکیک جدول. در dry_run هیچ نوشتی انجام نمی‌شود.
    """
    now = now or datetime.now(UTC)
    if policy is None:
        policy = await get_retention_policy(db)

    counts: dict[str, int] = {
        "hifz_word_scores": 0,
        "hifz_mistakes": 0,
        "hifz_attempts": 0,
        "hifz_test_questions": 0,
        "hifz_tests": 0,
        "hifz_plan_items": 0,
        "hifz_plans": 0,
        "hifz_reviews": 0,
        "hifz_tasmi_sessions": 0,
    }

    # همهٔ مجموعه‌های کاندید اول محاسبه می‌شوند (بدون هم‌پوشانی)، بعد
    # حذف می‌شوند — تا شمارش‌ها دقیق بمانند.
    expired_attempt_ids: list[UUID] = []
    expired_mistake_ids: list[UUID] = []
    expired_test_ids: list[UUID] = []
    expired_plan_ids: list[UUID] = []
    expired_review_ids: list[UUID] = []
    expired_tasmi_ids: list[UUID] = []
    expired_score_ids: list[UUID] = []
    expired_question_ids: list[UUID] = []
    expired_item_ids: list[UUID] = []

    attempts_days = policy.get("quran.hifz_retention.attempts_days")
    if attempts_days is not None:
        cutoff = _cutoff(now, attempts_days)
        expired_attempt_ids = await _ids(
            db,
            select(HifzAttempt.id).where(
                HifzAttempt.status == "completed",
                func.coalesce(HifzAttempt.completed_at, HifzAttempt.updated_at)
                <= cutoff,
            ),
        )
        if expired_attempt_ids:
            expired_score_ids = await _ids(
                db,
                select(HifzWordScore.id).where(
                    HifzWordScore.attempt_id.in_(expired_attempt_ids)
                ),
            )
            expired_mistake_ids = await _ids(
                db,
                select(HifzMistake.id).where(
                    HifzMistake.attempt_id.in_(expired_attempt_ids)
                ),
            )

    mistakes_days = policy.get("quran.hifz_retention.mistakes_days")
    if mistakes_days is not None:
        cutoff = _cutoff(now, mistakes_days)
        completed_attempt_ids = select(HifzAttempt.id).where(
            HifzAttempt.status == "completed"
        )
        extra = await _ids(
            db,
            select(HifzMistake.id).where(
                HifzMistake.created_at <= cutoff,
                HifzMistake.attempt_id.in_(completed_attempt_ids),
                # خطاهای نشست‌های منقضی، با خودِ نشست حذف می‌شوند
                # (بالا) — این‌جا دوباره شمرده نمی‌شوند. `in_([])`
                # همیشه false است، پس `~in_([])` همیشه true می‌ماند.
                ~HifzMistake.attempt_id.in_(expired_attempt_ids),
            ),
        )
        expired_mistake_ids = expired_mistake_ids + extra

    tests_days = policy.get("quran.hifz_retention.tests_days")
    if tests_days is not None:
        cutoff = _cutoff(now, tests_days)
        expired_test_ids = await _ids(
            db,
            select(HifzTest.id).where(
                HifzTest.status == "completed",
                func.coalesce(HifzTest.completed_at, HifzTest.started_at)
                <= cutoff,
            ),
        )
        if expired_test_ids:
            expired_question_ids = await _ids(
                db,
                select(HifzTestQuestion.id).where(
                    HifzTestQuestion.test_id.in_(expired_test_ids)
                ),
            )

    plans_days = policy.get("quran.hifz_retention.plans_days")
    if plans_days is not None:
        cutoff = _cutoff(now, plans_days)
        expired_plan_ids = await _ids(
            db,
            select(HifzPlan.id).where(
                HifzPlan.status == "completed",
                func.coalesce(HifzPlan.completed_at, HifzPlan.updated_at)
                <= cutoff,
            ),
        )
        if expired_plan_ids:
            expired_item_ids = await _ids(
                db,
                select(HifzPlanItem.id).where(
                    HifzPlanItem.plan_id.in_(expired_plan_ids)
                ),
            )

    reviews_days = policy.get("quran.hifz_retention.reviews_inactive_days")
    if reviews_days is not None:
        cutoff = _cutoff(now, reviews_days)
        expired_review_ids = await _ids(
            db,
            select(HifzReview.id).where(
                func.coalesce(
                    HifzReview.last_reviewed_at,
                    HifzReview.updated_at,
                    HifzReview.created_at,
                )
                <= cutoff
            ),
        )

    tasmi_days = policy.get("quran.hifz_retention.tasmi_days")
    if tasmi_days is not None:
        cutoff = _cutoff(now, tasmi_days)
        expired_tasmi_ids = await _ids(
            db,
            select(HifzTasmiSession.id).where(
                HifzTasmiSession.status == "completed",
                func.coalesce(
                    HifzTasmiSession.completed_at, HifzTasmiSession.updated_at
                )
                <= cutoff,
            ),
        )

    counts["hifz_word_scores"] = len(expired_score_ids)
    counts["hifz_mistakes"] = len(expired_mistake_ids)
    counts["hifz_attempts"] = len(expired_attempt_ids)
    counts["hifz_test_questions"] = len(expired_question_ids)
    counts["hifz_tests"] = len(expired_test_ids)
    counts["hifz_plan_items"] = len(expired_item_ids)
    counts["hifz_plans"] = len(expired_plan_ids)
    counts["hifz_reviews"] = len(expired_review_ids)
    counts["hifz_tasmi_sessions"] = len(expired_tasmi_ids)

    if dry_run:
        logger.info("hifz retention dry-run: would delete %s", counts)
        return counts

    try:
        if expired_score_ids:
            await db.execute(
                delete(HifzWordScore).where(HifzWordScore.id.in_(expired_score_ids))
            )
        if expired_mistake_ids:
            await db.execute(
                delete(HifzMistake).where(HifzMistake.id.in_(expired_mistake_ids))
            )
        if expired_attempt_ids:
            await db.execute(
                delete(HifzAttempt).where(HifzAttempt.id.in_(expired_attempt_ids))
            )
        if expired_question_ids:
            await db.execute(
                delete(HifzTestQuestion).where(
                    HifzTestQuestion.id.in_(expired_question_ids)
                )
            )
        if expired_test_ids:
            await db.execute(
                delete(HifzTest).where(HifzTest.id.in_(expired_test_ids))
            )
        if expired_item_ids:
            await db.execute(
                delete(HifzPlanItem).where(HifzPlanItem.id.in_(expired_item_ids))
            )
        if expired_plan_ids:
            await db.execute(
                delete(HifzPlan).where(HifzPlan.id.in_(expired_plan_ids))
            )
        if expired_review_ids:
            await db.execute(
                delete(HifzReview).where(HifzReview.id.in_(expired_review_ids))
            )
        if expired_tasmi_ids:
            await db.execute(
                delete(HifzTasmiSession).where(
                    HifzTasmiSession.id.in_(expired_tasmi_ids)
                )
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    if any(counts.values()):
        logger.info("hifz retention: deleted %s", counts)
    return counts


async def run_hifz_retention_loop(
    *,
    interval_s: float = RETENTION_INTERVAL_S,
    dry_run_first: bool = True,
) -> None:
    """حلقهٔ پاک‌سازی دوره‌ای نگهداری — از lifespan اپ API اجرا می‌شود.

    روزانه یک‌بار؛ گذر اول فقط dry-run است (لاگ «چه چیزی حذف می‌شد»)
    و از گذر بعد حذف واقعی می‌کند؛ خطا فقط لاگ می‌شود و حلقه را
    نمی‌کشد؛ لغو (CancelledError) دوباره بالا می‌رود تا خاموشیِ اپ،
    تسک را تمام کند. با پیش‌فرضِ همه-null، حذف واقعی هیچ ردیفی را
    نمی‌برد.
    """
    from app.core.database import SessionLocal

    first = True
    while True:
        try:
            await asyncio.sleep(interval_s)
            async with SessionLocal() as db:
                dry = bool(dry_run_first and first)
                counts = await purge_expired_hifz_data(db, dry_run=dry)
                if dry:
                    logger.info(
                        "hifz retention: first pass dry-run done %s", counts
                    )
                elif any(counts.values()):
                    logger.info("hifz retention: purged %s", counts)
            first = False
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("hifz retention loop failed", exc_info=True)
            first = False
