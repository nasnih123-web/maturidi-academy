"""فاز ۲ — چرخهٔ حیات کامل MFA (F-01/F-02).

- GET /2fa/status: انتقال‌های وضعیت (پیش/پس از فعال‌سازی، پس از disable)
- POST /2fa/enable: مسیر موفق، کد اشتباه، replay همان کد در همان گام
- POST /2fa/disable: بدون احراز مجدد رد می‌شود؛ با رمز+TOTP و با رمز+کد
  بازیابی موفق است؛ نشست‌های دیگر باطل و نشست جاری زنده می‌ماند
- POST /2fa/recovery/regenerate: مجموعهٔ قبلی باطل می‌شود؛ احراز با کد
  بازیابی همان کد را مصرف می‌کند و replay آن رد می‌شود
- POST /2fa/recover: کد بازیابی یک‌بارمصرف است (replay → 400)
- توکن عامل-اول (2fa_setup): فقط setup/enable/status (+logout) باز است؛
  /users/me و مسیرهای عادی و ws-ticket → 403
- rate limit روی تلاش‌های ناموفق disable → 429
- GET /users/me: نقش‌ها و مجوزهای واقعی RBAC را برمی‌گرداند
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pyotp
from sqlalchemy import select

BASE = "/api/v1"
PW = "Str0ng!Pass1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _totp(secret: str, offset_steps: int = 0) -> str:
    """کد TOTP برای گام فعلی + offset — برای عبور قطعی از ضد replay.

    بعد از هر مصرف موفق (enable/login/disable)، گام مصرف‌شده claim می‌شود؛
    کد گام بعدی هم داخل پنجرهٔ ±۱ سرور پذیرفته است و گامش بزرگ‌تر است.
    """
    when = datetime.now(UTC) + timedelta(seconds=30 * offset_steps)
    return pyotp.TOTP(secret).at(when)


async def _register(client, email: str) -> dict:
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست فاز۲",
            "email": email,
            "password": PW,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email: str, totp_code: str | None = None):
    payload: dict = {"identifier": email, "password": PW}
    if totp_code is not None:
        payload["totp_code"] = totp_code
    return await client.post(f"{BASE}/auth/login", json=payload)


async def _pair(client, email: str, totp_code: str | None = None) -> dict:
    r = await _login(client, email, totp_code)
    assert r.status_code == 200, r.text
    return r.json()


def _hdr(pair: dict) -> dict:
    return {"Authorization": f"Bearer {pair['access_token']}"}


async def _status(client, pair: dict):
    return await client.get(f"{BASE}/auth/2fa/status", headers=_hdr(pair))


async def _enroll_via_api(client, pair: dict) -> tuple[str, list[str]]:
    """ثبت‌نام کامل از مسیر API — برمی‌گرداند: (secret, recovery_codes)."""
    r = await client.post(f"{BASE}/auth/2fa/setup", headers=_hdr(pair))
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert r.json()["provisioning_uri"].startswith("otpauth://")
    r = await client.post(
        f"{BASE}/auth/2fa/enable",
        headers=_hdr(pair),
        json={"secret": secret, "code": _totp(secret)},
    )
    assert r.status_code == 200, r.text
    return secret, r.json()["recovery_codes"]


async def _make_user_with_role(tc, role_name: str, perm_key: str | None = None):
    """کاربر واقعی با نقش (و مجوز) واقعی در جدول‌های RBAC — بدون mock."""
    from app.core.security import hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    async with tc["maker"]() as db:
        role = (
            await db.execute(select(Role).where(Role.name == role_name))
        ).scalar_one_or_none()
        if role is None:
            role = Role(name=role_name, description="phase2 test")
            db.add(role)
            await db.flush()
        if perm_key:
            perm = (
                await db.execute(select(Permission).where(Permission.key == perm_key))
            ).scalar_one_or_none()
            if perm is None:
                perm = Permission(key=perm_key, description="phase2 test")
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
        user = User(
            full_name="کاربر نقش‌دار فاز۲",
            email=f"p2-{role_name}-{_uid()}@example.com",
            password_hash=hash_password(PW),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        return user


async def _enroll_in_db(tc, user_id: uuid.UUID, secret: str) -> list[str]:
    """فعال‌سازی مستقیم در DB با سکرت معلوم + کدهای بازیابی هش‌شده."""
    import json

    from app.core.secrets import encrypt_value
    from app.core.security import generate_recovery_codes, hash_token
    from app.models.models import RecoveryCode, User

    codes = generate_recovery_codes()
    async with tc["maker"]() as db:
        user = await db.get(User, user_id)
        assert user is not None
        user.totp_secret = json.dumps(encrypt_value(secret))
        user.totp_enabled_at = datetime.now(UTC)
        for code in codes:
            db.add(RecoveryCode(user_id=user.id, code_hash=hash_token(code)))
        await db.commit()
    return codes


async def _audit_actions(tc, user_id: uuid.UUID) -> list[str]:
    from app.models.models import AuditLog

    async with tc["maker"]() as db:
        rows = await db.execute(
            select(AuditLog.action).where(AuditLog.actor_id == user_id)
        )
        return list(rows.scalars().all())


# ---------------------------------------------------------------------------


async def test_status_transitions_and_enable_happy_path(tc):
    client = tc["client"]
    email = f"p2-life-{_uid()}@example.com"
    await _register(client, email)
    pair = await _pair(client, email)

    r = await _status(client, pair)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is False
    assert body["enrolled_at"] is None
    assert body["recovery_codes_remaining"] == 0

    _secret, codes = await _enroll_via_api(client, pair)
    assert len(codes) == 10

    r = await _status(client, pair)
    body = r.json()
    assert body["enabled"] is True
    assert body["enrolled_at"] is not None
    assert body["recovery_codes_remaining"] == 10


async def test_recovery_codes_stored_hashed_only(tc):
    client = tc["client"]
    email = f"p2-hash-{_uid()}@example.com"
    reg = await _register(client, email)
    pair = await _pair(client, email)
    _secret, codes = await _enroll_via_api(client, pair)

    from app.core.security import hash_token
    from app.models.models import RecoveryCode

    async with tc["maker"]() as db:
        rows = (
            await db.execute(
                select(RecoveryCode).where(
                    RecoveryCode.user_id == uuid.UUID(reg["id"])
                )
            )
        ).scalars().all()
    assert len(rows) == 10
    stored = {row.code_hash for row in rows}
    for code in codes:
        assert code not in stored  # متن ساده هرگز در DB نیست
        assert hash_token(code) in stored


async def test_enable_wrong_code_rejected(tc):
    client = tc["client"]
    email = f"p2-wrong-{_uid()}@example.com"
    await _register(client, email)
    pair = await _pair(client, email)
    r = await client.post(f"{BASE}/auth/2fa/setup", headers=_hdr(pair))
    secret = r.json()["secret"]
    # کدِ سکرتِ دیگر — قطعی غلط است (نه حدس روی 000000)
    wrong = _totp(pyotp.random_base32())
    if wrong == _totp(secret):  # احتمال ناچیز برخورد
        wrong = _totp(pyotp.random_base32())
    r = await client.post(
        f"{BASE}/auth/2fa/enable",
        headers=_hdr(pair),
        json={"secret": secret, "code": wrong},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "invalid_code"
    r = await _status(client, pair)
    assert r.json()["enabled"] is False


async def test_enable_replay_same_code_rejected(tc):
    client = tc["client"]
    email = f"p2-replay-{_uid()}@example.com"
    await _register(client, email)
    pair = await _pair(client, email)
    r = await client.post(f"{BASE}/auth/2fa/setup", headers=_hdr(pair))
    secret = r.json()["secret"]
    code = _totp(secret)
    r = await client.post(
        f"{BASE}/auth/2fa/enable",
        headers=_hdr(pair),
        json={"secret": secret, "code": code},
    )
    assert r.status_code == 200, r.text
    # همان کد در همان گام زمانی — ضد replay باید رد کند
    r = await client.post(
        f"{BASE}/auth/2fa/enable",
        headers=_hdr(pair),
        json={"secret": secret, "code": code},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "code_reused"


async def test_status_requires_auth(tc):
    r = await tc["client"].get(f"{BASE}/auth/2fa/status")
    assert r.status_code == 401


async def test_disable_requires_reauth_then_succeeds_with_totp(tc):
    client = tc["client"]
    secret = pyotp.random_base32()
    user = await _make_user_with_role(tc, "student")
    await _enroll_in_db(tc, user.id, secret)
    pair = await _pair(client, user.email, _totp(secret))

    # رمز اشتباه → 401
    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair),
        json={"password": "Wrong!Pass9", "code": _totp(secret, 1)},
    )
    assert r.status_code == 401, r.text
    # بدون عامل دوم → 400
    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair),
        json={"password": PW},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "second_factor_required"
    # کد TOTP اشتباه (از سکرت دیگر) → 400
    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair),
        json={"password": PW, "code": _totp(pyotp.random_base32())},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "invalid_code"
    # احراز کامل: رمز + کد گام بعد (گام فعلی در login مصرف شده) → 200
    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair),
        json={"password": PW, "code": _totp(secret, 1)},
    )
    assert r.status_code == 200, r.text

    r = await _status(client, pair)
    body = r.json()
    assert body["enabled"] is False
    assert body["enrolled_at"] is None
    assert body["recovery_codes_remaining"] == 0
    assert "user.2fa_disable" in await _audit_actions(tc, user.id)


async def test_disable_with_recovery_code_revokes_other_sessions(tc):
    client = tc["client"]
    secret = pyotp.random_base32()
    user = await _make_user_with_role(tc, "student")
    codes = await _enroll_in_db(tc, user.id, secret)

    pair_a = await _pair(client, user.email, _totp(secret))
    pair_b = await _pair(client, user.email, _totp(secret, 1))  # نشست دوم

    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair_a),
        json={"password": PW, "recovery_code": codes[0]},
    )
    assert r.status_code == 200, r.text

    # نشست جاری زنده است
    r = await _status(client, pair_a)
    assert r.status_code == 200, r.text
    # نشست دیگر باطل شده — access token آن مرده است
    r = await client.get(f"{BASE}/users/me", headers=_hdr(pair_b))
    assert r.status_code == 401, r.text


async def test_regenerate_invalidates_old_codes(tc):
    client = tc["client"]
    secret = pyotp.random_base32()
    user = await _make_user_with_role(tc, "student")
    old_codes = await _enroll_in_db(tc, user.id, secret)
    pair = await _pair(client, user.email, _totp(secret))

    r = await client.post(
        f"{BASE}/auth/2fa/recovery/regenerate",
        headers=_hdr(pair),
        json={"password": PW, "code": _totp(secret, 1)},
    )
    assert r.status_code == 200, r.text
    new_codes = r.json()["recovery_codes"]
    assert len(new_codes) == 10
    assert not set(new_codes) & set(old_codes)

    # کد قدیمی دیگر کار نمی‌کند — نه در recover، نه در هیچ مسیر دیگری
    r = await client.post(
        f"{BASE}/auth/2fa/recover",
        json={
            "email": user.email,
            "password": PW,
            "recovery_code": old_codes[0],
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "invalid_code"

    # وضعیت دست‌نخورده: هنوز فعال با ۱۰ کد تازه
    r = await _status(client, pair)
    assert r.json()["enabled"] is True
    assert r.json()["recovery_codes_remaining"] == 10
    assert "user.2fa_recovery_regenerate" in await _audit_actions(tc, user.id)

    # کد تازه کار می‌کند
    r = await client.post(
        f"{BASE}/auth/2fa/recover",
        json={
            "email": user.email,
            "password": PW,
            "recovery_code": new_codes[0],
        },
    )
    assert r.status_code == 200, r.text


async def test_recovery_code_consumed_by_regenerate_reauth_cannot_replay(tc):
    client = tc["client"]
    secret = pyotp.random_base32()
    user = await _make_user_with_role(tc, "student")
    codes = await _enroll_in_db(tc, user.id, secret)
    pair = await _pair(client, user.email, _totp(secret))

    # احراز مجدد با کد بازیابی: همان کد در همان تراکنش مصرف می‌شود
    r = await client.post(
        f"{BASE}/auth/2fa/recovery/regenerate",
        headers=_hdr(pair),
        json={"password": PW, "recovery_code": codes[3]},
    )
    assert r.status_code == 200, r.text
    # replay همان کد — این بار در disable — باید رد شود
    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair),
        json={"password": PW, "recovery_code": codes[3]},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "invalid_code"


async def test_recover_flow_code_is_single_use(tc):
    client = tc["client"]
    secret = pyotp.random_base32()
    user = await _make_user_with_role(tc, "student")
    codes = await _enroll_in_db(tc, user.id, secret)

    payload = {"email": user.email, "password": PW, "recovery_code": codes[0]}
    r = await client.post(f"{BASE}/auth/2fa/recover", json=payload)
    assert r.status_code == 200, r.text
    # همان کد بار دوم: دیگر معتبر نیست (2FA هم غیرفعال شده)
    r = await client.post(f"{BASE}/auth/2fa/recover", json=payload)
    assert r.status_code == 400, r.text


async def test_disable_rate_limit_kicks_in(tc):
    client = tc["client"]
    secret = pyotp.random_base32()
    user = await _make_user_with_role(tc, "student")
    await _enroll_in_db(tc, user.id, secret)
    pair = await _pair(client, user.email, _totp(secret))

    # سقف disable: ۱۰ تلاش در ۶۰۰ ثانیه برای هر کاربر
    for _ in range(10):
        r = await client.post(
            f"{BASE}/auth/2fa/disable",
            headers=_hdr(pair),
            json={"password": "Wrong!Pass9", "code": _totp(secret, 1)},
        )
        assert r.status_code == 401, r.text
    r = await client.post(
        f"{BASE}/auth/2fa/disable",
        headers=_hdr(pair),
        json={"password": PW, "code": _totp(secret, 1)},
    )
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "rate_limited"


async def test_restricted_scope_token_only_reaches_2fa_flow(tc):
    client = tc["client"]
    # ادمین بدون TOTP → توکن عامل-اول (2fa_setup)
    user = await _make_user_with_role(tc, "admin", "platform.settings")
    r = await _login(client, user.email)
    assert r.status_code == 200, r.text
    pair = r.json()
    assert pair["must_enroll_2fa"] is True

    # مسیرهای چرخهٔ ثبت‌نام باز است
    r = await _status(client, pair)
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] is False
    r = await client.post(f"{BASE}/auth/2fa/setup", headers=_hdr(pair))
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]

    # مسیرهای عادی API بسته است — از جمله پروفایل و بلیط وب‌سوکت
    r = await client.get(f"{BASE}/users/me", headers=_hdr(pair))
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "requires_2fa"
    r = await client.get(f"{BASE}/users/me/notifications", headers=_hdr(pair))
    assert r.status_code == 403, r.text
    r = await client.post(f"{BASE}/auth/ws-ticket", headers=_hdr(pair))
    assert r.status_code == 403, r.text

    # ثبت‌نام با همان توکن محدود کامل می‌شود
    r = await client.post(
        f"{BASE}/auth/2fa/enable",
        headers=_hdr(pair),
        json={"secret": secret, "code": _totp(secret)},
    )
    assert r.status_code == 200, r.text
    # ولی خودِ توکن محدود همچنان محدود است (scope در صدور قفل شده)
    r = await client.get(f"{BASE}/users/me", headers=_hdr(pair))
    assert r.status_code == 403, r.text

    # رفرش → توکن کامل؛ پروفایل با نقش/مجوز واقعی باز می‌شود
    r = await client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": pair["refresh_token"]}
    )
    assert r.status_code == 200, r.text
    full = r.json()
    r = await client.get(f"{BASE}/users/me", headers=_hdr(full))
    assert r.status_code == 200, r.text
    assert r.json()["roles"] == ["admin"]
    assert "platform.settings" in r.json()["permissions"]


async def test_me_exposes_roles_and_permissions(tc):
    client = tc["client"]
    # کاربر نقش‌دار غیرممتاز: /users/me نقش و مجوز واقعی را برمی‌گرداند
    # (مسیر ممتاز/ادمین در تست scope پوشش داده شده است).
    editor = await _make_user_with_role(tc, "editor", "content.publish")
    r = await client.get(
        f"{BASE}/users/me", headers=_hdr(await _pair(client, editor.email))
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["roles"] == ["editor"]
    assert body["permissions"] == ["content.publish"]

    # کاربر ساده: نقش/مجوز خالی — stub permissive دیگر وجود ندارد
    email = f"p2-plain-{_uid()}@example.com"
    await _register(client, email)
    r = await client.get(
        f"{BASE}/users/me", headers=_hdr(await _pair(client, email))
    )
    assert r.status_code == 200, r.text
    assert r.json()["roles"] == []
    assert r.json()["permissions"] == []
