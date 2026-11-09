"""حذف یک‌جای همهٔ دادهٔ حفظ یک کاربر (P1-5) — فقط دامنهٔ hifz_only.

دامنه (۹ جدول + ۱ جدول ترجیح‌ها؛ دقیقاً همان «همهٔ دادهٔ حفظ»):
  hifz_word_scores، hifz_mistakes، hifz_test_questions،
  hifz_plan_items، hifz_attempts، hifz_tests، hifz_plans،
  hifz_reviews (SRS)، hifz_tasmi_sessions، hifz_user_settings.

بیرون از دامنه (هرگز حذف نمی‌شوند): حساب کاربر، نشست‌ها/توکن‌های
ورود، فتوا و اهداها، یادداشت‌های آیه و ذکر (دامنهٔ quran_all — فقط
با تصمیم صریح کاربر ساخته می‌شود و این‌جا نیست)، متن/ترجمه/تفسیر/
قاری‌ها (کاتالوگ مشترک)، تنظیمات پلتفرم، audit logها و domain_eventها.

ایمنی‌ها (همه در این فایل، نه سلیقه‌ای):
1. بدون پارامتر `user_id` در ورودی — فقط کاربرِ احراز هویت‌شدهٔ
   فراخواننده (از توکن)؛ IDOR از اساس ناممکن است.
2. همهٔ حذف‌ها با فیلتر `user_id == current_user.id`؛ فرزندها فقط
   از راه والدِ دارای مالک (attempt_id/test_id/plan_id).
3. ترتیب فرزند→والد (هیچ FK حفاظ `ondelete="CASCADE"` ندارد؛ حذفِ
   والد بدون حذفِ صریح فرزند خطای FK می‌دهد): نمره‌ها → خطاها →
   سؤال‌های آزمون → آیه‌های برنامه → نشست‌ها → آزمون‌ها → برنامه‌ها
   → SRS → تسمی → ترجیح‌ها.
4. تراکنش واحد: همهٔ حذف‌ها + audit در یک session؛ commit فقط در
   پایان؛ هر خطا → rollback کامل (هیچ جدولی نیمه‌حذف نمی‌ماند).
5. حذف‌ها bulk با `delete()`‌اند، نه حلقهٔ ORM و نه صدازدنِ
   endpointهای تکی در حلقه (هر کدام commit جدا می‌کنند و اتمی‌بودن
   را می‌شکنند).
6. پیش از حذف، اسلات‌های اتصال زندهٔ کاربر از limiter آزاد می‌شوند
   (best-effort؛ هرگز purge را نمی‌شکند) تا نشستِ زندهٔ در حال اجرا
   پس از حذف روی نشستِ حذف‌شده نمره ننویسد.
7. Audit با تعداد فقط (`hifz.data_purged`): هرگز heard،
   expected_text، reflection، عنوان برنامه یا note_text — به‌علاوه
   یک domain event با payload خالی. خودِ audit/domain-event حذف
   نمی‌شوند.
8. Idempotent به‌صورت طبیعی: فراخوانیِ دوباره (با همان
   idempotency_key یا بدون آن) روی دادهٔ خالی صفر برمی‌گرداند، نه خطا.

یافته‌های جانبی (مستند، بدون تغییرِ بی‌سروصدا):
- `delete_account` دادهٔ حفظ را پاک نمی‌کند (فقط ناشناس می‌کند)؛
  پیوند purge با حذف حساب، تصمیم کاربر را می‌خواهد (بند ۳٫۶ طراحی
  Wave-1) و این‌جا انجام نشده است.
- خروجی GDPR (`export_data`) دادهٔ حفظ را پوشش نمی‌دهد؛ به‌روزرسانیِ
  آن بیرون از دامنهٔ این فایل است.
"""
from __future__ import annotations

import logging
from typing import Any, cast
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import (
    HifzAttempt,
    HifzMistake,
    HifzPlan,
    HifzPlanItem,
    HifzReview,
    HifzTasmiSession,
    HifzTest,
    HifzTestQuestion,
    HifzUserSettings,
    HifzWordScore,
    User,
)

logger = logging.getLogger("maturidi.hifz_purge")

