"""روتر عمومی ویجت‌ها — فاز ۱۱.

- بدون احراز هویت کاربری؛ احراز هویت فقط با هدر X-API-Key یا توکن embed امضاشده (?embed_token=).
- Pass 4 / A5: کلید خام در query string احراز هویت نمی‌کند.
- CORS wildcard فقط همین‌جا (WidgetCorsMiddleware) — بدون credential/cookie.
- هر ویجت scope خودش را می‌خواهد.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.api_keys import service as api_keys_service

from . import schemas, service

widgets_router = APIRouter(prefix="/api/v1/widgets", tags=["widgets"])


async def _require_key(
    request: Request, db: AsyncSession, scope: str, embed_token: str | None
):
    raw = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if raw:
        return await api_keys_service.validate_key(db, raw, scope=scope)
    # هدر نبود → فقط توکن embed؛ پارامتر api_key قدیمی عمداً خوانده
    # نمی‌شود (حتی اگر در URL باشد، احراز هویت نمی‌کند).
    return await api_keys_service.validate_embed_token(db, embed_token, scope=scope)


@widgets_router.get("/prayer-times", response_model=schemas.PrayerTimesOut)
async def prayer_times(
    request: Request,
    db: AsyncSession = Depends(get_db),
    embed_token: str | None = Query(default=None),
    lat: float = Query(...),
    lng: float = Query(...),
    method: str = Query(default="mwl"),
    madhab: str = Query(default="shafi"),
    tz: float = Query(default=3.5, ge=-12, le=14),
):
    await _require_key(request, db, "prayer-times", embed_token)
    return await service.prayer_times_widget(
        lat=lat, lng=lng, method=method, madhab=madhab, tz=tz
    )


@widgets_router.get("/ayah-of-day", response_model=schemas.AyahOfDayOut)
async def ayah_of_day(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    embed_token: str | None = Query(default=None),
):
    await _require_key(request, db, "ayah-of-day", embed_token)
    result = await service.ayah_of_day(db)
    # C-06/F1: پاسخ روزانه است — کلاینت‌ها/CDN یک ساعت کش کنند تا
    # رندرهای تکراری به سرور نرسند (سمت سرور هم کش روزانه دارد).
    response.headers["Cache-Control"] = "public, max-age=3600"
    return result


@widgets_router.get("/latest-fatwa", response_model=schemas.LatestFatwaOut)
async def latest_fatwa(
    request: Request,
    db: AsyncSession = Depends(get_db),
    embed_token: str | None = Query(default=None),
):
    await _require_key(request, db, "latest-fatwa", embed_token)
    return await service.latest_fatwa(db)


@widgets_router.get("/zakat-mini", response_model=schemas.ZakatMiniOut)
async def zakat_mini(
    request: Request,
    db: AsyncSession = Depends(get_db),
    embed_token: str | None = Query(default=None),
    amount: str = Query(...),
):
    await _require_key(request, db, "zakat-mini", embed_token)
    return await service.zakat_mini(db, amount=amount)
