"""روتر مرکز اعلان چندکاناله — فاز ۱۴. مجوز: `notifications.broadcast`."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.admin import notify_service as svc
from app.modules.admin.control_schemas import (
    BroadcastIn,
    BroadcastOut,
)
from app.modules.auth.dependencies import require_permission

router = APIRouter(prefix="/api/v1/admin/notifications", tags=["admin-notifications"])
_perm = require_permission("notifications.broadcast")


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.post("/broadcast", response_model=BroadcastOut)
async def post_broadcast(
    data: BroadcastIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """پخش گروهی چندکاناله — کانال هر کاربر از `notification_preferences` او.

    کانال پیکربندی‌نشده → skipped صادقانه، نه موفقیت جعلی.
    """
    ip, ua = _client(request)
    return await svc.create_broadcast(
        db, actor=user, title=data.title, body=data.body,
        cohort=data.cohort, channels=data.channels, ip=ip, user_agent=ua,
    )


@router.get("/broadcasts", response_model=list[BroadcastOut])
async def get_broadcasts(
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_broadcasts(db, limit=limit)


@router.get("/broadcasts/{broadcast_id}", response_model=BroadcastOut)
async def get_broadcast(
    broadcast_id: uuid.UUID,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """جزئیات یک پخش + لاگ تحویل per-user/per-channel."""
    return await svc.get_broadcast(db, broadcast_id)


@router.get("/delivery-stats", response_model=dict)
async def get_delivery_stats(
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """آمار تحویل به‌تفکیک کانال/وضعیت — داشبورد مرکز اعلان."""
    stats = await svc.delivery_stats(db)
    return {"stats": stats}


@router.get("/channels", response_model=dict)
async def get_channels(
    user: User = Depends(_perm),
):
    """کانال‌های پشتیبانی‌شده + وضعیت پیکربندی provider هرکدام."""
    return {
        "channels": [
            {"key": ch, "configured": svc.CHANNEL_CONFIGURED[ch]()}
            for ch in svc.CHANNELS
        ]
    }


@router.post("/preview", response_model=dict)
async def post_broadcast_preview(
    data: BroadcastIn,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """پیش‌نمایش پخش — تعداد گیرندگان و تفکیک کانال، بدون ارسال واقعی."""
    users = await svc.resolve_cohort_preview(db, cohort=data.cohort)
    per_channel: dict[str, int] = {}
    for u in users:
        for ch in await svc.effective_channels(db, u, data.channels):
            per_channel[ch] = per_channel.get(ch, 0) + 1
    return {
        "recipients": len(users),
        "per_channel": per_channel,
        "channels_requested": data.channels,
        "dry_run": True,
    }
