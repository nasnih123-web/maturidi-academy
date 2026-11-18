"""تست‌های فاز B — تکمیل پروفایل، گیتینگ بخش‌ها، تنظیمات عمومی.

پوشش:
- GET /users/me فیلدهای فاز B را برمی‌گرداند (پروفایل ناقصِ پیش‌فرض:
  ثبت‌نام نام کامل دارد؛ چهار فیلد دیگر — عکس، تاریخ تولد، جنسیت،
  کشور — کم‌اند. تعریف پنج‌فیلدی: migration c2b0cc7d091a).
- PATCH /users/me با avatar_media_id ناموجود → 422؛ تکمیل هر پنج
  فیلد → profile_complete=true.
- اعتبارسنج پرچم‌های profile.* در _validate_json_setting.
- گیت فتوا: پرچم خاموش → ثبت پرسش آزاد؛ روشن + پروفایل ناقص → 403
  با کد profile_incomplete؛ روشن + پروفایل کامل → موفق.
- گیت حفاظ پیشرفته: روشن + پروفایل ناقص → ساخت آزمون 403.
- GET /settings/public هر دو پرچم را با پیش‌فرض false برمی‌گرداند.

اعتبارسنجی فیلدهای هویتی و آپلود عکس در test_profile_completion.py است.
"""
from __future__ import annotations

import uuid

import pytest

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _register_and_login(client) -> tuple[str, dict]:
    email = f"phaseb-{_uid()}@example.com"
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر فاز ب",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()


async def _make_media(tc) -> str:
    from app.models.models import MediaAsset

    async with tc["maker"]() as db:
        asset = MediaAsset(
            kind="image",
            storage_key=f"avatars/test-{_uid()}.png",
            mime_type="image/png",
            size_bytes=128,
            visibility="public",
        )
        db.add(asset)
        await db.commit()
        return str(asset.id)


async def _complete_profile(client, tc, token: str) -> None:
    """تکمیل هر پنج فیلد تعریف completeness (نام از ثبت‌نام هست)."""
    media_id = await _make_media(tc)
    r = await client.patch(
        f"{BASE}/users/me",
        json={
            "avatar_media_id": media_id,
            "date_of_birth": "1995-04-12",
            "gender": "male",
            "country_code": "IR",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["profile_complete"] is True


async def _settings_admin_token(tc) -> str:
    """کاربر با مجوز platform.settings + توکن دسترسی مستقیم."""
    from sqlalchemy import select

    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
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
        role = Role(name=f"phaseb_settings_{suffix}", description="test")
        db.add(role)
        await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        user = User(
            full_name="ادمین فاز ب",
            email=f"phaseb-admin-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        return create_access_token(str(user.id))


async def _set_flag(tc, key: str, value: bool) -> None:
    token = await _settings_admin_token(tc)
    client = tc["client"]
    r = await client.put(
        f"{BASE}/admin/settings",
        json={"settings": {key: value}},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text


async def test_me_profile_fields_and_avatar_validation(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    r = await client.get(f"{BASE}/users/me", headers=_auth(token))
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["avatar_media_id"] is None
    assert me["date_of_birth"] is None
    assert me["gender"] is None
    assert me["country_code"] is None
    assert me["profile_complete"] is False
    assert me["missing_profile_fields"] == [
        "avatar_media_id",
        "date_of_birth",
        "gender",
        "country_code",
    ]
    assert me["profile_required_sections"] == []

    # رسانهٔ ناموجود → 422 صادقانه (نه خطای FK در commit)
    r = await client.patch(
        f"{BASE}/users/me",
        json={"avatar_media_id": str(uuid.uuid4())},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text

    await _complete_profile(client, tc, token)
    r = await client.get(f"{BASE}/users/me", headers=_auth(token))
    assert r.json()["missing_profile_fields"] == []


def test_profile_flag_validation():
    from app.core.platform_settings import _validate_json_setting

    for key in (
        "profile.require_for_fatwa_question",
        "profile.require_for_hifz_advanced",
    ):
        assert _validate_json_setting(key, True) is True
        assert _validate_json_setting(key, "false") is False
        with pytest.raises(ValueError):
            _validate_json_setting(key, "yes")


async def test_public_settings_expose_profile_flags(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/settings/public")
    assert r.status_code == 200, r.text
    settings = r.json()["settings"]
    assert settings["profile.require_for_fatwa_question"] is False
    assert settings["profile.require_for_hifz_advanced"] is False


async def test_fatwa_question_gate(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    # پرچم خاموش: ثبت پرسش آزاد است.
    r = await client.post(
        f"{BASE}/fatwa/questions",
        json={"text": "حکم وضو با خون‌دماغ چیست؟"},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text

    await _set_flag(tc, "profile.require_for_fatwa_question", True)

    # /users/me حالا بخش الزامی را گزارش می‌کند.
    r = await client.get(f"{BASE}/users/me", headers=_auth(token))
    assert r.json()["profile_required_sections"] == ["fatwa_question"]

    # پروفایل ناقص → 403 با کد پایدار.
    r = await client.post(
        f"{BASE}/fatwa/questions",
        json={"text": "سؤال دوم برای تست گیت"},
        headers=_auth(token),
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "profile_incomplete"

    # پروفایل کامل → دوباره آزاد.
    await _complete_profile(client, tc, token)
    r = await client.post(
        f"{BASE}/fatwa/questions",
        json={"text": "سؤال سوم بعد از تکمیل پروفایل"},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text

    await _set_flag(tc, "profile.require_for_fatwa_question", False)


async def test_hifz_advanced_gate(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    await _set_flag(tc, "profile.require_for_hifz_advanced", True)
    r = await client.post(
        f"{BASE}/quran/hifz/tests",
        json={"surah_start": 1, "surah_end": 1, "question_count": 3},
        headers=_auth(token),
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "profile_incomplete"

    await _complete_profile(client, tc, token)
    r = await client.post(
        f"{BASE}/quran/hifz/tests",
        json={"surah_start": 1, "surah_end": 1, "question_count": 3},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text

    await _set_flag(tc, "profile.require_for_hifz_advanced", False)
