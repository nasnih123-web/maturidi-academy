"""وابستگی‌های احراز هویت و مجوز — فاز ۰ §۲.

نقش همیشه از user_roles خوانده می‌شود، هرگز از ستون role (که وجود ندارد).
"""
from __future__ import annotations

import uuid

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.security import decode_access_token
from app.models.models import Permission, RolePermission, User, UserRole

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise APIError(401, "unauthorized", "توکن احراز هویت ارسال نشده است")
    payload = decode_access_token(credentials.credentials)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise APIError(401, "invalid_token", "توکن نامعتبر است")
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise APIError(401, "unauthorized", "کاربر یافت نشد یا غیرفعال است")
    return user


def require_permission(permission_key: str):
    """فکتوری dependency — بررسی مجوز واقعی از روی جدول‌ها، نه enum."""

    async def _check(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        stmt = (
            select(Permission.id)
            .select_from(UserRole)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(UserRole.user_id == user.id, Permission.key == permission_key)
            .limit(1)
        )
        if not (await db.execute(stmt)).first():
            raise APIError(403, "forbidden", "دسترسی کافی نیست")
        return user

    return _check
