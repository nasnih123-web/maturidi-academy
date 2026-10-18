"""وابستگی‌های احراز هویت و مجوز — فاز ۰ §۲.

نقش همیشه از user_roles خوانده می‌شود، هرگز از ستون role (که وجود ندارد).
access token به نشست (sid) گره خورده است: اگر نشست باطل شده باشد، توکن —
حتی پیش از انقضای ۱۵ دقیقه‌ای — مرده است (الگوی turbo).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import ensure_aware, get_db
from app.core.errors import APIError
from app.core.security import decode_access_token
from app.models.models import Permission, RolePermission, Session, User, UserRole

_bearer = HTTPBearer(auto_error=False)

_LAST_ACTIVE_TOUCH_SECONDS = 60


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

    sid = payload.get("sid")
    if sid:
        try:
            session_id = uuid.UUID(sid)
        except ValueError:
            raise APIError(401, "invalid_token", "توکن نامعتبر است")
        session = await db.get(Session, session_id)
        if session is None or session.revoked:
            raise APIError(401, "session_revoked", "نشست پایان یافته است")
        # لمس throttled آخرین فعالیت — بدون commit صریح در dependency
        # (برخلاف turbo که در dep کامیت می‌کند؛ نوشتن با تراکنش درخواست می‌ماند).
        now = datetime.now(timezone.utc)
        if (now - ensure_aware(session.last_active_at)).total_seconds() > _LAST_ACTIVE_TOUCH_SECONDS:
            session.last_active_at = now

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
