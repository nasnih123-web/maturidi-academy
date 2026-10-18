"""بوت‌استرپ اولیه — فاز ۱.

ایجاد نقش‌ها و مجوزهای پایه، اولین super_admin (از متغیرهای محیطی
ADMIN_EMAIL / ADMIN_PHONE / ADMIN_PASSWORD) و seed تنظیمات پیش‌فرض پلتفرم.

اجرا:  python -m app.seed   (بعد از alembic upgrade head)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import engine
from app.core.secrets import encrypt_value
from app.core.security import hash_password
from app.models.models import (
    Permission,
    PlatformSetting,
    Role,
    RolePermission,
    Theme,
    User,
    UserRole,
)

# مجوزهای پایه — با رشد فازها تکمیل می‌شود
BASE_PERMISSIONS = [
    ("users.manage", "مدیریت کاربران"),
    ("roles.manage", "مدیریت نقش‌ها و مجوزها"),
    ("content.publish", "انتشار محتوا"),
    ("fatwa.approve", "تأیید فتوا"),
    ("settings.manage", "مدیریت تنظیمات پلتفرم"),
    ("media.manage", "مدیریت رسانه"),
    ("finance.manage", "مدیریت مالی"),
]

BASE_ROLES = [
    ("super_admin", "مدیر ارشد — همهٔ مجوزها"),
    ("admin", "مدیر — بدون مدیریت نقش‌ها"),
    ("scholar", "عالم/مفتی — فتوا و محتوا"),
    ("user", "کاربر عادی"),
]


async def _get_or_create_role(db: AsyncSession, name: str, description: str) -> Role:
    role = (await db.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
    if not role:
        role = Role(name=name, description=description)
        db.add(role)
        await db.flush()
    return role


async def _get_or_create_permission(db: AsyncSession, key: str, description: str) -> Permission:
    perm = (
        await db.execute(select(Permission).where(Permission.key == key))
    ).scalar_one_or_none()
    if not perm:
        perm = Permission(key=key, description=description)
        db.add(perm)
        await db.flush()
    return perm


async def main() -> None:
    email = os.environ.get("ADMIN_EMAIL", "").strip() or None
    phone = os.environ.get("ADMIN_PHONE", "").strip() or None
    password = os.environ.get("ADMIN_PASSWORD", "")

    if not password or not (email or phone):
        print(
            "خطا: ADMIN_PASSWORD و یکی از ADMIN_EMAIL یا ADMIN_PHONE باید تنظیم شوند",
            file=sys.stderr,
        )
        sys.exit(1)

    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        roles: dict[str, Role] = {}
        for name, desc in BASE_ROLES:
            roles[name] = await _get_or_create_role(db, name, desc)

        perms: dict[str, Permission] = {}
        for key, desc in BASE_PERMISSIONS:
            perms[key] = await _get_or_create_permission(db, key, desc)

        # super_admin همهٔ مجوزها را دارد
        for perm in perms.values():
            exists = (
                await db.execute(
                    select(RolePermission).where(
                        RolePermission.role_id == roles["super_admin"].id,
                        RolePermission.permission_id == perm.id,
                    )
                )
            ).first()
            if not exists:
                db.add(
                    RolePermission(
                        role_id=roles["super_admin"].id, permission_id=perm.id
                    )
                )

        # اولین super_admin
        stmt = select(User)
        if email:
            stmt = stmt.where(User.email == email)
        else:
            stmt = stmt.where(User.phone == phone)
        admin = (await db.execute(stmt)).scalar_one_or_none()
        if not admin:
            admin = User(
                full_name="مدیر ارشد",
                email=email,
                phone=phone,
                password_hash=hash_password(password),
                locale="fa",
                is_active=True,
                is_verified=True,
            )
            db.add(admin)
            await db.flush()
            db.add(UserRole(user_id=admin.id, role_id=roles["super_admin"].id))
            print(f"super_admin ساخته شد: {email or phone}")
        else:
            print(f"super_admin از قبل وجود دارد: {email or phone}")

        # تنظیمات پیش‌فرض پلتفرم (مقادیر حساس رمزنگاری‌شده — فاز ۰ §۳)
        defaults = {
            "app_display_name": {"fa": "آکادمی ماتریدی", "ar": "أكاديمية الماتريدي", "en": "Maturidi Academy"},
            "default_locale": "fa",
            "terms_version": "v1",
        }
        for key, value in defaults.items():
            exists = await db.get(PlatformSetting, key)
            if not exists:
                db.add(
                    PlatformSetting(
                        key=key,
                        value=encrypt_value(json.dumps(value, ensure_ascii=False)),
                        encryption_key_version=1,
                    )
                )

        # تم پیش‌فرض فعال
        active = (
            await db.execute(select(Theme).where(Theme.is_active.is_(True)))
        ).scalar_one_or_none()
        if not active:
            db.add(
                Theme(
                    name={"fa": "پیش‌فرض", "ar": "الافتراضي", "en": "Default"},
                    is_active=True,
                )
            )

        await db.commit()
    print("seed انجام شد.")


if __name__ == "__main__":
    asyncio.run(main())
