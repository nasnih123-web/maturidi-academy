"""روتر Content Control Center — فاز ۲ (قرارداد §۹.۵).

فقط سیم‌کشی؛ منطق در service.py. خواندن نیازمند احراز هویت است.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.models.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.content import service

router = APIRouter(prefix="/api/v1/content", tags=["content"])


class ItemsOut(BaseModel):
    items: list[dict[str, Any]]
    total: int


@router.get("/items", response_model=ItemsOut)
async def list_items(
    type: str | None = Query(default=None, description="نوع محتوا (کلید adapter)"),
    module: str | None = Query(default=None),
    status: str | None = Query(default=None, description="وضعیت گردش‌کار §۹"),
    owner: str | None = Query(default=None, description="شناسهٔ مالک/ایجادکننده"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    q: str | None = Query(default=None, description="جست‌وجو در عنوان"),
    user: User = Depends(get_current_user),
):
    """جست‌وجو و فیلتر سراسری محتوا روی همهٔ adapterهای ثبت‌شده."""
    filters = {
        "type": type,
        "module": module,
        "status": status,
        "owner": owner,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "q": q,
    }
    items = await service.list_content(filters)
    return ItemsOut(items=items, total=len(items))


@router.get("/items/{content_type}/{item_id}/preview")
async def get_preview(
    content_type: str,
    item_id: str,
    user: User = Depends(get_current_user),
):
    """پیش‌نمایش محتوا قبل از انتشار."""
    return await service.preview_content(content_type, item_id)


@router.get("/policies/{content_type}/{item_id}")
async def get_policies(
    content_type: str,
    item_id: str,
    user: User = Depends(get_current_user),
):
    """سیاست‌های AI / توزیع / زمان‌بندی / placement یک محتوا (§۹.۵)."""
    return await service.content_policies(content_type, item_id)
