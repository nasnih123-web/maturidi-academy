"""تست‌های تکمیل فاز B — ستون‌های هویتی پروفایل، آپلود عکس، migration.

پوشش:
- migration c2b0cc7d091a: روی دیتابیس خالی upgrade head از صفر (همان
  مسیر production در start.sh) → هر سه ستون روی users هست؛
  downgrade -1 → ستون‌ها نیستند؛ upgrade head دوباره → برگشته‌اند.
- PATCH /users/me: تاریخ تولد آینده/کهن → 422؛ جنسیت نامعتبر → 422؛
  کد کشور نامعتبر → 422؛ ناسازگاری کشور با کشور شمارهٔ تأییدشده → 422؛
  کشور سازگار → 200؛ بدون شماره → هر کشور معتبر 200.
- POST /users/me/avatar: PNG واقعی → MediaAsset ساخته و avatar ست
  می‌شود؛ بایت‌های غیرتصویر → 415.
- completeness پنج‌فیلدی قدم‌به‌قدم کامل می‌شود.
"""
from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

BASE = "/api/v1"
APPS_API = Path(__file__).resolve().parents[1]

# کوچک‌ترین بایت‌های معتبر از نظر sniff (امضای PNG + بدنهٔ صفر).
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _register_and_login(client) -> tuple[str, dict]:
    email = f"phaseb2-{_uid()}@example.com"
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تکمیل پروفایل",
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


async def _verified_phone_token(tc, phone: str) -> str:
    """کاربر با شمارهٔ تأییدشده (is_verified) + توکن دسترسی مستقیم."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import User

    async with tc["maker"]() as db:
        user = User(
            full_name="کاربر شماره‌دار",
            email=f"phaseb2-phone-{_uid()}@example.com",
            phone=phone,
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        return create_access_token(str(user.id))


# ---------------------------------------------------------------------------
# migration
# ---------------------------------------------------------------------------


def _users_columns(db_file: Path) -> set[str]:
    conn = sqlite3.connect(db_file)
    try:
        return {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    finally:
        conn.close()


def test_profile_identity_migration_up_down_up(monkeypatch, tmp_path):
    """همان الگوی drill بکاپ (test_infra_track_b): alembic روی SQLite."""
    from alembic.config import Config

    from alembic import command
    from app.core.config import get_settings

    monkeypatch.chdir(APPS_API)
    db_file = tmp_path / "profile_mig.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    get_settings.cache_clear()
    try:
        cfg = Config(str(APPS_API / "alembic.ini"))
        new_cols = {"date_of_birth", "gender", "country_code"}

        command.upgrade(cfg, "head")
        assert new_cols <= _users_columns(db_file)

        command.downgrade(cfg, "-1")
        assert not (new_cols & _users_columns(db_file))

        command.upgrade(cfg, "head")
        assert new_cols <= _users_columns(db_file)
    finally:
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# اعتبارسنجی PATCH
# ---------------------------------------------------------------------------


async def test_patch_identity_validation(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    # تاریخ تولد در آینده → 422
    r = await client.patch(
        f"{BASE}/users/me",
        json={"date_of_birth": "2999-01-01"},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text

    # تاریخ تولد با سن بالای ۱۲۰ سال → 422
    r = await client.patch(
        f"{BASE}/users/me",
        json={"date_of_birth": "1820-01-01"},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text

    # جنسیت خارج از مجموعهٔ مجاز → 422
    r = await client.patch(
        f"{BASE}/users/me", json={"gender": "other"}, headers=_auth(token)
    )
    assert r.status_code == 422, r.text

    # کد کشور خارج از مجموعهٔ وب → 422
    r = await client.patch(
        f"{BASE}/users/me", json={"country_code": "XX"}, headers=_auth(token)
    )
    assert r.status_code == 422, r.text

    # مقادیر معتبر (کاربر بدون شماره: هر کشور معتبر آزاد است؛ کد کوچک
    # هم به بزرگ نرمال می‌شود).
    r = await client.patch(
        f"{BASE}/users/me",
        json={
            "date_of_birth": "1990-05-20",
            "gender": "female",
            "country_code": "us",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["date_of_birth"] == "1990-05-20"
    assert me["gender"] == "female"
    assert me["country_code"] == "US"


async def test_patch_country_must_match_verified_phone(tc):
    client = tc["client"]
    token = await _verified_phone_token(tc, "+989121234567")

    # شمارهٔ ایران تأیید شده؛ کشور دیگر → 422
    r = await client.patch(
        f"{BASE}/users/me", json={"country_code": "US"}, headers=_auth(token)
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"

    # همان کشور شماره → 200
    r = await client.patch(
        f"{BASE}/users/me", json={"country_code": "IR"}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["country_code"] == "IR"


# ---------------------------------------------------------------------------
# آپلود عکس پروفایل
# ---------------------------------------------------------------------------


async def test_avatar_upload_sets_media_asset(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    r = await client.get(f"{BASE}/users/me", headers=_auth(token))
    user_id = r.json()["id"]
    assert "avatar_media_id" in r.json()["missing_profile_fields"]

    r = await client.post(
        f"{BASE}/users/me/avatar",
        files={"file": ("avatar.png", PNG_BYTES, "image/png")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["avatar_media_id"]
    assert "avatar_media_id" not in me["missing_profile_fields"]

    # MediaAsset واقعاً با مالکیت همین کاربر ساخته شده است.
    from sqlalchemy import select

    from app.models.models import MediaAsset

    async with tc["maker"]() as db:
        asset = (
            await db.execute(
                select(MediaAsset).where(
                    MediaAsset.id == uuid.UUID(me["avatar_media_id"])
                )
            )
        ).scalar_one()
    assert str(asset.owner_id) == user_id
    assert asset.kind == "image"
    assert asset.mime_type == "image/png"
    assert asset.size_bytes == len(PNG_BYTES)
    assert asset.storage_key.startswith("avatars/")


async def test_avatar_upload_rejects_non_image(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    r = await client.post(
        f"{BASE}/users/me/avatar",
        files={"file": ("fake.png", b"this is not an image at all", "image/png")},
        headers=_auth(token),
    )
    assert r.status_code == 415, r.text
    assert r.json()["error"]["code"] == "unsupported_avatar_image"


# ---------------------------------------------------------------------------
# completeness پنج‌فیلدی
# ---------------------------------------------------------------------------


async def test_completeness_five_fields_progression(tc):
    client = tc["client"]
    token, _ = await _register_and_login(client)

    r = await client.get(f"{BASE}/users/me", headers=_auth(token))
    assert r.json()["missing_profile_fields"] == [
        "avatar_media_id",
        "date_of_birth",
        "gender",
        "country_code",
    ]

    r = await client.patch(
        f"{BASE}/users/me",
        json={
            "date_of_birth": "1988-03-03",
            "gender": "male",
            "country_code": "TR",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["missing_profile_fields"] == ["avatar_media_id"]
    assert r.json()["profile_complete"] is False

    r = await client.post(
        f"{BASE}/users/me/avatar",
        files={"file": ("me.png", PNG_BYTES, "image/png")},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["missing_profile_fields"] == []
    assert r.json()["profile_complete"] is True
