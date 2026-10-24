"""تست‌های فاز ۱ — چرخهٔ کامل احراز هویت روی SQLite."""
from __future__ import annotations

import re
import uuid

import pyotp

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client, email, phone=None, password="TestPass123"):
    body = {
        "full_name": "کاربر تست",
        "email": email,
        "password": password,
        "locale": "fa",
        "accept_terms": True,
    }
    if phone:
        body["phone"] = phone
    r = await client.post(f"{BASE}/auth/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, identifier, password="TestPass123", totp_code=None):
    body = {"identifier": identifier, "password": password}
    if totp_code:
        body["totp_code"] = totp_code
    r = await client.post(f"{BASE}/auth/login", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def test_full_lifecycle(tc):
    client, sent = tc["client"], tc["sent"]
    email = "lifecycle@example.com"

    # 1) ثبت‌نام
    me = await _register(client, email)
    assert me["email"] == email
    assert me["is_verified"] is False

    # 2) ثبت‌نام تکراری → 409 با پاکت خطای یکدست
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "تکراری",
            "email": email,
            "password": "TestPass123",
            "accept_terms": True,
        },
    )
    assert r.status_code == 409
    body = r.json()
    assert body["error"]["code"] == "email_taken"
    assert "request_id" in body

    # 3) ورود
    tokens = await _login(client, email)
    assert tokens["token_type"] == "bearer"

    # 4) پروفایل
    r = await client.get(f"{BASE}/users/me", headers=_auth(tokens["access_token"]))
    assert r.status_code == 200
    assert r.json()["full_name"] == "کاربر تست"

    # 5) رضایت‌ها ثبت شده‌اند (terms + privacy)
    r = await client.get(f"{BASE}/users/me/consent", headers=_auth(tokens["access_token"]))
    assert r.status_code == 200
    types = {c["consent_type"] for c in r.json()}
    assert {"terms", "privacy"} <= types

    # 6) تأیید ایمیل از روی ایمیل ضبط‌شده
    email_body = next(e["body"] for e in sent["emails"] if e["to"] == email)
    m = re.search(r"verify_token=([A-Za-z0-9\-_]+)", email_body)
    assert m, "توکن تأیید در ایمیل پیدا نشد"
    r = await client.post(f"{BASE}/auth/verify-email", json={"token": m.group(1)})
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/users/me", headers=_auth(tokens["access_token"]))
    assert r.json()["is_verified"] is True

    # 7) رفرش با rotation — توکن قدیمی باید باطل شود
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200
    fresh = r.json()
    # استفادهٔ مجدد از توکن چرخش‌خورده — حتی بلافاصله — سرقت است
    # (B-02/ADR-0024: پنجرهٔ اغماض حذف شده؛ race دو تب با قفل رفرش
    # سمت کلاینت حل می‌شود، نه اغماض سمت سرور):
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "invalid_token"
    # نشست مرده است: حتی توکن‌های جدیدِ همان نشست هم باطل‌اند
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": fresh["refresh_token"]}
    )
    assert r.status_code == 401
    r = await client.get(f"{BASE}/users/me", headers=_auth(fresh["access_token"]))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "session_revoked"

    # ورود مجدد برای ادامهٔ چرخه
    tokens = await _login(client, email)

    # 8) خروج از همهٔ دستگاه‌ها — رفرش و access هم باید باطل شوند
    r = await client.post(
        f"{BASE}/auth/logout-all", headers=_auth(tokens["access_token"])
    )
    assert r.status_code == 200
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401
    r = await client.get(f"{BASE}/users/me", headers=_auth(tokens["access_token"]))
    assert r.status_code == 401

    # ورود مجدد برای ادامهٔ چرخه
    tokens = await _login(client, email)

    # 9) export دادهٔ شخصی (قبل از حذف)
    r = await client.post(
        f"{BASE}/users/me/export", headers=_auth(tokens["access_token"])
    )
    assert r.status_code == 200
    data = r.json()
    assert data["profile"]["email"] == email
    assert "password_hash" not in str(data)

    # 10) حذف حساب — بعدش ورود و پروفایل باید 401 بدهند
    r = await client.delete(
        f"{BASE}/users/me", headers=_auth(tokens["access_token"])
    )
    assert r.status_code == 200
    r = await client.get(f"{BASE}/users/me", headers=_auth(tokens["access_token"]))
    assert r.status_code == 401
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 401


