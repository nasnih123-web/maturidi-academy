"""روتر متا — تم فعال و تشخیص زبان (فاز ۱). تنظیمات عمومی سایت (polish)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.platform_settings import get_settings_version, get_typed_setting
from app.models.models import Theme

router = APIRouter(prefix="/api/v1", tags=["meta"])

_DEFAULT_THEME = {"fa": "پیش‌فرض", "ar": "الافتراضي", "en": "Default"}

# کلیدهای عمومی — فقط همین‌ها بدون احراز هویت خوانده می‌شوند (polish #3/#7).
_PUBLIC_SETTING_KEYS = (
    "particles",
    "fonts.fa",
    "fonts.ar",
    "fonts.en",
    "hero.fa",
    "hero.ar",
    "hero.en",
    "home.sections",
)

_PUBLIC_DEFAULTS: dict[str, object] = {
    "particles": {"enabled": True, "count": 100, "speed": 1.0, "parallax": 1.0, "lines": True},
    "fonts.fa": None,
    "fonts.ar": None,
    "fonts.en": None,
    "hero.fa": None,
    "hero.ar": None,
    "hero.en": None,
    "home.sections": [],
}


@router.get("/themes/active")
async def themes_active(db: AsyncSession = Depends(get_db)):
    theme = (
        await db.execute(select(Theme).where(Theme.is_active.is_(True)))
    ).scalar_one_or_none()
    if not theme:
        return {"name": _DEFAULT_THEME, "is_active": True}
    return {"id": str(theme.id), "name": theme.name, "is_active": True}


@router.get("/settings/public")
async def settings_public(db: AsyncSession = Depends(get_db)):
    """تنظیمات عمومی سایت — بدون احراز هویت، فقط کلیدهای سفیدلیست‌شده.

    وب (SSR) این را در هر ریکوئست می‌خواند (cache: no-store) تا تغییرات
    CRM بلافاصله روی سایت اعمال شود (polish #3).
    """
    settings = {}
    for key in _PUBLIC_SETTING_KEYS:
        settings[key] = await get_typed_setting(db, key, _PUBLIC_DEFAULTS[key])
    return {"settings": settings, "version": get_settings_version()}


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
