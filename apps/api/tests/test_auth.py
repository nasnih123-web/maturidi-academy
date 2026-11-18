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


async def _set_sms_countries(tc, countries: list[str]) -> None:
    """تنظیم فهرست «تأیید پیامکی اجباری» (auth.sms_required_countries) از مسیر واقعی API تنظیمات."""
    from sqlalchemy import select

    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = uuid.uuid4().hex[:8]
    async with tc["maker"]() as db:
        perm = (
            await db.execute(
                select(Permission).where(Permission.key == "platform.settings")
            )
        ).scalar_one_or_none()
        if perm is None:
            perm = Permission(key="platform.settings", description="test")
            db.add(perm)
            await db.flush()
        role = Role(name=f"auth_settings_{suffix}", description="test")
        db.add(role)
        await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        admin = User(
            full_name="ادمین تنظیمات",
            email=f"auth-admin-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(admin)
        await db.flush()
        db.add(UserRole(user_id=admin.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(admin.id))
    r = await tc["client"].put(
        f"{BASE}/admin/settings",
        json={"settings": {"auth.sms_required_countries": countries}},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text


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
    from sqlalchemy import select

    from app.models.models import Permission, Role, RolePermission, UserRole

    client = tc["client"]

    # ساخت نقش/مجوز مستقیم در دیتابیس
    # نام نقش عمداً غیرممتاز است (نه admin/super_admin) تا این تست منطق
    # require_permission را بسنجد، نه مسیر 2FA نقش‌های ممتاز (ADR-0020).
    # مجوز users.manage ممکن است از تست دیگری در دیتابیس مشترک مانده
    # باشد — get-or-create تا ترتیب اجرای فایل‌ها مهم نباشد.
    role = Role(name="user_manager", description="test")
    perm = (
        await db_session.execute(
            select(Permission).where(Permission.key == "users.manage")
        )
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="users.manage", description="test")
        db_session.add(perm)
    db_session.add(role)
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


# ---------- فاز A: ثبت‌نام بدون رمز (تأیید اول، رمز بعد) ----------


async def _register_passwordless(client, email, phone=None):
    body = {
        "full_name": "کاربر وب",
        "email": email,
        "locale": "fa",
        "accept_terms": True,
    }
    if phone:
        body["phone"] = phone
    r = await client.post(f"{BASE}/auth/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _last_verify_token(sent, email):
    body = [
        e["body"] for e in sent["emails"] if e["to"] == email and "verify_token=" in e["body"]
    ][-1]
    m = re.search(r"verify_token=([A-Za-z0-9\-_]+)", body)
    assert m
    return m.group(1)


async def test_passwordless_registration_email_flow(tc):
    client, sent = tc["client"], tc["sent"]
    email = "webflow@example.com"
    me = await _register_passwordless(client, email, phone="+93700123456")
    assert me["is_verified"] is False

    # تا تکمیل ثبت‌نام، ورود با هر رمزی 403 «نیمه‌کاره» است
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "Whatever123"}
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "registration_incomplete"

    # تأیید ایمیل (شماره غیرایرانی) → توکن ست‌کردن رمز
    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "verified"
    assert out["setup_token"]

    # ست‌کردن رمز → ورود خودکار (جفت توکن)
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": out["setup_token"], "new_password": "MyNewPass123"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]

    # توکن تکمیل یک‌بارمصرف است
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": out["setup_token"], "new_password": "MyNewPass123"},
    )
    assert r.status_code == 400

    # ورود عادی با رمز ست‌شده کار می‌کند
    await _login(client, email, password="MyNewPass123")


async def test_passwordless_registration_iran_phone_requires_sms(tc):
    client, sent = tc["client"], tc["sent"]
    email = "iranflow@example.com"
    phone = "+989121112233"
    await _set_sms_countries(tc, ["IR"])
    await _register_passwordless(client, email, phone=phone)

    # وقتی ایران در فهرست «تأیید پیامکی اجباری» CRM است، تأیید ایمیل کافی نیست
    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "phone_required"
    assert out["setup_token"] is None
    assert out["phone_hint"]

    # درخواست کد پیامکی + کد اشتباه → 400
    r = await client.post(f"{BASE}/auth/register/phone-code/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    sms = [s for s in sent["sms"] if s["phone"] == phone][-1]
    m = re.search(r"(\d{6})", sms["message"])
    assert m
    r = await client.post(
        f"{BASE}/auth/register/phone-code/verify",
        json={"phone": phone, "code": "000000"},
    )
    assert r.status_code == 400

    # کد درست → توکن ست‌کردن رمز → تکمیل و ورود
    r = await client.post(
        f"{BASE}/auth/register/phone-code/verify",
        json={"phone": phone, "code": m.group(1)},
    )
    assert r.status_code == 200, r.text
    setup_token = r.json()["setup_token"]
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": setup_token, "new_password": "IranPass123"},
    )
    assert r.status_code == 200, r.text
    await _login(client, email, password="IranPass123")


async def test_passwordless_phone_only_completion(tc):
    # شمارهٔ غیرایرانی با پیامک هم می‌تواند به‌تنهایی ثبت‌نام را کامل کند
    client, sent = tc["client"], tc["sent"]
    email = "smsflow@example.com"
    phone = "+905301112233"
    await _register_passwordless(client, email, phone=phone)

    r = await client.post(f"{BASE}/auth/register/phone-code/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    sms = [s for s in sent["sms"] if s["phone"] == phone][-1]
    code = re.search(r"(\d{6})", sms["message"]).group(1)
    r = await client.post(
        f"{BASE}/auth/register/phone-code/verify", json={"phone": phone, "code": code}
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": r.json()["setup_token"], "new_password": "SmsPass123"},
    )
    assert r.status_code == 200, r.text
    await _login(client, phone, password="SmsPass123")


async def test_passwordless_reregister_resends_and_completed_conflicts(tc):
    client, sent = tc["client"], tc["sent"]
    email = "resendflow@example.com"
    await _register_passwordless(client, email, phone="+93700999888")
    first_token = _last_verify_token(sent, email)

    # ثبت‌نام دوبارهٔ همان ایمیل در وضعیت نیمه‌کاره → 201 و لینک تازه
    await _register_passwordless(client, email, phone="+93700999888")
    second_token = _last_verify_token(sent, email)
    assert second_token != first_token

    # توکن قبلی باطل نمی‌شود: لینک ایمیل اول بعد از ارسالِ دوباره هم کار
    # می‌کند (در Gmail همهٔ ایمیل‌های تأیید زیر یک نخ‌اند و کاربر ممکن
    # است روی پیام قدیمی‌تر کلیک کند)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": first_token})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "verified"

    # توکن تازه هم کار می‌کند و ثبت‌نام با توکن تکمیلِ آن کامل می‌شود
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": second_token})
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": r.json()["setup_token"], "new_password": "DonePass123"},
    )
    assert r.status_code == 200, r.text

    # بعد از تکمیل، ثبت‌نام دوباره → 409
    r = await client.post(
        f"{BASE}/auth/register",
        json={"full_name": "دوباره", "email": email, "accept_terms": True},
    )
    assert r.status_code == 409


async def test_register_resend_endpoint(tc):
    client, sent = tc["client"], tc["sent"]
    email = "resendep@example.com"
    await _register_passwordless(client, email)
    before = len([e for e in sent["emails"] if e["to"] == email])

    r = await client.post(f"{BASE}/auth/register/resend", json={"identifier": email})
    assert r.status_code == 200, r.text
    after = [e for e in sent["emails"] if e["to"] == email]
    assert len(after) == before + 1

    # ناشناخته هم 200 بی‌صداست (ضد شمارش)
    r = await client.post(
        f"{BASE}/auth/register/resend", json={"identifier": "ghost@example.com"}
    )
    assert r.status_code == 200


async def test_register_verify_email_already_active(tc):
    # حساب قدیمی (با رمز) که وارد شده: تأیید از مسیر ثبت‌نام فقط «تأییدشده»
    # ثبت می‌کند و توکن ست‌کردن رمز نمی‌دهد.
    client, sent = tc["client"], tc["sent"]
    email = "active@example.com"
    await _register(client, email)
    await _login(client, email)
    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "already_active"
    assert out["setup_token"] is None


async def _expire_verify_token(tc, token):
    """انقضای ردیف توکن تأیید را در دیتابیس تست به گذشته می‌برد."""
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from app.core.security import hash_token
    from app.models.models import PasswordResetToken

    async with tc["maker"]() as session:
        await session.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.token_hash == hash_token(token))
            .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
        )
        await session.commit()


