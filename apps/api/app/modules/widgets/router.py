"""روتر عمومی ویجت‌ها — فاز ۱۱.

- بدون احراز هویت کاربری؛ احراز هویت با کلید API (هدر X-API-Key یا ?api_key=).
- CORS wildcard فقط همین‌جا (WidgetCorsMiddleware) — بدون credential/cookie.
- هر ویجت scope خودش را می‌خواهد.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.api_keys import service as api_keys_service

from . import schemas, service

widgets_router = APIRouter(prefix="/api/v1/widgets", tags=["widgets"])


async def _require_key(request: Request, db: AsyncSession, scope: str, api_key: str | None):
    raw = request.headers.get("x-api-key") or request.headers.get("X-API-Key") or api_key
    return await api_keys_service.validate_key(db, raw, scope=scope)


@widgets_router.get("/prayer-times", response_model=schemas.PrayerTimesOut)
async def prayer_times(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: str | None = Query(default=None),
    lat: float = Query(...),
    lng: float = Query(...),
    method: str = Query(default="mwl"),
    madhab: str = Query(default="shafi"),
    tz: float = Query(default=3.5, ge=-12, le=14),
):
    await _require_key(request, db, "prayer-times", api_key)
    return await service.prayer_times_widget(
        lat=lat, lng=lng, method=method, madhab=madhab, tz=tz
    )


@widgets_router.get("/ayah-of-day", response_model=schemas.AyahOfDayOut)
async def ayah_of_day(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: str | None = Query(default=None),
):
    await _require_key(request, db, "ayah-of-day", api_key)
    return await service.ayah_of_day(db)


@widgets_router.get("/latest-fatwa", response_model=schemas.LatestFatwaOut)
async def latest_fatwa(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: str | None = Query(default=None),
):
    await _require_key(request, db, "latest-fatwa", api_key)
    return await service.latest_fatwa(db)


@widgets_router.get("/zakat-mini", response_model=schemas.ZakatMiniOut)
async def zakat_mini(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: str | None = Query(default=None),
    amount: str = Query(...),
):
    await _require_key(request, db, "zakat-mini", api_key)
    return await service.zakat_mini(db, amount=amount)
