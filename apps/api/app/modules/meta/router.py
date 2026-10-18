"""روتر متا — تم فعال و تشخیص زبان (فاز ۱)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Theme

router = APIRouter(prefix="/api/v1", tags=["meta"])

_DEFAULT_THEME = {"fa": "پیش‌فرض", "ar": "الافتراضي", "en": "Default"}


@router.get("/themes/active")
async def themes_active(db: AsyncSession = Depends(get_db)):
    theme = (
        await db.execute(select(Theme).where(Theme.is_active.is_(True)))
    ).scalar_one_or_none()
    if not theme:
        return {"name": _DEFAULT_THEME, "is_active": True}
    return {"id": str(theme.id), "name": theme.name, "is_active": True}


@router.get("/i18n/detect")
async def i18n_detect(request: Request):
    accept = request.headers.get("accept-language", "")
    locale = "fa"
    for part in accept.split(","):
        lang = part.split(";")[0].strip().lower()
        if lang.startswith("ar"):
            locale = "ar"
            break
        if lang.startswith("en"):
            locale = "en"
            break
        if lang.startswith("fa"):
            locale = "fa"
            break
    return {"locale": locale}
