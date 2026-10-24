"""تست‌های M-05: چرخش کلید رمزنگاری settings (ENCRYPTION_KEYS).

سناریوی کامل: نوشتن با v1 ← چرخش به v2 (map هر دو کلید) ← مقدار
قدیمی خوانا ← نوشتن تازه v2 ← reencrypt مهاجرت مقدار قدیمی به v2.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.key_rotation import reencrypt_all
from app.core.secrets import (
    decrypt_value,
    encrypt_value,
    envelope_version,
    reencrypt_envelope,
    reset_keys_cache,
)
from app.models.models import PlatformSetting, User

KEY_V1 = "rotation-test-key-version-one-0001"
KEY_V2 = "rotation-test-key-version-two-0002"


@pytest.fixture()
def key_config():
    """ذخیره/بازیابی کانفیگ کلید سراسری تست (singleton settings)."""
    s = get_settings()
    saved = (s.encryption_key, s.encryption_key_version, s.encryption_keys)
    yield s
    s.encryption_key, s.encryption_key_version, s.encryption_keys = saved
    reset_keys_cache()


def _set_v1(s) -> None:
    s.encryption_key = KEY_V1
    s.encryption_key_version = 1
    s.encryption_keys = ""
    reset_keys_cache()


def _rotate_to_v2(s) -> None:
    s.encryption_keys = json.dumps({"1": KEY_V1, "2": KEY_V2})
    s.encryption_key_version = 2
    # encryption_key عمداً همان v1 می‌ماند: نسخهٔ جاری از map خوانده می‌شود
    reset_keys_cache()


def test_full_rotation_cycle(key_config):
    s = key_config
    _set_v1(s)
    env_v1 = encrypt_value("secret-value")
    assert envelope_version(env_v1) == 1
    assert decrypt_value(env_v1) == "secret-value"

    _rotate_to_v2(s)
    # مقدار قدیمی هنوز خواناست
    assert decrypt_value(env_v1) == "secret-value"
    # نوشتن تازه با v2 است
    env_v2 = encrypt_value("fresh-value")
    assert envelope_version(env_v2) == 2
    assert decrypt_value(env_v2) == "fresh-value"
    # reencrypt مقدار قدیمی را به v2 می‌برد؛ جاری را دست نمی‌زند
    migrated = reencrypt_envelope(env_v1)
    assert migrated is not None
    assert envelope_version(migrated) == 2
    assert decrypt_value(migrated) == "secret-value"
    assert reencrypt_envelope(env_v2) is None


def test_old_key_dropped_old_values_unreadable(key_config):
    s = key_config
    _set_v1(s)
    env_v1 = encrypt_value("secret-value")
    # چرخش بدون نگه‌داشتن کلید v1 در map → عمداً unreadable
    s.encryption_keys = json.dumps({"2": KEY_V2})
    s.encryption_key_version = 2
    reset_keys_cache()
    with pytest.raises(ValueError, match="unsupported encryption key version"):
        decrypt_value(env_v1)


def test_unknown_version_rejected(key_config):
    _set_v1(key_config)
    with pytest.raises(ValueError, match="unsupported encryption key version"):
        decrypt_value({"v": 99, "data": "gAAAAABogus"})


async def test_reencrypt_all_migrates_settings_and_totp(tc, key_config):
    s = key_config
    _set_v1(s)
    maker = tc["maker"]
    my_key = f"rotation.test.{uuid.uuid4().hex[:6]}"
    async with maker() as db:
        db.add(
            PlatformSetting(
                key=my_key,
                value=encrypt_value("platform-secret"),
                encryption_key_version=1,
            )
        )
        user = User(
            full_name="کاربر چرخش",
            email=f"rotation-{uuid.uuid4().hex[:8]}@test.local",
            password_hash="x" * 60,
            is_active=True,
            is_verified=True,
            totp_secret=json.dumps(encrypt_value("totp-secret")),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        my_user_id = user.id
        setting_key = my_key

    _rotate_to_v2(s)
    async with maker() as db:
        result = await reencrypt_all(db)
        await db.commit()
    assert result["settings_rotated"] >= 1
    assert result["totp_rotated"] >= 1
    # نکته: «unreadable» سراسری assert نمی‌شود — DB مشترک تست‌ها ممکن
    # است ردیف‌هایی با کلید پیش‌فرض داشته باشد که با map این تست
    # عمداً unreadable شمرده می‌شوند؛ invariant واقعی، مهاجرت
    # ردیف‌های همین تست است:

    async with maker() as db:
        row = await db.get(PlatformSetting, setting_key)
        assert row is not None
        assert envelope_version(row.value) == 2
        assert row.encryption_key_version == 2
        assert decrypt_value(row.value) == "platform-secret"
        user = await db.get(User, my_user_id)
        assert user is not None and user.totp_secret
        env = json.loads(user.totp_secret)
        assert envelope_version(env) == 2
        assert decrypt_value(env) == "totp-secret"


async def _make_platform_admin(tc):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, UserRole

    async with tc["maker"]() as db:
        role = (
            await db.execute(select(Role).where(Role.name == "m05_admin"))
        ).scalar_one_or_none()
        if role is None:
            role = Role(name="m05_admin", description="test")
            db.add(role)
            await db.flush()
        perm = (
            await db.execute(
                select(Permission).where(Permission.key == "platform.settings")
            )
        ).scalar_one_or_none()
        if perm is None:
            perm = Permission(key="platform.settings", description="test")
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
            full_name="ادمین چرخش",
            email=f"m05-admin-{uuid.uuid4().hex[:8]}@test.local",
            password_hash=hash_password("x" * 12),
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        return create_access_token(str(user.id))


async def test_reencrypt_endpoint_requires_permission_and_reports_counts(
    tc, key_config
):
    _set_v1(key_config)
    client = tc["client"]
    r = await client.post("/api/v1/admin/settings/reencrypt")
    assert r.status_code in (401, 403)
    token = await _make_platform_admin(tc)
    r = await client.post(
        "/api/v1/admin/settings/reencrypt",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current_version"] == 1
    assert "settings_rotated" in body and "totp_rotated" in body
    # هیچ مقداری نباید در پاسخ باشد
    assert "data" not in r.text