# تنها دامنهٔ پیاده‌شده. quran_all (یادداشت/ذکر) تصمیم کاربر را می‌خواهد.
PURGE_SCOPE = "hifz_only"

# ترتیب شمارش/حذف (فرزند→والد) — کلیدها نام جدول‌اند.
PURGE_TABLES: tuple[str, ...] = (
    "hifz_word_scores",
    "hifz_mistakes",
    "hifz_test_questions",
    "hifz_plan_items",
    "hifz_attempts",
    "hifz_tests",
    "hifz_plans",
    "hifz_reviews",
    "hifz_tasmi_sessions",
    "hifz_user_settings",
)


def _attempt_ids_subquery(user_id: UUID):
    return select(HifzAttempt.id).where(HifzAttempt.user_id == user_id)


def _test_ids_subquery(user_id: UUID):
    return select(HifzTest.id).where(HifzTest.user_id == user_id)


def _plan_ids_subquery(user_id: UUID):
    return select(HifzPlan.id).where(HifzPlan.user_id == user_id)


async def preview_hifz_data_counts(db: AsyncSession, user_id: UUID) -> dict[str, int]:
    """تعداد ردیف‌های حفظ کاربر به‌تفکیک جدول — فقط شمارش، بدون محتوا.

    همان فیلترهای مالکیتِ purge به کار می‌روند، پس عدد پیش‌نمایش با
    عدد واقعی برابر است مگر داده بین دو فراخوانی عوض شده باشد.
    """
    attempt_ids = _attempt_ids_subquery(user_id)
    test_ids = _test_ids_subquery(user_id)
    plan_ids = _plan_ids_subquery(user_id)
    queries = {
        "hifz_word_scores": select(func.count()).select_from(HifzWordScore).where(
            HifzWordScore.attempt_id.in_(attempt_ids)
        ),
        "hifz_mistakes": select(func.count()).select_from(HifzMistake).where(
            HifzMistake.user_id == user_id
        ),
        "hifz_test_questions": select(func.count())
        .select_from(HifzTestQuestion)
        .where(HifzTestQuestion.test_id.in_(test_ids)),
        "hifz_plan_items": select(func.count())
        .select_from(HifzPlanItem)
        .where(HifzPlanItem.plan_id.in_(plan_ids)),
        "hifz_attempts": select(func.count())
        .select_from(HifzAttempt)
        .where(HifzAttempt.user_id == user_id),
        "hifz_tests": select(func.count())
        .select_from(HifzTest)
        .where(HifzTest.user_id == user_id),
        "hifz_plans": select(func.count())
        .select_from(HifzPlan)
        .where(HifzPlan.user_id == user_id),
        "hifz_reviews": select(func.count())
        .select_from(HifzReview)
        .where(HifzReview.user_id == user_id),
        "hifz_tasmi_sessions": select(func.count())
        .select_from(HifzTasmiSession)
        .where(HifzTasmiSession.user_id == user_id),
        "hifz_user_settings": select(func.count())
        .select_from(HifzUserSettings)
        .where(HifzUserSettings.user_id == user_id),
    }
    counts: dict[str, int] = {}
    for table in PURGE_TABLES:
        counts[table] = int((await db.execute(queries[table])).scalar_one())
    return counts


async def _release_live_slots(user_id: UUID) -> None:
    """آزادسازی اسلات‌های اتصال زندهٔ کاربر — best-effort."""
    try:
        from app.core.hifz_live_limiter import get_live_stream_limiter

        n = await get_live_stream_limiter().release_all_for_user(user_id)
        if n:
            logger.info("hifz purge: released %s live slots for user=%s", n, user_id)
    except Exception:
        logger.warning("hifz purge: live-slot release failed", exc_info=True)


