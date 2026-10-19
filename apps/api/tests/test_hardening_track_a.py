"""تست‌های امنیتی Track A — hardening/audit-pass-1.

هر تست یک حمله/سوءاستفادهٔ واقعی را شبیه‌سازی می‌کند و باید FAIL-then-PASS
باشد: پیش از رفع، تست قرمز است (آسیب تأیید می‌شود)؛ پس از رفع، سبز.

بخش‌ها:
  A) اجرای سمت-سرور TOTP برای ادمین (قرارداد فاز ۰ §۲)
  B) رفرش‌توکن: race هم‌زمان (false logout) در برابر reuse واقعی
  C) اعتبارسنجی claimهای JWT (دست‌کاری، الگوریتم، type-confusion)
  D) آپلود کتابخانه: سقف حجم پیش از بار کامل RAM
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from sqlalchemy import select, update

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture(autouse=True)
def _reset_limits():
    from app.core.security import rate_limiter

    rate_limiter._hits.clear()
    rate_limiter._locked_until.clear()
    yield
    rate_limiter._hits.clear()
    rate_limiter._locked_until.clear()


# ---------------------------------------------------------------------------
# ابزارهای مشترک
# ---------------------------------------------------------------------------


async def _register(client, email, password="Str0ng!Pass"):
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست A",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email, password="Str0ng!Pass", **kw):
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": password, **kw},
    )
    return r


async def _get_or_create_admin_role(db):
    """نقش دقیقاً «admin» (نامی که PRIVILEGED_ROLE_NAMES می‌شناسد)."""
    from app.models.models import Permission, Role, RolePermission

    role = (
        await db.execute(select(Role).where(Role.name == "admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="admin", description="test admin role")
        db.add(role)
        await db.flush()
    perm = (
        await db.execute(
            select(Permission).where(Permission.key == "platform.settings")
        )
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="platform.settings", description="platform settings")
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
    return role


async def _make_privileged_user(tc, email_suffix: str, with_totp: bool = False):
    """ادمین واقعی از جدول‌ها؛ with_totp=True یعنی TOTP فعال."""
    import json

    import pyotp

    from app.core.security import hash_password
    from app.core.secrets import encrypt_value
    from app.models.models import User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        role = await _get_or_create_admin_role(db)
        await db.commit()
        user = User(
            full_name="ادمین تست A",
            email=f"admin-{email_suffix}-{suffix}@example.com",
            password_hash=hash_password("Str0ng!Pass"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        secret = None
        if with_totp:
            secret = pyotp.random_base32()
            user.totp_secret = json.dumps(encrypt_value(secret))
        await db.commit()
        return user, secret


def _scope_of(access_token: str) -> str:
    from app.core.config import get_settings

    payload = jwt.decode(
        access_token, get_settings().jwt_secret, algorithms=["HS256"]
    )
    return payload.get("scope", "full")


# ===========================================================================
# A) اجرای سمت-سرور TOTP برای ادمین
# ===========================================================================


async def test_admin_without_totp_cannot_reach_admin_endpoint(tc):
    """ادمین بدون TOTP: توکن محدود می‌گیرد و endpoint ادمین 403 می‌دهد."""
    client = tc["client"]
    user, _ = await _make_privileged_user(tc, "nototp")
    r = await _login(client, user.email)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["must_enroll_2fa"] is True
    assert _scope_of(body["access_token"]) == "2fa_setup"

    # حمله: با همین توکنِ «لاگین‌شده» رفتن سراغ endpoint ادمین
    r2 = await client.get(
        f"{BASE}/admin/settings",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert r2.status_code == 403, r2.text
    assert r2.json()["error"]["code"] == "requires_2fa"


async def test_limited_token_can_enroll_2fa_then_gets_full_access(tc):
    """توکن محدود فقط برای ثبت‌نام 2FA کار می‌کند؛ بعدش دسترسی کامل."""
    import pyotp

    client = tc["client"]
    user, _ = await _make_privileged_user(tc, "enroll")
    r = await _login(client, user.email)
    limited = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {limited}"}

    r2 = await client.post(f"{BASE}/auth/2fa/setup", headers=headers)
    assert r2.status_code == 200, r2.text
    secret = r2.json()["secret"]

    code = pyotp.TOTP(secret).now()
    r3 = await client.post(
        f"{BASE}/auth/2fa/enable",
        json={"secret": secret, "code": code},
        headers=headers,
    )
    assert r3.status_code == 200, r3.text

    # لاگین مجدد با کد TOTP → توکن کامل (کد گام بعد؛ گامِ ثبت‌نام با anti-replay
    # مصرف شده — valid_window=1 انحراف ‎±۱ گام را مجاز می‌داند)
    import time as _time

    r4 = await _login(
        client, user.email, totp_code=pyotp.TOTP(secret).at(int(_time.time()) + 30)
    )
    assert r4.status_code == 200, r4.text
    full = r4.json()["access_token"]
    assert _scope_of(full) == "full"

    r5 = await client.get(
        f"{BASE}/admin/settings", headers={"Authorization": f"Bearer {full}"}
    )
    assert r5.status_code == 200, r5.text


async def test_refresh_does_not_escalate_limited_token(tc):
    """refresh نباید توکن محدود را به کامل ارتقا دهد (تا وقتی TOTP ثبت نشده)."""
    client = tc["client"]
    user, _ = await _make_privileged_user(tc, "noescalate")
    r = await _login(client, user.email)
    refresh_token = r.json()["refresh_token"]

    r2 = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": refresh_token}
    )
    assert r2.status_code == 200, r2.text
    assert _scope_of(r2.json()["access_token"]) == "2fa_setup"

    r3 = await client.get(
        f"{BASE}/admin/settings",
        headers={"Authorization": f"Bearer {r2.json()['access_token']}"},
    )
    assert r3.status_code == 403
    assert r3.json()["error"]["code"] == "requires_2fa"


async def test_invalid_totp_code_rejected(tc):
    """TOTP نادرست → 401 (نگهبان رگرسیون)."""
    client = tc["client"]
    user, secret = await _make_privileged_user(tc, "badt", with_totp=True)
    r = await _login(client, user.email, totp_code="000000")
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "requires_2fa"


async def test_regular_user_without_totp_keeps_full_access(tc):
    """کاربر عادی بدون TOTP: محدودیت 2FA شاملش نمی‌شود (نگهبان رگرسیون)."""
    client = tc["client"]
    email = f"regular-{_uid()}@example.com"
    await _register(client, email)
    r = await _login(client, email)
    assert r.status_code == 200, r.text
    assert _scope_of(r.json()["access_token"]) == "full"
    r2 = await client.get(
        f"{BASE}/users/me",
        headers={"Authorization": f"Bearer {r.json()['access_token']}"},
    )
    assert r2.status_code == 200, r2.text


# ===========================================================================
# B) رفرش‌توکن: race هم‌زمان در برابر reuse واقعی
# ===========================================================================


async def _login_pair(client, email):
    r = await _login(client, email)
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()["refresh_token"]


async def test_concurrent_refresh_does_not_log_user_out(tc):
    """دو رفرش هم‌زمان با یک توکن (دو تب) → هیچ‌کدام نباید نشست را باطل کند."""
    client = tc["client"]
    email = f"race-{_uid()}@example.com"
    await _register(client, email)
    access, refresh = await _login_pair(client, email)

    # رفرش اول موفق
    r1 = await client.post(f"{BASE}/auth/refresh", json={"refresh_token": refresh})
    assert r1.status_code == 200, r1.text
    t1 = r1.json()["refresh_token"]

    # رفرش دوم با همان توکن قدیمی، بلافاصله بعد از اولی (سناریوی دو تب):
    # نباید به‌عنوان سرقت تلقی و نشست باطل شود.
    r2 = await client.post(f"{BASE}/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 200, r2.text

    # نشست زنده است: access token قدیمی هنوز معتبر است
    r3 = await client.get(
        f"{BASE}/users/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert r3.status_code == 200, r3.text

    # جفت‌توکن جدید هم کار می‌کند
    r4 = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": r2.json()["refresh_token"]}
    )
    assert r4.status_code == 200, r4.text


async def test_real_reuse_detection_still_revokes_session(tc):
    """استفادهٔ مجدد واقعی (پس از پنجرهٔ grace) → نشست باطل می‌شود."""
    from app.modules.auth import service as auth_service
    from app.models.models import RefreshToken

    client = tc["client"]
    email = f"reuse-{_uid()}@example.com"
    await _register(client, email)
    access, refresh = await _login_pair(client, email)

    r1 = await client.post(f"{BASE}/auth/refresh", json={"refresh_token": refresh})
    assert r1.status_code == 200, r1.text

    # شبیه‌سازی گذر زمان: همهٔ توکن‌ها را قدیمی می‌کنیم تا از پنجرهٔ grace بیرون بروند
    async with tc["maker"]() as db:
        past = datetime.now(timezone.utc) - timedelta(
            seconds=auth_service.REUSE_DETECTION_GRACE_SECONDS + 60
        )
        await db.execute(update(RefreshToken).values(created_at=past))
        await db.commit()

    # حالا ارائهٔ دوبارهٔ توکن قدیمی = سرقت واقعی → 401 و ابطال نشست
    r2 = await client.post(f"{BASE}/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 401, r2.text

    r3 = await client.get(
        f"{BASE}/users/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert r3.status_code == 401, r3.text
    assert r3.json()["error"]["code"] == "session_revoked"


# ===========================================================================
# C) اعتبارسنجی claimهای JWT
# ===========================================================================


async def test_tampered_and_confused_tokens_rejected(tc):
    """توکن دست‌کاری‌شده، امضای اشتباه، alg=none، و type-confusion رد می‌شوند."""
    from app.core.config import get_settings
    from app.core.security import create_access_token

    client = tc["client"]
    email = f"jwt-{_uid()}@example.com"
    await _register(client, email)
    access, _ = await _login_pair(client, email)
    settings = get_settings()

    def _call(tok):
        return client.get(
            f"{BASE}/users/me", headers={"Authorization": f"Bearer {tok}"}
        )

    # ۱) دست‌کاری payload (تغییر sub بدون امضای مجدد)
    parts = access.split(".")
    import base64
    import json as _json

    payload = _json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
    real_sub = payload["sub"]
    forged = dict(payload)
    forged["sub"] = str(uuid.uuid4())
    forged_payload = (
        base64.urlsafe_b64encode(_json.dumps(forged).encode()).decode().rstrip("=")
    )
    r = await _call(f"{parts[0]}.{forged_payload}.{parts[2]}")
    assert r.status_code == 401, r.text

    # ۲) امضا با کلید اشتباه
    bad = jwt.encode(
        {"sub": real_sub, "type": "access", "scope": "full"},
        "wrong-secret",
        algorithm="HS256",
    )
    r = await _call(bad)
    assert r.status_code == 401, r.text

    # ۳) alg=none
    none_tok = jwt.encode(
        {"sub": real_sub, "type": "access", "scope": "full"},
        key="",
        algorithm="none",
    )
    r = await _call(none_tok)
    assert r.status_code == 401, r.text

    # ۴) type-confusion: توکن با type=refresh ولی امضای معتبر → رد می‌شود
    confused = jwt.encode(
        {"sub": real_sub, "type": "refresh", "scope": "full"},
        settings.jwt_secret,
        algorithm="HS256",
    )
    r = await _call(confused)
    assert r.status_code == 401, r.text

    # ۴ب) extra نمی‌تواند claimهای امنیتی را بازنویسی کند (دفاع در عمق)
    smuggled = create_access_token(real_sub, extra={"type": "refresh", "scope": "x"})
    smuggled_payload = jwt.decode(
        smuggled, settings.jwt_secret, algorithms=["HS256"]
    )
    assert smuggled_payload["type"] == "access"
    assert smuggled_payload["scope"] == "full"

    # ۵) توکن سالم هنوز کار می‌کند
    r = await _call(access)
    assert r.status_code == 200, r.text


# ===========================================================================
# D) آپلود کتابخانه: سقف حجم پیش از بار کامل RAM
# ===========================================================================


async def test_upload_size_cap_enforced_while_streaming():
    """خواندن جریانی: فایل بزرگ‌تر از سقف، بدون بار کامل در RAM رد می‌شود (413)."""
    from app.modules.library import service as lib_service

    class FakeUpload:
        def __init__(self, total: int, chunk: int = 65536):
            self._total = total
            self._chunk = chunk
            self._sent = 0
            self.max_buffered = 0

        async def read(self, n: int = -1):
            if self._sent >= self._total:
                return b""
            size = min(self._chunk if n < 0 else n, self._total - self._sent)
            self._sent += size
            self.max_buffered = max(self.max_buffered, self._sent)
            return b"x" * size

    limit = 1024 * 1024  # 1MB برای تست
    big = FakeUpload(total=3 * limit)
    try:
        await lib_service.read_upload_capped(big, limit)
    except Exception as exc:
        from app.core.errors import APIError

        assert isinstance(exc, APIError) and exc.status_code == 413
    else:
        raise AssertionError("expected 413 for oversized upload")
    # هرگز کل فایل خوانده نشد — سقف حداکثر با یک chunk تأخیر اعمال شد
    assert big._sent <= limit + 1024 * 1024
    assert big._sent < big._total

    small = FakeUpload(total=limit // 2)
    data = await lib_service.read_upload_capped(small, limit)
    assert len(data) == limit // 2
