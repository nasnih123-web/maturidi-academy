"""روتر sync — موتور همگام‌سازی آفلاین (فاز ۱۳، ADR-0010).

فقط سیم‌کشی؛ منطق در service.py (§۱۵.۶). همهٔ endpointها نیازمند احراز هویت‌اند
و داده همیشه owner-scoped است (حریم خصوصی یادداشت‌ها/پیشرفت).
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import get_current_user

from . import service
from .schemas import (
    ChangeOut,
    ConflictListOut,
    ConflictOut,
    CursorOut,
    DeviceListOut,
    DeviceOut,
    OfflinePackItem,
    OfflinePackOut,
    OpResultOut,
    PullOut,
    PushBatchIn,
    PushBatchOut,
    ResolveConflictIn,
    ResolveConflictOut,
)

sync_router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@sync_router.post("/push", response_model=PushBatchOut)
async def push_batch(
    body: PushBatchIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """دریافت batch عملیات آفلاین یک دستگاه.

    idempotent روی client_op_id: بازپخش همان batch دقیقاً همان نتیجه را
    می‌دهد بدون اعمال دوباره. ترتیب ops همان ترتیب ارسال است.
    """
    results = await service.push_batch(
        db, user,
        device_id=body.device_id,
        ops=[op.model_dump() for op in body.ops],
    )
    return PushBatchOut(
        device_id=body.device_id,
        results=[OpResultOut(**r) for r in results],
    )


@sync_router.get("/pull", response_model=PullOut)
async def pull_changes(
    cursor: int = Query(default=0, ge=0, description="کرسر قبلی دستگاه"),
    device_id: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """فقط تغییرات بعد از cursor — شامل upsertها و tombstoneهای حذف."""
    changes, new_cursor = await service.pull_changes(
        db, user, device_id=device_id, cursor=cursor, limit=limit,
    )
    return PullOut(
        device_id=device_id,
        changes=[ChangeOut(**c) for c in changes],
        new_cursor=new_cursor,
    )


@sync_router.get("/cursor", response_model=CursorOut)
async def get_cursor(
    device_id: str = Query(..., min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """کرسر فعلی pull برای این دستگاه."""
    seq = await service.get_cursor(db, user, device_id)
    return CursorOut(device_id=device_id, cursor_seq=seq)


@sync_router.get("/devices", response_model=DeviceListOut)
async def list_my_devices(
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """دستگاه‌های همین کاربر با آخرین کرسر — owner-scoped."""
    rows = await service.list_devices(db, user, limit=limit)
    return DeviceListOut(
        items=[DeviceOut(**r) for r in rows],
        total=len(rows),
    )


@sync_router.get("/conflicts", response_model=ConflictListOut)
async def list_conflicts(
    only_pending: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """تعارض‌های نسخه‌ای کاربر — هر دو نسخه نگه‌داری می‌شود."""
    rows, total = await service.list_conflicts(
        db, user, only_pending=only_pending, limit=limit,
    )
    return ConflictListOut(
        items=[
            ConflictOut(
                id=r.id, entity_type=r.entity_type, entity_id=r.entity_id,
                local_payload=r.local_payload, remote_payload=r.remote_payload,
                local_version=r.local_version, remote_version=r.remote_version,
                resolution=r.resolution, created_at=r.created_at,
                resolved_at=r.resolved_at, resolution_note=r.resolution_note,
            )
            for r in rows
        ],
        total=total,
    )


@sync_router.post("/conflicts/{conflict_id}/resolve", response_model=ResolveConflictOut)
async def resolve_conflict(
    conflict_id: UUID,
    body: ResolveConflictIn,
    device_id: str = Query(default="api", min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """حل تعارض: keep_local (نسخهٔ دستگاه برنده) | keep_remote (نسخهٔ سرور) |
    merged (payload ادغام‌شدهٔ کاربر)."""
    result = await service.resolve_conflict(
        db, user, conflict_id,
        resolution=body.resolution,
        merged_payload=body.merged_payload,
        note=body.note,
        device_id=device_id,
    )
    return ResolveConflictOut(
        id=result["id"],
        resolution=result["resolution"],
        applied_version=result["applied_version"],
    )


@sync_router.get("/offline-pack", response_model=OfflinePackOut)
async def offline_pack(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """فهرست اولویت‌دار محتوای پیشنهادی برای دانلود آفلاین:
    شروع‌شده > دنبال‌شده > محبوب (امتیازدهی ساده، بدون ML — ADR-0010)."""
    items = await service.offline_pack(db, user)
    return OfflinePackOut(
        items=[OfflinePackItem(**i) for i in items],
        generated_at=datetime.now(UTC),
    )
