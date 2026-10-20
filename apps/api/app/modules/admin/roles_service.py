"""سرویس مدیریت نقش/مجوز — فاز ۱۴.

CRUD نقش‌ها + تخصیص مجوزها؛ فقط دارندگان `roles.manage` (عملاً super_admin).
حفاظ‌ها:
- نقش `super_admin` حذف‌شدنی نیست.
- مجوزهای نقش `super_admin` خالی‌شدنی نیستند (دست‌کم `roles.manage` می‌ماند).
- کاربر نمی‌تواند نقش super_admin را از خودش بگیرد (قفل‌شدن بیرون).
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.database import ensure_aware
from app.core.errors import APIError
from app.models.models import Permission, Role, RolePermission, User, UserRole

SUPER_ADMIN = "super_admin"
PROTECTED_ROLE = SUPER_ADMIN


def _role_out(role: Role, permissions: list[Permission]) -> dict:
    return {
        "id": str(role.id), "name": role.name, "description": role.description,
        "permissions": [{"id": str(p.id), "key": p.key,
                         "description": p.description} for p in permissions],
        "created_at": ensure_aware(role.created_at).isoformat(),
    }


async def _role_permissions(db: AsyncSession, role_id: uuid.UUID) -> list[Permission]:
    return list(
        (
            await db.execute(
                select(Permission)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .where(RolePermission.role_id == role_id)
                .order_by(Permission.key.asc())
            )
        ).scalars().all()
    )


async def list_roles(db: AsyncSession) -> list[dict]:
    roles = (
        await db.execute(select(Role).order_by(Role.name.asc()))
    ).scalars().all()
    out = []
    for r in roles:
        perms = await _role_permissions(db, r.id)
        member_count = (
            await db.execute(
                select(func.count()).select_from(UserRole)
                .where(UserRole.role_id == r.id)
            )
        ).scalar_one()
        d = _role_out(r, perms)
        d["member_count"] = member_count
        out.append(d)
    return out


async def list_permissions(db: AsyncSession) -> list[dict]:
    perms = (
        await db.execute(select(Permission).order_by(Permission.key.asc()))
    ).scalars().all()
    return [{"id": str(p.id), "key": p.key, "description": p.description}
            for p in perms]


async def create_role(
    db: AsyncSession, *, actor: User, name: str, description: str | None,
    permission_keys: list[str] | None,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    name = (name or "").strip()
    if not name or len(name) > 64:
        raise APIError(422, "bad_role_name", "نام نقش نامعتبر است")
    existing = (
        await db.execute(select(Role).where(Role.name == name))
    ).scalar_one_or_none()
    if existing is not None:
        raise APIError(409, "role_exists", "نقشی با این نام وجود دارد")
    role = Role(name=name, description=description)
    db.add(role)
    await db.flush()
    perms = await _assign_permissions(db, role, permission_keys or [])
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="roles.create",
        entity_type="role", entity_id=str(role.id),
        new_values={"name": name,
                    "permissions": sorted(p.key for p in perms)},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(role)
    return _role_out(role, perms)


async def _assign_permissions(
    db: AsyncSession, role: Role, keys: list[str]
) -> list[Permission]:
    keys = sorted(set(keys))
    perms: list[Permission] = []
    for key in keys:
        p = (
            await db.execute(select(Permission).where(Permission.key == key))
        ).scalar_one_or_none()
        if p is None:
            raise APIError(422, "unknown_permission", f"مجوز ناشناخته: {key}")
        perms.append(p)
    # بازنویسی کامل تخصیص‌ها
    await db.execute(
        RolePermission.__table__.delete().where(RolePermission.role_id == role.id)
    )
    for p in perms:
        db.add(RolePermission(role_id=role.id, permission_id=p.id))
    await db.flush()
    return perms


async def update_role(
    db: AsyncSession, role_id: uuid.UUID, *, actor: User,
    name: str | None = None, description: str | None = None,
    permission_keys: list[str] | None = None,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    role = await db.get(Role, role_id)
    if role is None:
        raise APIError(404, "not_found", "نقش یافت نشد")
    old_keys = sorted(p.key for p in await _role_permissions(db, role.id))

    if name is not None and name.strip() != role.name:
        new_name = name.strip()
        if role.name == PROTECTED_ROLE:
            raise APIError(422, "protected_role",
                           "نام نقش super_admin قابل تغییر نیست")
        dup = (
            await db.execute(select(Role).where(Role.name == new_name))
        ).scalar_one_or_none()
        if dup is not None:
            raise APIError(409, "role_exists", "نقشی با این نام وجود دارد")
        role.name = new_name
    if description is not None:
        role.description = description

    perms = await _role_permissions(db, role.id)
    if permission_keys is not None:
        if role.name == PROTECTED_ROLE and "roles.manage" not in permission_keys:
            raise APIError(422, "protected_role",
                           "مجوزهای نقش super_admin نمی‌تواند خالی شود")
        perms = await _assign_permissions(db, role, permission_keys)

    new_keys = sorted(p.key for p in perms)
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="roles.update",
        entity_type="role", entity_id=str(role.id),
        old_values={"name": role.name, "permissions": old_keys},
        new_values={"name": role.name, "permissions": new_keys},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(role)
    return _role_out(role, perms)


async def delete_role(
    db: AsyncSession, role_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> None:
    role = await db.get(Role, role_id)
    if role is None:
        raise APIError(404, "not_found", "نقش یافت نشد")
    if role.name == PROTECTED_ROLE:
        raise APIError(422, "protected_role", "نقش super_admin حذف‌شدنی نیست")
    members = (
        await db.execute(
            select(func.count()).select_from(UserRole)
            .where(UserRole.role_id == role.id)
        )
    ).scalar_one()
    if members:
        raise APIError(422, "role_has_members",
                       "نقش عضو دارد؛ ابتدا اعضا را منتقل کنید")
    perms = await _role_permissions(db, role.id)
    await db.execute(
        RolePermission.__table__.delete().where(RolePermission.role_id == role.id)
    )
    await db.delete(role)
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="roles.delete",
        entity_type="role", entity_id=str(role_id),
        old_values={"name": role.name,
                    "permissions": sorted(p.key for p in perms)},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
