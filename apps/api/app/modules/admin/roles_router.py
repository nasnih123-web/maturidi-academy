"""روتر مدیریت نقش/مجوز — فاز ۱۴. مجوز: `roles.manage` (فقط super_admin)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.admin import roles_service as svc
from app.modules.admin.control_schemas import (
    MessageOut,
    PermissionOut,
    RoleCreateIn,
    RoleOut,
    RoleUpdateIn,
)
from app.modules.auth.dependencies import require_permission

router = APIRouter(prefix="/api/v1/admin/roles", tags=["admin-roles"])
_perm = require_permission("roles.manage")


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.get("", response_model=list[RoleOut])
async def get_roles(
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_roles(db)


@router.get("/permissions", response_model=list[PermissionOut])
async def get_permissions(
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_permissions(db)


@router.post("", response_model=RoleOut, status_code=201)
async def post_role(
    data: RoleCreateIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client(request)
    return await svc.create_role(
        db, actor=user, name=data.name, description=data.description,
        permission_keys=data.permission_keys, ip=ip, user_agent=ua,
    )


@router.put("/{role_id}", response_model=RoleOut)
async def put_role(
    role_id: uuid.UUID,
    data: RoleUpdateIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client(request)
    return await svc.update_role(
        db, role_id, actor=user, name=data.name,
        description=data.description,
        permission_keys=data.permission_keys, ip=ip, user_agent=ua,
    )


@router.delete("/{role_id}", response_model=MessageOut)
async def delete_role(
    role_id: uuid.UUID,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client(request)
    await svc.delete_role(db, role_id, actor=user, ip=ip, user_agent=ua)
    return MessageOut(message="نقش حذف شد")
