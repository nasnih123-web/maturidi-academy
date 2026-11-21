"""سرویس «ذخیرهٔ فتوا» — نشانک کاربر روی فتواهای منتشرشده.

قراردادها (هم‌الگوی ذخیرهٔ ویدیو در modules/videos):
- فتوا در نمای عمومی همان FiqhTopic با workflow_status=published است؛
  ذخیره فقط برای موضوعی ممکن است که کاربر همین حالا هم می‌تواند ببیند —
  موضوع غایب یا منتشرنشده ۴۰۴ است (عدم افشا، مثل topic_public_get).
- بررسی انتشار، view_count را زیاد نمی‌کند (ذخیره بازدید نیست).
- فهرست ذخیره‌ها تازه‌ترین ذخیره اول است و موضوع‌هایی که دیگر منتشر
  نیستند بی‌صدا کنار گذاشته می‌شوند.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import FiqhTopic, User, UserSavedFatwa

from . import service


async def _get_published_topic_or_404(
    db: AsyncSession, fatwa_id: UUID
) -> FiqhTopic:
    """موضوع باید وجود داشته باشد و منتشرشده باشد — وگرنه ۴۰۴.

    عمداً از topic_public_get استفاده نمی‌شود: آن تابع بازدید می‌شمارد
    و ذخیره‌کردن نباید view_count را بالا ببرد.
    """
    topic = await db.get(FiqhTopic, fatwa_id)
    if topic is None or topic.workflow_status != "published":
        raise APIError(404, "topic_not_found", "موضوع یافت نشد")
    return topic


async def _find_saved(
    db: AsyncSession, user: User, fatwa_id: UUID
) -> UserSavedFatwa | None:
    stmt = select(UserSavedFatwa).where(
        UserSavedFatwa.user_id == user.id,
        UserSavedFatwa.fatwa_id == fatwa_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_saved_state(
    db: AsyncSession, user: User | None, fatwa_id: UUID
) -> dict:
    """وضعیت نشانک کاربر جاری؛ مهمان همیشه False (بدون خطا)."""
    if user is None:
        return {"fatwa_id": fatwa_id, "saved": False}
    row = await _find_saved(db, user, fatwa_id)
    return {"fatwa_id": fatwa_id, "saved": row is not None}


async def save_fatwa(db: AsyncSession, user: User, fatwa_id: UUID) -> dict:
    """ذخیرهٔ فتوا برای کاربر جاری — idempotent (ذخیرهٔ دوباره خطا نیست)."""
    await _get_published_topic_or_404(db, fatwa_id)
    if await _find_saved(db, user, fatwa_id) is None:
        db.add(UserSavedFatwa(user_id=user.id, fatwa_id=fatwa_id))
        await db.commit()
    return {"fatwa_id": fatwa_id, "saved": True}


async def unsave_fatwa(db: AsyncSession, user: User, fatwa_id: UUID) -> dict:
    """حذف نشانک کاربر جاری — idempotent (نبود ردیف خطا نیست)."""
    await _get_published_topic_or_404(db, fatwa_id)
    row = await _find_saved(db, user, fatwa_id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return {"fatwa_id": fatwa_id, "saved": False}


async def list_saved_fatwas(db: AsyncSession, user: User) -> list[dict]:
    """فتواهای ذخیره‌شدهٔ کاربر جاری، تازه‌ترین ذخیره اول.

    خروجی همان شکل ردیف فهرست عمومی است (_public_topic_dict) تا وب هر
    دو فهرست را با یک کارت رندر کند.
    """
    stmt = (
        select(UserSavedFatwa.fatwa_id)
        .where(UserSavedFatwa.user_id == user.id)
        .order_by(UserSavedFatwa.created_at.desc(), UserSavedFatwa.id.desc())
    )
    ids = list((await db.execute(stmt)).scalars().all())
    if not ids:
        return []
    rows = (
        await db.execute(
            select(FiqhTopic).where(
                FiqhTopic.id.in_(ids),
                FiqhTopic.workflow_status == "published",
            )
        )
    ).scalars().all()
    visible = {t.id: t for t in rows}
    ordered = [visible[i] for i in ids if i in visible]
    cats = await service._load_categories(db, ordered)
    return [service._public_topic_dict(t, cats) for t in ordered]