async def test_register_verify_email_second_click_resumes(tc):
    # کلیک دوم روی همان لینک (رفرش/ریماونت صفحهٔ تأیید) نباید
    # invalid_token بگیرد: جریان از سر گرفته می‌شود و توکن تکمیلِ تازه
    # می‌رسد (توکن تکمیلِ قبلی با صدور تازه باطل می‌شود).
    client, sent = tc["client"], tc["sent"]
    email = "doubleclick@example.com"
    await _register_passwordless(client, email, phone="+93700444555")
    token = _last_verify_token(sent, email)

    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "verified"
    first_setup = r.json()["setup_token"]
    assert first_setup

    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "verified"
    assert out["setup_token"] and out["setup_token"] != first_setup

    # توکن تکمیلِ تازه کار می‌کند و ورود ممکن می‌شود
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": out["setup_token"], "new_password": "ResumePass123"},
    )
    assert r.status_code == 200, r.text
    await _login(client, email, password="ResumePass123")


async def test_passwordless_registration_iran_phone_default_email_only(tc):
    # پیش‌فرض CRM (فهرست خالی): ایمیل برای شمارهٔ ایران هم کافی است —
    # پنل پیامک هنوز وصل نیست و مدیر هیچ کشوری را در فهرست نگذاشته.
    client, sent = tc["client"], tc["sent"]
    await _set_sms_countries(tc, [])
    email = "iranemail@example.com"
    phone = "+989121114455"
    await _register_passwordless(client, email, phone=phone)

    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "verified"
    assert out["setup_token"]


