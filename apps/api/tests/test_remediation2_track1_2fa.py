"""remediation-pass-2 Track 1 — §۵: شکاف ثبت‌نام 2FA.

- ادمینِ بدون TOTP با توکن عامل-اول (2fa_setup) → 403 روی endpointهای ادمین
- ارتقای نقش به admin → نشست‌های قبلی باطل (توکن full قدیمی دیگر کار نمی‌کند)
- غیرفعال‌سازی 2FA با کد بازیابی → نشست‌ها باطل می‌شوند
- بازبینی لحظه‌ای در require_permission: توکن fullِ دستی برای ادمینِ بدون TOTP → 403
- ضد replay کد TOTP: مصرف دوبارهٔ یک کد در همان پنجره → 401
- کد TOTP نامعتبر/منقضی → 401
"""
from __future__ import annotations

import time
import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _register(client, email, password="Str0ng!Pass1"):
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست R2",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email, password="Str0ng!Pass1", **kw):
    return await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": password, **kw}
    )


async def _ensure_role_perm(db, role_name: str, perm_key: str):
    """نقش + مجوز واقعی در جدول‌ها (بدون mock)."""
    from app.models.models import Permission, Role, RolePermission

    role = (
        await db.execute(select(Role).where(Role.name == role_name))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name=role_name, description="r2 test")
        db.add(role)
        await db.flush()
    perm = (
        await db.execute(select(Permission).where(Permission.key == perm_key))
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key=perm_key, description="r2 test")
        db.add(perm)
        await db.flush()
    link = (
        await db.execute(
            select(RolePermission).where(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == perm.id,
            )
        )
    ).first()
    if link is None:
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    await db.commit()
    return role


