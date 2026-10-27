"""روتر ادمین خانه — نوشتن دادهٔ بخش‌های صفحهٔ اصلی.

فاز ۰ §۱۵ قانون ۶: روتر فقط سیم‌کشی است؛ منطق در service.py.
دسترسی: دارندگان مجوز platform.settings (عملاً super_admin) — همان مجوزی
که ذخیرهٔ تنظیمات Appearance در CRM با آن انجام می‌شود.

این endpoint همان خلأیی را پر می‌کند که در کامنت CRM به
`PATCH /api/v1/admin/home/sections` ارجاع داده شده بود ولی در API وجود
نداشت: تا پیش از این هیچ مسیر ادمینی برای نوشتن `HomeSection.data` نبود
و به همین دلیل محتوای نمونه نمی‌توانست روی اسلات‌های صفحهٔ اصلی بنشیند.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import require_permission
from app.modules.home import service
from app.modules.home.schemas import SectionDataOut, SectionDataUpdate

router = APIRouter(prefix="/api/v1/admin/home", tags=["admin-home"])


@router.put("/sections/{key}/data", response_model=SectionDataOut)
async def put_section_data(
    key: str,
    payload: SectionDataUpdate,
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """جایگزینی کامل دادهٔ یک بخش خانه (data.items + layout اختیاری،
    یا برای بخش footer: data.columns + data.brand اختیاری).

    فقط ستون data نوشته می‌شود؛ key/sort_order/visible/title/subtitle
    دست نمی‌خورند. کلید ناموجود → 404؛ بیش از ۱۲ آیتم، عنوان خالی یا
    پیوند ناامن → 422 (اعتبارسنجی Pydantic).
    """
    items = (
        [item.model_dump(exclude_none=True) for item in payload.items]
        if payload.items is not None
        else None
    )
    columns = (
        [col.model_dump(exclude_none=True) for col in payload.columns]
        if payload.columns is not None
        else None
    )
    brand = (
        payload.brand.model_dump(exclude_none=True)
        if payload.brand is not None
        else None
    )
    return await service.set_section_data(db, key, items, payload.layout, columns, brand)