def test_sms_required_countries_validation():
    import pytest

    from app.core.platform_settings import _validate_json_setting

    assert _validate_json_setting("auth.sms_required_countries", []) == []
    assert _validate_json_setting(
        "auth.sms_required_countries", ["ir", "DE", "IR"]
    ) == ["DE", "IR"]
    with pytest.raises(ValueError):
        _validate_json_setting("auth.sms_required_countries", ["XX"])
    with pytest.raises(ValueError):
        _validate_json_setting("auth.sms_required_countries", "IR")


async def test_register_verify_email_second_click_iran_phone(tc):
    # برای کشورِ داخل فهرست پیامکی، کلیک دوم هم phone_required می‌ماند (نه 400)
    client, sent = tc["client"], tc["sent"]
    email = "doubleiran@example.com"
    phone = "+989351112233"
    await _set_sms_countries(tc, ["IR"])
    await _register_passwordless(client, email, phone=phone)
    token = _last_verify_token(sent, email)
    for _ in range(2):
        r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "phone_required"
        assert r.json()["setup_token"] is None
        assert r.json()["phone_hint"]


async def test_register_verify_email_reclick_after_completion(tc):
    # بعد از تکمیل ثبت‌نام، کلیک دوباره روی همان لینک → already_active
    client, sent = tc["client"], tc["sent"]
    email = "reclick@example.com"
    await _register_passwordless(client, email, phone="+93700666777")
    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{BASE}/auth/register/set-password",
        json={"setup_token": r.json()["setup_token"], "new_password": "FinalPass123"},
    )
    assert r.status_code == 200, r.text

    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "already_active"
    assert out["setup_token"] is None


async def test_register_verify_email_unknown_and_expired_tokens_400(tc):
    client, sent = tc["client"], tc["sent"]
    email = "expiredlink@example.com"
    await _register_passwordless(client, email)
    token = _last_verify_token(sent, email)

    # توکن ناشناخته → 400 invalid_token
    r = await client.post(
        f"{BASE}/auth/register/verify-email", json={"token": "no-such-token-000"}
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_token"

    # توکن واقعی ولی منقضی → 400 invalid_token
    await _expire_verify_token(tc, token)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_token"


async def test_register_verify_email_expired_after_use_no_resume(tc):
    # حتی توکنِ مصرف‌شده هم بعد از انقضا دیگر resume نمی‌شود
    client, sent = tc["client"], tc["sent"]
    email = "expiredresume@example.com"
    await _register_passwordless(client, email, phone="+93700888999")
    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 200, r.text

    await _expire_verify_token(tc, token)
    r = await client.post(f"{BASE}/auth/register/verify-email", json={"token": token})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_token"


async def test_verify_email_second_click_ok(tc):
    # مسیر سادهٔ verify-email هم در کلیک دوم موفقِ تکراری است، نه 400
    client, sent = tc["client"], tc["sent"]
    email = "plainreclick@example.com"
    await _register(client, email)
    token = _last_verify_token(sent, email)
    r = await client.post(f"{BASE}/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text


# ---------- تاب‌آوری در برابر خرابی سرویس ایمیل ----------


async def _raise_email(to, subject, body_text, body_html=None):
    raise RuntimeError("mail provider unavailable")


async def test_registration_survives_mail_provider_failure(tc):
    # خرابی SMTP نباید ثبت‌نام را 500 کند: حساب ساخته می‌شود (توکن تأیید
    # ذخیره شده و ارسال دوباره ممکن است) و ورود همچنان 403 نیمه‌کاره است.
    import app.core.email as email_mod

    client = tc["client"]
    email = "mailfail@example.com"

    original = email_mod.send_email
    email_mod.send_email = _raise_email
    try:
        me = await _register_passwordless(client, email)
    finally:
        email_mod.send_email = original
    assert me["email"] == email
    assert me["is_verified"] is False

    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "Whatever123"}
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "registration_incomplete"


async def test_password_reset_request_survives_mail_provider_failure(tc):
    # پاسخ عمومی بازیابی رمز حتی با SMTP خراب هم همان 200 معمول است.
    import app.core.email as email_mod

    client = tc["client"]
    email = "resetmailfail@example.com"
    await _register(client, email)

    original = email_mod.send_email
    email_mod.send_email = _raise_email
    try:
        r = await client.post(
            f"{BASE}/auth/password-reset/request", json={"email": email}
        )
    finally:
        email_mod.send_email = original
    assert r.status_code == 200, r.text
    assert r.json()["message"]
