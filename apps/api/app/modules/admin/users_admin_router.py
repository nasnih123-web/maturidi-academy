"""روتر مدیریتی کاربران — فاز ۱۴: نمای ۳۶۰°. مجوز: `users.view360`.

اکشن‌های مدیریتی (تعلیق/فعال‌سازی/حذف) با مجوز جدا `users.manage`."""

from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.rate_limit import get_client_ip, rate_limit, trusted_proxy_set
from app.models.models import User
from app.modules.admin import users360_service as svc
from app.modules.admin import users_dashboard_service as dash_svc
from app.modules.admin.control_schemas import (
    UserOverviewOut,
    UsersDashboardPageOut,
    UsersStatsOut,
)
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


@router.get("/dashboard", response_model=UsersDashboardPageOut)
async def get_users_dashboard(
    q: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None),
    profile: str | None = Query(default=None),
    country: str | None = Query(default=None, max_length=2),
    sort: str = Query(default="created_at"),
    order: str = Query(default="desc"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """داشبورد کاربران CRM (فاز C) — جست‌وجو/فیلتر/مرتب‌سازی + IP و دستگاه.

    status: pending|completed — profile: complete|incomplete —
    country: کد ISO (روی کشور مؤثر: پروفایل یا شمارهٔ تأییدشده) —
    sort: created_at|last_activity.
    """
    if status is not None and status not in ("pending", "completed"):
        raise APIError(422, "bad_filter", "فیلتر وضعیت نامعتبر است")
    if profile is not None and profile not in ("complete", "incomplete"):
        raise APIError(422, "bad_filter", "فیلتر پروفایل نامعتبر است")
    if sort not in ("created_at", "last_activity"):
        raise APIError(422, "bad_filter", "مرتب‌سازی نامعتبر است")
    if order not in ("asc", "desc"):
        raise APIError(422, "bad_filter", "جهت مرتب‌سازی نامعتبر است")
    return await dash_svc.list_dashboard_users(
        db,
        q=q,
        status=status,
        profile=profile,
        country=country.upper() if country else None,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )


@router.get("/stats", response_model=UsersStatsOut)
async def get_users_stats(
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """آمار سربرگ داشبورد کاربران (فاز C)."""
    return await dash_svc.users_stats(db)


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


_manage_perm = require_permission("users.manage")


async def _manage_target(db: AsyncSession, actor: User, user_id: uuid.UUID) -> User:
    """کاربر هدفِ اکشن مدیریتی + دو محافظ: روی خودت نه، روی تنها مدیر ارشد نه."""
    from app.models.models import Role, UserRole

    target = await db.get(User, user_id)
    if target is None:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    if target.id == actor.id:
        raise APIError(422, "self_action", "نمی‌توانید این کار را روی حساب خودتان انجام دهید")
    role_names = (await db.execute(
        select(Role.name).join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == target.id))).scalars().all()
    if "super_admin" in role_names:
        others = (await db.execute(
            select(func.count()).select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .join(User, User.id == UserRole.user_id)
            .where(
                Role.name == "super_admin",
                UserRole.user_id != target.id,
                User.is_active.is_(True),
            ))).scalar_one()
        if others == 0:
            raise APIError(
                422, "last_super_admin",
                "این کاربر تنها مدیر ارشد فعال است و قابل تعلیق یا حذف نیست",
            )
    return target


@router.post("/{user_id}/suspend", response_model=dict)
@rate_limit(_admin_rl_key("user-suspend"), limit=30, window_s=60)
async def post_suspend_user(
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(_manage_perm),
    db: AsyncSession = Depends(get_db),
):
    """تعلیق کاربر: is_active=False + ابطال همهٔ نشست‌ها و رفرش‌توکن‌ها.

    ورود و همهٔ مسیرهای احراز is_active را چک می‌کنند، پس تعلیق فوری و
    کامل است؛ دادهٔ کاربر دست‌نخورده می‌ماند و با فعال‌سازی برمی‌گردد.
    """
    from app.core.audit import log_audit
    from app.models.models import RefreshToken, Session

    target = await _manage_target(db, user, user_id)
    if not target.is_active:
        return {"user_id": str(user_id), "is_active": False}
    target.is_active = False
    await db.execute(update(Session).where(
        Session.user_id == user_id, Session.revoked.is_(False)).values(revoked=True))
    await db.execute(update(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)).values(revoked=True))
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.suspend",
        entity_type="user", entity_id=str(user_id),
        old_values={"is_active": True}, new_values={"is_active": False},
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"user_id": str(user_id), "is_active": False}


