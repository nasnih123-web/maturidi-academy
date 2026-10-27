"""روتر داشبورد اتصالات بیرونی — فاز ۱۴. مجوز: `connections.test`."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.admin import connections_service as svc
from app.modules.admin.control_schemas import (
    ConnectionStatusOut,
    ConnectionTestIn,
    ConnectionTestOut,
)
from app.modules.auth.dependencies import require_permission

router = APIRouter(prefix="/api/v1/admin/connections", tags=["admin-connections"])
_perm = require_permission("connections.test")


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.get("/status", response_model=ConnectionStatusOut)
async def get_connections_status(
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """وضعیت زندهٔ همهٔ وابستگی‌های بیرونی — هیچ secretای برنمی‌گردد (§۱۴)."""
    return await svc.get_status(db)


@router.post("/test/{service}", response_model=ConnectionTestOut)
async def test_connection(
    service: str,
    data: ConnectionTestIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """«تست تماس» یک سرویس — نتیجه در audit ثبت می‌شود؛ secret لاگ نمی‌شود.

    payment صادقانه «در دسترس نیست» برمی‌گرداند.
    """
    ip, ua = _client(request)
    return await svc.test_service(
        db, service, data.model_dump(exclude_none=True),
        actor=user, ip=ip, user_agent=ua,
    )
