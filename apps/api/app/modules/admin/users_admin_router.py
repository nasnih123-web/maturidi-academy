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


@router.get("/trash", response_model=UsersDashboardPageOut)
async def get_users_trash(
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """سطل زبالهٔ کاربران — حذف نرم‌شده‌ها با سابقهٔ کامل و دست‌نخورده."""
    return await dash_svc.list_trashed_users(db, q=q, limit=limit, offset=offset)


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
    """حذف نرم — انتقال کاربر به سطل زباله (با یا بی سابقه، فرقی ندارد).

    ردیف کاربر و همهٔ سابقه‌اش (حمایت، فتوا، حفاظ، …) دست‌نخورده
    می‌ماند؛ فقط deleted_at/deleted_by ست، حساب غیرفعال و نشست‌ها
    باطل می‌شوند تا ورود ممکن نباشد. برگشت با «بازیابی» از سطل است
    و نابودی کامل فقط با حذف دائمی از داخل سطل.
    """
    from app.core.audit import log_audit
    from app.models.models import RefreshToken, Session

    target = await _manage_target(db, user, user_id)
    if target.deleted_at is not None:
        return {
            "user_id": str(user_id), "trashed": True,
            "deleted_at": target.deleted_at.isoformat(),
        }
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    target.deleted_at = now
    target.deleted_by = user.id
    target.is_active = False
    await db.execute(update(Session).where(
        Session.user_id == user_id, Session.revoked.is_(False)).values(revoked=True))
    await db.execute(update(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)).values(revoked=True))
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.trash",
        entity_type="user", entity_id=str(user_id),
        old_values={"is_active": True, "deleted_at": None},
        new_values={"is_active": False, "deleted_at": now.isoformat()},
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {
        "user_id": str(user_id), "trashed": True,
        "deleted_at": now.isoformat(),
    }


@router.post("/{user_id}/restore", response_model=dict)
@rate_limit(_admin_rl_key("user-restore"), limit=30, window_s=60)
async def post_restore_user(
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(_manage_perm),
    db: AsyncSession = Depends(get_db),
):
    """بازیابی از سطل زباله: deleted_at پاک و حساب دوباره فعال می‌شود.

    سابقه در تمام مدت حذف نرم سر جایش بوده، پس بازیابی چیزی جز
    برگرداندن همین دو پرچم نیست؛ نشست تازه با ورود بعدی ساخته می‌شود.
    """
    from app.core.audit import log_audit

    target = await db.get(User, user_id)
    if target is None:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    if target.deleted_at is None:
        return {"user_id": str(user_id), "is_trashed": False, "restored": False}
    target.deleted_at = None
    target.deleted_by = None
    target.is_active = True
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.restore",
        entity_type="user", entity_id=str(user_id),
        old_values={"is_active": False},
        new_values={"is_active": True},
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"user_id": str(user_id), "is_trashed": False, "restored": True}


# جدول‌هایی که ارجاع nullableشان به کاربر در حذف دائمی «ناشناس» می‌شود
# (ردیف می‌ماند، شخص جدا می‌شود) تا حساب‌وکتاب مالی و محتوای عمومی
# با رفتن یک کاربر فرو نریزد. بقیهٔ ارجاع‌ها واقعاً پاک می‌شوند.
_ANONYMIZE_TABLES = {
    "donations", "payment_intents", "library_items", "question_clusters",
}


