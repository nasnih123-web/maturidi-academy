"""روتر ادمین — فقط دارندگان مجوز platform.settings (عملاً super_admin).

فاز ۰ §۱۵ قانون ۶: روتر فقط سیم‌کشی است؛ منطق در service.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import require_permission
from app.modules.admin import service
from app.modules.admin.schemas import (
    DeadLetterPage,
    MessageOut,
    SettingsOut,
    SettingsUpdate,
    SettingsUpdateOut,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.get("/settings", response_model=SettingsOut)
async def get_settings(
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """خواندن تنظیمات پلتفرم — مقادیر حساس mask شده برمی‌گردند."""
    return await service.list_settings(db)


@router.put("/settings", response_model=SettingsUpdateOut)
async def put_settings(
    data: SettingsUpdate,
    request: Request,
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """به‌روزرسانی تنظیمات — بدون نیاز به ری‌استارت (hot-reload، نسخه بالا می‌رود)."""
    ip, ua = _client(request)
    return await service.update_settings(db, user, data.settings, ip, ua)


@router.get("/events/dead-letter", response_model=DeadLetterPage)
async def get_dead_letter(
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """رویدادهای dead-letter (بعد از ۵ شکست dispatch)."""
    return await service.list_dead_letter(db, limit)


@router.post("/events/dead-letter/{event_id}/retry", response_model=MessageOut)
async def retry_dead_letter_event(
    event_id: uuid.UUID,
    request: Request,
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """بازگرداندن یک رویداد dead-letter به چرخهٔ dispatch."""
    ip, ua = _client(request)
    event = await service.retry_dead_letter(db, user, event_id, ip, ua)
    return MessageOut(message=f"رویداد {event.event_id} به چرخهٔ پردازش برگشت")
