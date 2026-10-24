"""روتر ادمین — فقط دارندگان مجوز platform.settings (عملاً super_admin).

فاز ۰ §۱۵ قانون ۶: روتر فقط سیم‌کشی است؛ منطق در service.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.storage import read_capped_upload
from app.models.models import User
from app.modules.admin import service
from app.modules.admin.schemas import (
    DeadLetterPage,
    FontOut,
    MessageOut,
    SettingsOut,
    SettingsUpdate,
    SettingsUpdateOut,
)
from app.modules.auth.dependencies import require_permission

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


@router.post("/settings/reencrypt")
async def post_reencrypt_secrets(
    request: Request,
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """M-05: چرخش تدریجی envelopeهای ذخیره‌شده به نسخهٔ جاری کلید.

    پاسخ فقط شمارنده‌هاست (چند setting/totp مهاجرت کردند) — هیچ
    مقدار یا کلیدی برنمی‌گردد.
    """
    ip, ua = _client(request)
    return await service.reencrypt_secrets(db, user, ip, ua)


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


@router.post("/fonts", response_model=FontOut, status_code=201)
async def upload_font(
    request: Request,
    locale: str = Form(...),
    family: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """آپلود فونت سفارشی یک لوکیل (woff2/woff/ttf، حداکثر ۵MB، magic-byte چک می‌شود).

    موفق: fonts.<locale> = {family, url} و فایل زیر /static/fonts/<locale>/ سرو می‌شود.
    """
    ip, ua = _client(request)
    content = await read_capped_upload(
        file,
        service.FONT_MAX_BYTES,
        too_large_code="font_too_large",
        too_large_message="حجم فونت نباید بیش از ۵ مگابایت باشد",
    )
    return await service.upload_font(db, user, locale, family, content, file.filename, ip, ua)


@router.delete("/fonts/{locale}", response_model=FontOut)
async def delete_font(
    locale: str,
    request: Request,
    user: User = Depends(require_permission("platform.settings")),
    db: AsyncSession = Depends(get_db),
):
    """حذف فونت سفارشی یک لوکیل — بازگشت به فونت داخلی (fonts.<locale> = null)."""
    ip, ua = _client(request)
    return await service.delete_font(db, user, locale, ip, ua)


@router.get("/sync/devices")
async def admin_list_sync_devices(
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(require_permission("sync.manage")),
    db: AsyncSession = Depends(get_db),
):
    """همهٔ دستگاه‌ها با آخرین کرسر — داشبورد sync در CRM (فاز ۱۳)."""
    from app.modules.sync import service as sync_service

    rows = await sync_service.list_devices(db, None, limit=limit)
    return {"devices": rows}
