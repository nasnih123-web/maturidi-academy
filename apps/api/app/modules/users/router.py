"""روتر کاربران — فقط سیم‌کشی؛ منطق در service.py (فاز ۰ §۱۵، قانون ۶)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.users import service
from app.modules.users.schemas import (
    ConsentOut,
    MeUpdate,
    MessageOut,
    SessionOut,
    UserOut,
    UsersPage,
)

router = APIRouter(prefix="/api/v1", tags=["users"])


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.get("/users/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.patch("/users/me", response_model=UserOut)
async def update_me(
    data: MeUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client(request)
    return await service.update_me(db, user, data, ip, ua)


@router.get("/users/me/sessions", response_model=list[SessionOut])
async def list_sessions(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await service.list_sessions(db, user)


@router.delete("/users/me/sessions/{session_id}", response_model=MessageOut)
async def revoke_session(
    session_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ip, _ = _client(request)
    await service.revoke_session(db, user, session_id, ip)
    return MessageOut(message="نشست بسته شد")


@router.get("/users/me/consent", response_model=list[ConsentOut])
async def list_consents(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await service.list_consents(db, user)


@router.post("/users/me/export")
async def export_data(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """خروجی JSON دادهٔ شخصی — GDPR از روز اول."""
    return await service.export_data(db, user)


@router.delete("/users/me", response_model=MessageOut)
async def delete_me(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ناشناس‌سازی دادهٔ شخصی — GDPR از روز اول."""
    ip, ua = _client(request)
    await service.delete_account(db, user, ip, ua)
    return MessageOut(message="حساب شما ناشناس‌سازی و غیرفعال شد")


@router.get("/admin/users", response_model=UsersPage)
async def admin_list_users(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(require_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    """لیست کاربران با صفحه‌بندی cursor-based (فاز ۰ §۱) — فقط super_admin/دارندگان مجوز."""
    items, next_cursor = await service.admin_list_users(db, cursor, limit)
    return UsersPage(items=items, next_cursor=next_cursor)