async def test_phone_verification(tc):
    client, sent = tc["client"], tc["sent"]
    email = "phone@example.com"
    await _register(client, email)
    tokens = await _login(client, email)

    r = await client.post(
        f"{BASE}/auth/verify-phone/request",
        json={"phone": "+989123456789"},
        headers=_auth(tokens["access_token"]),
    )
    assert r.status_code == 200, r.text
    sms = next(s for s in sent["sms"] if s["phone"] == "+989123456789")
    m = re.search(r"(\d{6})", sms["message"])
    assert m, "کد پیامک پیدا نشد"

    r = await client.post(
        f"{BASE}/auth/verify-phone",
        json={"phone": "+989123456789", "code": m.group(1)},
        headers=_auth(tokens["access_token"]),
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/users/me", headers=_auth(tokens["access_token"]))
    assert r.json()["phone"] == "+989123456789"


async def test_password_reset(tc):
    client, sent = tc["client"], tc["sent"]
    email = "reset@example.com"
    await _register(client, email)

    r = await client.post(
        f"{BASE}/auth/password-reset/request", json={"email": email}
    )
    assert r.status_code == 200
    body = next(e["body"] for e in sent["emails"] if e["to"] == email and "reset_token=" in e["body"])
    m = re.search(r"reset_token=([A-Za-z0-9\-_]+)", body)
    assert m

    r = await client.post(
        f"{BASE}/auth/password-reset/confirm",
        json={"token": m.group(1), "new_password": "NewPass456"},
    )
    assert r.status_code == 200, r.text

    # رمز جدید کار می‌کند، رمز قدیمی نه
    await _login(client, email, password="NewPass456")
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 401


async def test_totp_2fa(tc):
    client, _ = tc["client"], tc["sent"]
    email = "totp@example.com"
    await _register(client, email)
    tokens = await _login(client, email)

    r = await client.post(f"{BASE}/auth/2fa/setup", headers=_auth(tokens["access_token"]))
    assert r.status_code == 200
    secret = r.json()["secret"]

    code = pyotp.TOTP(secret).now()
    r = await client.post(
        f"{BASE}/auth/2fa/enable",
        json={"secret": secret, "code": code},
        headers=_auth(tokens["access_token"]),
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["recovery_codes"]) == 10

    # بدون کد 2FA ورود ناموفق است
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "requires_2fa"

    # با کد معتبر موفق است — کد گامِ بعد (anti-replay گامِ ثبت‌نام را مصرف کرده؛
    # valid_window=1 انحراف ‎±۱ گام ساعت را مجاز می‌داند)
    import time as _time

    await _login(client, email, totp_code=pyotp.TOTP(secret).at(int(_time.time()) + 30))


async def test_admin_users_rbac(tc, db_session):
    from app.models.models import Permission, Role, RolePermission, UserRole

    client = tc["client"]

    # ساخت نقش/مجوز مستقیم در دیتابیس
    # نام نقش عمداً غیرممتاز است (نه admin/super_admin) تا این تست منطق
    # require_permission را بسنجد، نه مسیر 2FA نقش‌های ممتاز (ADR-0020).
    role = Role(name="user_manager", description="test")
    perm = Permission(key="users.manage", description="test")
    db_session.add_all([role, perm])
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission_id=perm.id))
    await db_session.commit()

    email = "admin@example.com"
    me = await _register(client, email)
    db_session.add(UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id))
    await db_session.commit()

    tokens = await _login(client, email)
    r = await client.get(f"{BASE}/admin/users", headers=_auth(tokens["access_token"]))
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) >= 1

    # کاربر بدون مجوز → 403
    plain = await _register(client, "plain@example.com")
    ptokens = await _login(client, "plain@example.com")
    r = await client.get(f"{BASE}/admin/users", headers=_auth(ptokens["access_token"]))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"
    _ = plain


async def test_meta_endpoints(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/themes/active")
    assert r.status_code == 200
    assert "name" in r.json()

    r = await client.get(f"{BASE}/i18n/detect", headers={"Accept-Language": "ar-SA,ar;q=0.9"})
    assert r.json()["locale"] == "ar"
    r = await client.get(f"{BASE}/i18n/detect", headers={"Accept-Language": "en-US"})
    assert r.json()["locale"] == "en"