@router.post("/{user_id}/activate", response_model=dict)
@rate_limit(_admin_rl_key("user-activate"), limit=30, window_s=60)
async def post_activate_user(
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(_manage_perm),
    db: AsyncSession = Depends(get_db),
):
    """فعال‌سازی دوبارهٔ کاربر معلق: is_active=True (نشست تازه با ورود بعدی)."""
    from app.core.audit import log_audit

    target = await _manage_target(db, user, user_id)
    if target.is_active:
        return {"user_id": str(user_id), "is_active": True}
    target.is_active = True
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.activate",
        entity_type="user", entity_id=str(user_id),
        old_values={"is_active": False}, new_values={"is_active": True},
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"user_id": str(user_id), "is_active": True}


@router.delete("/{user_id}", response_model=dict)
@rate_limit(_admin_rl_key("user-delete"), limit=20, window_s=60)
async def delete_user(
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(_manage_perm),
    db: AsyncSession = Depends(get_db),
):
    """حذف کامل کاربر — فقط وقتی دادهٔ وابستهٔ محتوایی ندارد.

    اول ردیف‌های صرفاً حسابی (نشست، توکن‌ها، کدهای تأیید، نقش‌ها) پاک
    می‌شوند؛ اگر هنوز ارجاعی از دادهٔ واقعی (حمایت، فتوا، حفاظ، …) باشد
    قید FK جلوی حذف را می‌گیرد و 409 برمی‌گردد تا مدیر به‌جای حذف،
    تعلیق کند. حذفِ حساب‌های تستی و ثبت‌نام‌های ناتمامِ بی‌فعالیت —
    مصرف اصلی این دکمه — تمیز انجام می‌شود.
    """
    from app.core.audit import log_audit
    from app.models.models import (
        ClusterMember,
        Donation,
        HifzAttempt,
        HifzTest,
        PasswordResetToken,
        PhoneVerificationCode,
        RecoveryCode,
        RefreshToken,
        Session,
        UserRole,
    )

    target = await _manage_target(db, user, user_id)
    # دادهٔ محتواییِ واقعی (حمایت/حفاظ/فتوا) حذف را صریحاً 409 می‌کند —
    # مستقل از این‌که FK دیتابیس enforce شود یا نه (SQLite تست در برابر
    # Postgres پروداکشن). بقیهٔ ارجاع‌ها را قید FK و except زیر می‌گیرد.
    blockers = 0
    for blocker_model, blocker_column in (
        (Donation, Donation.donor_id),
        (HifzAttempt, HifzAttempt.user_id),
        (HifzTest, HifzTest.user_id),
        (ClusterMember, ClusterMember.user_id),
    ):
        blockers += (await db.execute(
            select(func.count()).select_from(blocker_model)
            .where(blocker_column == user_id))).scalar_one()
    if blockers:
        raise APIError(
            409, "user_has_related_data",
            "کاربر دادهٔ وابسته دارد (حمایت، فتوا، حفاظ و…)؛ به‌جای حذف، او را تعلیق کنید",
        )
    snapshot = {"email": target.email, "phone": target.phone, "full_name": target.full_name}
    for model in (
        Session,
        RefreshToken,
        PasswordResetToken,
        PhoneVerificationCode,
        RecoveryCode,
        UserRole,
    ):
        await db.execute(delete(model).where(model.user_id == user_id))
    await db.delete(target)
    try:
        await db.flush()
        await log_audit(
            db, actor_id=user.id, actor_type="admin", action="users.delete",
            entity_type="user", entity_id=str(user_id),
            old_values=snapshot,
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise APIError(
            409, "user_has_related_data",
            "کاربر دادهٔ وابسته دارد (حمایت، فتوا، حفاظ و…)؛ به‌جای حذف، او را تعلیق کنید",
        ) from None
    return {"user_id": str(user_id), "deleted": True}
