"""روتر مدیریتی کاربران — فاز ۱۴: نمای ۳۶۰°. مجوز: `users.view360`."""
from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.rate_limit import get_client_ip, rate_limit, trusted_proxy_set
from app.models.models import User
from app.modules.admin import users360_service as svc
from app.modules.admin.control_schemas import UserOverviewOut
from app.modules.auth.dependencies import require_permission

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])
_perm = require_permission("users.view360")


def _admin_rl_key(suffix: str):
    """کلید محدودیت نرخ برای عملیات ادمین (§۷) — بر اساس IP واقعی."""

    def _key(request: Request) -> str:
        from app.core.config import get_settings

        proxies = trusted_proxy_set(get_settings().trusted_proxies)
        return f"admin:{suffix}:{get_client_ip(request, proxies) or 'unknown'}"

    return _key


@router.get("/{user_id}/overview", response_model=UserOverviewOut)
async def get_user_overview(
    user_id: uuid.UUID,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """نمای ۳۶۰° کاربر — تجمیع فقط‌خواندنی: پروفایل، نقش‌ها، LMS، کتابخانه،
    اجتماعی، فتوا، اعلان‌ها، audit trail."""
    return await svc.get_overview(db, user_id)


class UserRolesIn(BaseModel):
    role_ids: list[uuid.UUID] = []
    role_names: list[str] = []


@router.patch("/{user_id}/roles", response_model=dict)
@rate_limit(_admin_rl_key("roles"), limit=20, window_s=60)
async def patch_user_roles(
    user_id: uuid.UUID,
    data: UserRolesIn,
    request: Request,
    user: User = Depends(require_permission("roles.manage")),
    db: AsyncSession = Depends(get_db),
):
    """جایگزینی نقش‌های کاربر — نمای ۳۶۰° (تب نقش‌ها). محافظت از super_admin خود."""
    from app.core.audit import log_audit
    from app.models.models import RefreshToken, Role, Session, UserRole

    target = await db.get(User, user_id)
    if target is None:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    wanted_ids = set(data.role_ids)
    if data.role_names:
        rows = (await db.execute(
            select(Role).where(Role.name.in_(data.role_names)))).scalars().all()
        found = {r.name for r in rows}
        missing = set(data.role_names) - found
        if missing:
            raise APIError(422, "bad_role_name", f"نقش نامعتبر: {missing}")
        wanted_ids |= {r.id for r in rows}
    if not wanted_ids:
        raise APIError(422, "empty_roles", "حداقل یک نقش لازم است")
    roles = (await db.execute(select(Role).where(Role.id.in_(wanted_ids)))).scalars().all()
    if len(roles) != len(wanted_ids):
        raise APIError(422, "bad_role_id", "یک یا چند نقش نامعتبر است")
    # محافظت: ادمین نمی‌تواند نقش super_admin را از خودش بگیرد
    if user_id == user.id:
        my_roles = {r.name for r in roles}
        cur = (await db.execute(select(Role.name).join(UserRole, UserRole.role_id == Role.id)
                               .where(UserRole.user_id == user.id))).scalars().all()
        if "super_admin" in cur and "super_admin" not in my_roles:
            raise APIError(422, "self_lockout", "نمی‌توانید نقش super_admin را از خود بگیرید")
    old = (await db.execute(select(UserRole.role_id).where(UserRole.user_id == user_id))).scalars().all()
    await db.execute(delete(UserRole).where(UserRole.user_id == user_id))
    for rid in wanted_ids:
        db.add(UserRole(user_id=user_id, role_id=rid))
    # تغییر نقش = تغییر سطح دسترسی (§۵): همهٔ نشست‌ها و رفرش‌توکن‌های کاربر
    # باطل می‌شوند تا با لاگین بعدی، دامنهٔ توکن (scope) بر اساس وضعیت
    # فعلیِ 2FA/نقش صادر شود — وگرنه توکنِ `full` قدیمیِ یک کاربرِ تازه‌ادمین‌شدهٔ
    # بدون TOTP همچنان درهای مدیریتی را باز می‌گذاشت.
    await db.execute(update(Session).where(
        Session.user_id == user_id, Session.revoked.is_(False)).values(revoked=True))
    await db.execute(update(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)).values(revoked=True))
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.roles.replace",
        entity_type="user", entity_id=str(user_id),
        old_values={"role_ids": [str(r) for r in old]},
        new_values={"role_ids": [str(r) for r in wanted_ids]},
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"user_id": str(user_id), "role_ids": [str(r) for r in wanted_ids]}


@router.post("/{user_id}/sessions/revoke", response_model=dict)
@rate_limit(_admin_rl_key("sessions-revoke"), limit=30, window_s=60)
async def post_revoke_sessions(
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(require_permission("users.view360")),
    db: AsyncSession = Depends(get_db),
):
    """ابطال همهٔ نشست‌های کاربر — «خروج از همهٔ دستگاه‌ها» (§۲)."""
    from app.core.audit import log_audit
    from app.models.models import RefreshToken, Session

    target = await db.get(User, user_id)
    if target is None:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    sess = cast(
        CursorResult[Any],
        await db.execute(update(Session).where(
            Session.user_id == user_id, Session.revoked.is_(False)).values(revoked=True)),
    )
    await db.execute(update(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)).values(revoked=True))
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.sessions.revoke_all",
        entity_type="user", entity_id=str(user_id),
        new_values={"revoked_sessions": sess.rowcount or 0},
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"user_id": str(user_id), "revoked_sessions": sess.rowcount or 0}