async def purge_hifz_data(
    db: AsyncSession, user: User, *, idempotency_key: str
) -> dict[str, int]:
    """حذف یک‌جای همهٔ دادهٔ حفظ کاربر — یک تراکنش، برگشت‌ناپذیر.

    برمی‌گرداند: تعداد حذف‌شده به‌تفکیک جدول (همان ترتیب PURGE_TABLES).
    هر خطا → rollback کامل + استثنا به فراخواننده می‌رسد.
    """
    try:
        UUID(idempotency_key)
    except (ValueError, AttributeError, TypeError):
        raise APIError(
            422, "hifz_purge_bad_idempotency_key", "idempotency_key باید UUID معتبر باشد"
        ) from None

    user_id = user.id
    attempt_ids = _attempt_ids_subquery(user_id)
    test_ids = _test_ids_subquery(user_id)
    plan_ids = _plan_ids_subquery(user_id)

    deleted: dict[str, int] = {}
    try:
        # اسلات زنده اول آزاد می‌شود تا اتصالِ در حال اجرا پس از حذف،
        # روی نشستِ حذف‌شده نمره ننویسد (best-effort).
        await _release_live_slots(user_id)

        # ۱–۴. فرزندها (از راه والدِ دارای مالک).
        res = cast(
            CursorResult[Any],
            await db.execute(
                delete(HifzWordScore).where(HifzWordScore.attempt_id.in_(attempt_ids))
            ),
        )
        deleted["hifz_word_scores"] = int(res.rowcount or 0)
        # خطا دو FK دارد (attempt_id + user_id)؛ مرحلهٔ دوم با user_id
        # هر ردیفِ مانده (در عمل نباید باشد) را پوشش می‌دهد.
        res = cast(
            CursorResult[Any],
            await db.execute(
                delete(HifzMistake).where(HifzMistake.attempt_id.in_(attempt_ids))
            ),
        )
        n_mistakes = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(delete(HifzMistake).where(HifzMistake.user_id == user_id)),
        )
        deleted["hifz_mistakes"] = n_mistakes + int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(
                delete(HifzTestQuestion).where(HifzTestQuestion.test_id.in_(test_ids))
            ),
        )
        deleted["hifz_test_questions"] = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(
                delete(HifzPlanItem).where(HifzPlanItem.plan_id.in_(plan_ids))
            ),
        )
        deleted["hifz_plan_items"] = int(res.rowcount or 0)

        # ۵–۱۰. والدها.
        res = cast(
            CursorResult[Any],
            await db.execute(delete(HifzAttempt).where(HifzAttempt.user_id == user_id)),
        )
        deleted["hifz_attempts"] = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(delete(HifzTest).where(HifzTest.user_id == user_id)),
        )
        deleted["hifz_tests"] = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(delete(HifzPlan).where(HifzPlan.user_id == user_id)),
        )
        deleted["hifz_plans"] = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(delete(HifzReview).where(HifzReview.user_id == user_id)),
        )
        deleted["hifz_reviews"] = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(
                delete(HifzTasmiSession).where(HifzTasmiSession.user_id == user_id)
            ),
        )
        deleted["hifz_tasmi_sessions"] = int(res.rowcount or 0)
        res = cast(
            CursorResult[Any],
            await db.execute(
                delete(HifzUserSettings).where(HifzUserSettings.user_id == user_id)
            ),
        )
        deleted["hifz_user_settings"] = int(res.rowcount or 0)

        # Audit فقط با تعداد — هرگز محتوای کاربر. خودِ audit و
        # domain-event حذف نمی‌شوند (پاسخ‌گویی).
        await log_audit(
            db,
            actor_id=user_id,
            actor_type="user",
            action="hifz.data_purged",
            entity_type="user",
            entity_id=str(user_id),
            new_values={
                "scope": PURGE_SCOPE,
                "deleted_counts": deleted,
                "idempotency_key": idempotency_key,
            },
        )
        await emit_event(
            db,
            aggregate_type="user",
            aggregate_id=str(user_id),
            event_type="user.hifz_data_purged",
            payload={"scope": PURGE_SCOPE},
            # توجه: idempotency_keyِ درخواست این‌جا به رویداد داده
            # نمی‌شود — `domain_events.idempotency_key` یکتاست و
            # فراخوانیِ دوبارهٔ purge با همان کلید، درجِ دوم را با
            # خطای یکتایی می‌شکست؛ purge در سطح داده idempotent است
            # (دومین بار صفر برمی‌گرداند) و کلید در audit ثبت می‌شود.
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    logger.info(
        "hifz purge: user=%s scope=%s deleted=%s",
        user_id,
        PURGE_SCOPE,
        deleted,
    )
    return {table: deleted.get(table, 0) for table in PURGE_TABLES}