async def _purge_user_graph(db: AsyncSession, user_id: uuid.UUID) -> None:
    """حذف بازگشتی همهٔ ردیف‌های وابسته به کاربر از گراف FK مدل‌ها.

    برای هر جدولی که به users ارجاع دارد: اگر جدول در فهرست ناشناس‌سازی
    است و ستون nullable، ارجاع NULL می‌شود؛ وگرنه ردیف‌ها — بعد از
    پاک‌کردن بازگشتی فرزندانشان — حذف می‌شوند. در پایان خود ردیف
    کاربر پاک می‌شود. فایل‌های مدیای متعلق به کاربر هم بهترین‌تلاش
    از storage حذف می‌شوند.
    """
    from app.core.database import Base
    from app.models.models import MediaAsset

    meta = Base.metadata
    users_table = meta.tables["users"]

    # ارجاع آواتار خود کاربر اول خنثی می‌شود تا پاک‌کردن ردیف مدیای
    # آواتار در میانهٔ گراف به ردیف کاربر گره نخورد.
    await db.execute(
        update(users_table)
        .where(users_table.c.id == user_id)
        .values(avatar_media_id=None)
    )

    assets = (
        await db.execute(
            select(MediaAsset).where(MediaAsset.owner_id == user_id)
        )
    ).scalars().all()
    if assets:
        try:
            from app.core.storage import get_storage

            storage = get_storage()
            for asset in assets:
                for key in (asset.storage_key, asset.thumbnail_key):
                    if key:
                        try:
                            await storage.delete_object(key)
                        except Exception:
                            pass
        except Exception:
            pass

    async def purge(table, col_name: str, values: set, seen: set) -> None:
        marker = (table.name, col_name, tuple(sorted(str(v) for v in values)))
        if marker in seen or not values:
            return
        seen.add(marker)
        pk_cols = list(table.primary_key.columns)
        if len(pk_cols) == 1:
            pk = pk_cols[0]
            child_ids = set(
                (
                    await db.execute(
                        select(pk).where(table.c[col_name].in_(values))
                    )
                ).scalars().all()
            )
            if child_ids:
                for child in meta.tables.values():
                    if child is table or child is users_table:
                        continue
                    for c in child.c:
                        for fk in c.foreign_keys:
                            if fk.column.table is table and fk.column.name == pk.name:
                                if c.nullable and child.name in _ANONYMIZE_TABLES:
                                    await db.execute(
                                        update(child)
                                        .where(c.in_(child_ids))
                                        .values({c.name: None})
                                    )
                                else:
                                    await purge(child, c.name, child_ids, seen)
        await db.execute(delete(table).where(table.c[col_name].in_(values)))

    for table in meta.tables.values():
        if table is users_table:
            continue
        for c in table.c:
            for fk in c.foreign_keys:
                if fk.column.table is users_table:
                    if c.nullable and table.name in _ANONYMIZE_TABLES:
                        await db.execute(
                            update(table).where(c == user_id).values({c.name: None})
                        )
                    else:
                        await purge(table, c.name, {user_id}, set())
    # ارجاع‌های داخل خود users: deleted_by دیگران به این کاربر + آواتار خودش
    await db.execute(
        update(users_table)
        .where(users_table.c.deleted_by == user_id)
        .values(deleted_by=None)
    )
    await db.execute(
        update(users_table)
        .where(users_table.c.id == user_id)
        .values(avatar_media_id=None)
    )
    await db.execute(delete(users_table).where(users_table.c.id == user_id))


@router.delete("/{user_id}/permanent", response_model=dict)
@rate_limit(_admin_rl_key("user-delete-permanent"), limit=10, window_s=60)
async def delete_user_permanent(
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(_manage_perm),
    db: AsyncSession = Depends(get_db),
):
    """حذف دائمی از سطل زباله — کاربر و همهٔ دادهٔ وابسته‌اش پاک می‌شود.

    فقط برای کاربری که همین حالا در سطل است. استثنای آگاهانه: ردیف‌های
    مالی (حمایت‌ها) و محتوای کتابخانه/خوشه‌ها ناشناس می‌شوند (ارجاع
    به کاربر NULL) تا جمع کمپین‌ها و محتوای عمومی با حذف یک شخص
    به‌هم نریزد؛ خود شخص دیگر هیچ‌جا قابل ردیابی نیست.
    """
    from app.core.audit import log_audit

    target = await _manage_target(db, user, user_id)
    if target.deleted_at is None:
        raise APIError(
            422, "not_trashed",
            "حذف دائمی فقط از داخل سطل زباله ممکن است؛ اول کاربر را حذف (منتقل به سطل) کنید",
        )
    snapshot = {
        "email": target.email, "phone": target.phone,
        "full_name": target.full_name,
        "deleted_at": target.deleted_at.isoformat(),
    }
    await log_audit(
        db, actor_id=user.id, actor_type="admin", action="users.delete_permanent",
        entity_type="user", entity_id=str(user_id),
        old_values=snapshot,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    try:
        await _purge_user_graph(db, user_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise APIError(
            409, "user_purge_blocked",
            "حذف دائمی به‌خاطر ارجاع دادهٔ ناشناخته کامل نشد؛ کاربر در سطل باقی ماند",
        ) from None
    return {"user_id": str(user_id), "deleted": True, "permanent": True}