async def _make_admin(tc, suffix: str, with_totp: bool = False):
    """ادمین واقعی؛ with_totp=True یعنی TOTP فعال با سکرت شناخته‌شده."""

    from app.core.secrets import encrypt_value
    from app.core.security import hash_password
    from app.models.models import User, UserRole

    async with tc["maker"]() as db:
        role = await _ensure_role_perm(db, "admin", "platform.settings")
        user = User(
            full_name="ادمین R2",
            email=f"r2admin-{suffix}-{_uid()}@example.com",
            password_hash=hash_password("Str0ng!Pass1"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        secret = None
        if with_totp:
            import json

            import pyotp as _pyotp

            secret = _pyotp.random_base32()
            user.totp_secret = json.dumps(encrypt_value(secret))
        await db.commit()
        return user, secret


# ---------------------------------------------------------------------------


async def test_first_factor_token_blocked_on_admin_endpoint(tc):
    """توکن عامل-اول ادمینِ بدون TOTP → 403 روی endpoint ادمین (نگهبان رگرسیون)."""
    client = tc["client"]
    user, _ = await _make_admin(tc, "ff", with_totp=False)
    r = await _login(client, user.email)
    assert r.status_code == 200, r.text
    assert r.json()["must_enroll_2fa"] is True
    r2 = await client.get(
        f"{BASE}/admin/settings",
        headers={"Authorization": f"Bearer {r.json()['access_token']}"},
    )
    assert r2.status_code == 403, r2.text
    assert r2.json()["error"]["code"] == "requires_2fa"


async def test_full_scope_token_for_privileged_without_totp_rejected(tc):
    """حمله: توکن با scope=fullِ دستی برای ادمینِ بدون TOTP.

    پیش از رفع، require_permission فقط scope را چک می‌کرد و این توکنِ جعلیِ
    «کامل» در را باز می‌کرد؛ حالا بازبینی لحظه‌ای وضعیت TOTP آن را 403 می‌کند.
    """
    from app.core.security import SCOPE_FULL, create_access_token

    client = tc["client"]
    user, _ = await _make_admin(tc, "forge", with_totp=False)
    forged = create_access_token(str(user.id), scope=SCOPE_FULL)
    r = await client.get(
        f"{BASE}/admin/settings", headers={"Authorization": f"Bearer {forged}"}
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "requires_2fa"


async def test_role_elevation_revokes_existing_sessions(tc):
    """ارتقای کاربر عادی به admin → توکن full قبلی‌اش می‌میرد (401).

    سناریوی واقعی: کاربر با توکن full لاگین است؛ ادمین دیگری او را admin
    می‌کند (بدون TOTP). بدون ابطال نشست، همان توکنِ fullِ قدیمی روی
    endpointهای مدیریتی کار می‌کرد.
    """
    client = tc["client"]
    # قربانی: کاربر عادی با نشست فعال
    victim_email = f"victim-{_uid()}@example.com"
    await _register(client, victim_email)
    rv = await _login(client, victim_email)
    assert rv.status_code == 200
    victim_access = rv.json()["access_token"]
    victim_id = rv.json()["user"]["id"] if "user" in rv.json() else None

    # ادمینِ اجراکننده با مجوز roles.manage
    admin, secret = await _make_admin(tc, "elev", with_totp=True)
    import pyotp

    ra = await _login(client, admin.email, totp_code=pyotp.TOTP(secret).now())
    assert ra.status_code == 200, ra.text
    admin_headers = {"Authorization": f"Bearer {ra.json()['access_token']}"}

    async with tc["maker"]() as db:
        await _ensure_role_perm(db, "admin", "roles.manage")
        from app.models.models import User

        victim = (
            await db.execute(select(User).where(User.email == victim_email))
        ).scalar_one()
        victim_id = str(victim.id)

    r = await client.patch(
        f"{BASE}/admin/users/{victim_id}/roles",
        json={"role_names": ["admin"]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text

    # توکن full قدیمی قربانی باید مرده باشد (نشست باطل شده)
    r2 = await client.get(
        f"{BASE}/users/me", headers={"Authorization": f"Bearer {victim_access}"}
    )
    assert r2.status_code == 401, r2.text

    # لاگین مجدد → چون TOTP ندارد، توکن محدود می‌گیرد
    r3 = await _login(client, victim_email)
    assert r3.status_code == 200, r3.text
    assert r3.json()["must_enroll_2fa"] is True
    r4 = await client.get(
        f"{BASE}/admin/settings",
        headers={"Authorization": f"Bearer {r3.json()['access_token']}"},
    )
    assert r4.status_code == 403
    assert r4.json()["error"]["code"] == "requires_2fa"


async def test_recover_2fa_revokes_sessions(tc):
    """بازیابی 2FA با کد بازیابی → توکن‌های قبلی (صادرشده با TOTP قدیمی) می‌میرند."""
    import pyotp

    from app.core.security import generate_recovery_codes, hash_token
    from app.models.models import RecoveryCode, User

    client = tc["client"]
    user, secret = await _make_admin(tc, "rec", with_totp=True)

    # کد بازیابی واقعی در DB (همان قالبی که enable_2fa می‌سازد)
    codes = generate_recovery_codes()
    async with tc["maker"]() as db:
        db_user = (
            await db.execute(select(User).where(User.email == user.email))
        ).scalar_one()
        for code in codes:
            db.add(RecoveryCode(user_id=db_user.id, code_hash=hash_token(code)))
        await db.commit()

    r2 = await _login(client, user.email, totp_code=pyotp.TOTP(secret).now())
    assert r2.status_code == 200, r2.text
    full_access = r2.json()["access_token"]
    r3 = await client.get(
        f"{BASE}/admin/settings", headers={"Authorization": f"Bearer {full_access}"}
    )
    assert r3.status_code == 200, r3.text

    # بازیابی با کد بازیابی
    r4 = await client.post(
        f"{BASE}/auth/2fa/recover",
        json={
            "email": user.email,
            "password": "Str0ng!Pass1",
            "recovery_code": codes[0],
        },
    )
    assert r4.status_code == 200, r4.text

    # توکن قبلی باید مرده باشد (نشست باطل شده)
    r5 = await client.get(
        f"{BASE}/admin/settings", headers={"Authorization": f"Bearer {full_access}"}
    )
    assert r5.status_code == 401, r5.text


async def test_totp_code_replay_rejected(tc):
    """یک کد TOTP فقط یک‌بار مصرف می‌شود — مصرف دوم در همان پنجره → 401."""
    import pyotp

    client = tc["client"]
    user, secret = await _make_admin(tc, "replay", with_totp=True)
    code = pyotp.TOTP(secret).now()
    r1 = await _login(client, user.email, totp_code=code)
    assert r1.status_code == 200, r1.text
    # همان کد، دوباره — حتی اگر مرز ۳۰ ثانیه رد شده باشد، گامِ منطبق همان
    # است و باید به‌عنوان «تکراری» رد شود (نه «نامعتبر»)
    r2 = await _login(client, user.email, totp_code=code)
    assert r2.status_code == 401, r2.text
    assert r2.json()["error"]["code"] == "code_reused"


async def test_expired_totp_code_rejected(tc):
    """کد TOTP منقضی (سه گام قدیمی‌تر) → 401."""
    import pyotp

    client = tc["client"]
    user, secret = await _make_admin(tc, "expired", with_totp=True)
    old_code = pyotp.TOTP(secret).at(int(time.time()) - 120)
    r = await _login(client, user.email, totp_code=old_code)
    assert r.status_code == 401, r.text


async def test_invalid_totp_code_rejected(tc):
    """کد TOTP نادرست → 401 (نگهبان رگرسیون)."""
    client = tc["client"]
    user, _ = await _make_admin(tc, "badt2", with_totp=True)
    r = await _login(client, user.email, totp_code="000000")
    assert r.status_code == 401, r.text


async def test_admin_roles_endpoint_rate_limited(tc):
    """§۷: عملیات ادمین پرتکرار (تغییر نقش) سهمیه‌بندی است → 429 پس از سقف."""
    import pyotp

    from app.models.models import User

    client = tc["client"]
    admin, secret = await _make_admin(tc, "rl", with_totp=True)
    async with tc["maker"]() as db:
        await _ensure_role_perm(db, "admin", "roles.manage")
        # قربانی جدا — تا ابطال نشستِ ناشی از تغییر نقش، توکن ادمین را نکشد
        victim = User(
            full_name="قربانی",
            email=f"rlvictim-{_uid()}@example.com",
            password_hash="x",
            is_active=True,
        )
        db.add(victim)
        await db.commit()
        victim_id = str(victim.id)
    ra = await _login(client, admin.email, totp_code=pyotp.TOTP(secret).now())
    assert ra.status_code == 200, ra.text
    headers = {"Authorization": f"Bearer {ra.json()['access_token']}"}

    statuses = []
    for _ in range(22):
        r = await client.patch(
            f"{BASE}/admin/users/{victim_id}/roles",
            json={"role_names": ["admin"]},
            headers=headers,
        )
        statuses.append(r.status_code)
    assert 429 in statuses, statuses
    # ۲۰ تای اول موفق‌اند (سقف ۲۰ در دقیقه)
    assert statuses[:20] == [200] * 20, statuses
