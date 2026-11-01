"""تست‌های میل‌استون polish — Track A (بک‌اند).

پوشش:
- اعتبارسنجی آپلود فونت (فایل سالم، پسوند بد، magic-byte بد، حجم زیاد،
  کاربر غیرادمین → 403، لوکیل نامعتبر)
- حذف فونت (بازگشت به داخلی + حذف فایل)
- bump نسخهٔ تنظیمات با هر نوشتن + updated_at در GET
- seed پیش‌فرض‌های particles / home.sections / hero / fonts
"""
from __future__ import annotations

import uuid

BASE = "/api/v1"
FONT_MAX = 5 * 1024 * 1024


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, identifier: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": identifier, "password": password}
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _make_super_admin(client, db_session, email: str) -> str:
    """کاربر با مجوز platform.settings (الگوی test_hardening)."""
    from sqlalchemy import select

    from app.core.platform_settings import reset_settings_cache
    from app.models.models import Permission, Role, RolePermission, UserRole

    reset_settings_cache()

    me = await _register(client, email)
    tokens = await _login(client, email)

    role = (
        await db_session.execute(select(Role).where(Role.name == "super_admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="super_admin", description="test")
        db_session.add(role)
        await db_session.flush()
    perm = (
        await db_session.execute(
            select(Permission).where(Permission.key == "platform.settings")
        )
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="platform.settings", description="test")
        db_session.add(perm)
        await db_session.flush()
    exists = (
        await db_session.execute(
            select(RolePermission).where(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == perm.id,
            )
        )
    ).first()
    if not exists:
        db_session.add(RolePermission(role_id=role.id, permission_id=perm.id))
        await db_session.flush()
    db_session.add(UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id))
    # remediation-pass-2 Track 1 (§۵): نقش ممتاز بدون TOTP با هیچ توکنی —
    # حتی full — به endpoint ادمین نمی‌رسد؛ پس helper سکرت TOTP هم می‌نشاند.
    import json

    import pyotp

    from app.core.secrets import encrypt_value
    from app.models.models import User as _User

    _u = (
        await db_session.execute(select(_User).where(_User.id == uuid.UUID(me["id"])))
    ).scalar_one()
    _u.totp_secret = json.dumps(encrypt_value(pyotp.random_base32()))
    await db_session.commit()
    reset_settings_cache()
    return tokens["access_token"]


def _woff2(size: int = 64) -> bytes:
    return b"wOF2" + b"\x00" * (size - 4)


# ---------------------------------------------------------------------------
# نسخهٔ تنظیمات + seed پیش‌فرض‌ها
# ---------------------------------------------------------------------------


async def test_settings_version_bump_on_write(tc, db_session):
    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="polish1@example.com")
    client = tc["client"]

    r = await client.get(f"{BASE}/admin/settings", headers=_auth(token))
    assert r.status_code == 200, r.text
    v0 = r.json()["version"]

    r = await client.put(
        f"{BASE}/admin/settings",
        headers=_auth(token),
        json={"settings": {"particles": {"count": 50}}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["updated"] == ["particles"]
    assert body["version"] == v0 + 1

    r = await client.get(f"{BASE}/admin/settings", headers=_auth(token))
    data = {s["key"]: s for s in r.json()["settings"]}
    assert r.json()["version"] == v0 + 1
    # پیش‌فرض‌ها برای فیلدهای ارسال‌نشده پر شده‌اند
    assert data["particles"]["value"] == {
        "enabled": True,
        "count": 50,
        "speed": 1.0,
        "parallax": 1.0,
        "lines": True,
    }
    # تسک #۲: هر آیتم updated_at دارد
    assert data["particles"]["updated_at"] is not None


async def test_settings_invalid_particles_rejected(tc, db_session):
    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="polish2@example.com")
    client = tc["client"]

    r = await client.put(
        f"{BASE}/admin/settings",
        headers=_auth(token),
        json={"settings": {"particles": {"count": -1}}},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_setting_value"

    r = await client.put(
        f"{BASE}/admin/settings",
        headers=_auth(token),
        json={"settings": {"particles": {"bogus_field": 1}}},
    )
    assert r.status_code == 400

    r = await client.put(
        f"{BASE}/admin/settings",
        headers=_auth(token),
        json={"settings": {"home.sections": [{"id": "x", "variant": "", "enabled": True}]}},
    )
    assert r.status_code == 400


async def test_seed_polish_defaults(tc, db_session):
    from sqlalchemy import delete

    from app.core.platform_settings import (
        get_typed_setting,
        reset_settings_cache,
    )
    from app.models.models import PlatformSetting
    from app.seed import seed_platform_settings_defaults

    # شبیه‌سازی نصب تازه: کلیدهای polish + فاز ۵ را پاک می‌کنیم
    # (بقیهٔ تست‌ها ممکن است ست کرده باشند)
    polish_keys = [
        "particles", "fonts.fa", "fonts.ar", "fonts.en", "home.sections",
        "hero.fa", "hero.ar", "hero.en",
        # فاز ۵ (Track 1): قرآن / مناجات
        "quran.provider", "quran.translations", "quran.tafsirs", "quran.reciters",
        "quran.active_languages", "quran.show_translation", "quran.show_tafsir",
        "quran.highlight_mode", "quran.font_size", "quran.playback",
        "munajat.enabled", "munajat.window",
        # یکپارچه‌سازی coordinator: پیش‌فرض اذان
        "adhan.defaults",
        # فاز ۶: موتور فتوای هوشمند
        "ai.provider", "ai.claude_model", "ai.daily_quota_per_user",
        "ai.rate_per_minute", "ai.external_research_enabled",
        "ai.stream_timeout_s", "ai.embedding_provider",
        "ai.embedding_endpoint", "ai.embedding_model",
        # فاز ۹: کتابخانهٔ چندرسانه‌ای
        "media.auto_pipeline", "media.ocr_langs",
    ]
    await db_session.execute(delete(PlatformSetting).where(PlatformSetting.key.in_(polish_keys)))
    await db_session.commit()
    reset_settings_cache()

    seeded = await seed_platform_settings_defaults(db_session)
    await db_session.commit()
    reset_settings_cache()
    assert sorted(seeded) == sorted(polish_keys)

    particles = await get_typed_setting(db_session, "particles")
    assert particles == {
        "enabled": True,
        "count": 100,
        "speed": 1.0,
        "parallax": 1.0,
        "lines": True,
    }

    sections = await get_typed_setting(db_session, "home.sections")
    assert isinstance(sections, list) and len(sections) == 9
    assert all(s["enabled"] is True and s["id"] and s["variant"] for s in sections)
    assert sections[0]["id"] == "live_status"

    for locale, title in (
        ("fa", "آکادمی ماتریدی"),
        ("ar", "أكاديمية الماتريدي"),
        ("en", "Maturidi Academy"),
    ):
        hero = await get_typed_setting(db_session, f"hero.{locale}")
        assert hero["title"] == title, locale
        assert hero["subtitle"]
        assert hero["primary_cta"]["label"] and hero["primary_cta"]["href"]
        assert hero["secondary_cta"]["label"] and hero["secondary_cta"]["href"]
        assert await get_typed_setting(db_session, f"fonts.{locale}") is None

    # idempotent: اجرای دوم چیزی seed نمی‌کند
    reset_settings_cache()
    seeded_again = await seed_platform_settings_defaults(db_session)
    await db_session.commit()
    assert seeded_again == []
    reset_settings_cache()


# ---------------------------------------------------------------------------
# آپلود فونت
# ---------------------------------------------------------------------------


async def test_font_upload_ok_and_delete(tc, db_session):
    from app.modules.admin.service import STATIC_DIR

    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="font1@example.com")
    client = tc["client"]

    r = await client.post(
        f"{BASE}/admin/fonts",
        headers=_auth(token),
        data={"locale": "fa", "family": "فونت تست"},
        files={"file": ("test.woff2", _woff2(), "font/woff2")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["locale"] == "fa"
    assert body["family"] == "فونت تست"
    assert body["url"].startswith("/static/fonts/fa/")
    assert body["url"].endswith(".woff2")
    assert isinstance(body["version"], int)

    # فایل واقعاً روی دیسک است و از /static سرو می‌شود
    disk_path = STATIC_DIR / body["url"].removeprefix("/static/")
    assert disk_path.is_file()
    r = await client.get(body["url"])
    assert r.status_code == 200
    assert r.content[:4] == b"wOF2"

    # fonts.fa در GET تنظیمات ست شده
    r = await client.get(f"{BASE}/admin/settings", headers=_auth(token))
    data = {s["key"]: s for s in r.json()["settings"]}
    assert data["fonts.fa"]["value"] == {"family": "فونت تست", "url": body["url"]}

    # حذف → بازگشت به داخلی
    r = await client.delete(f"{BASE}/admin/fonts/fa", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["family"] is None and r.json()["url"] is None
    assert not disk_path.exists()

    r = await client.get(f"{BASE}/admin/settings", headers=_auth(token))
    data = {s["key"]: s for s in r.json()["settings"]}
    assert data["fonts.fa"]["value"] is None


async def test_font_upload_bad_extension(tc, db_session):
    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="font2@example.com")
    client = tc["client"]
    r = await client.post(
        f"{BASE}/admin/fonts",
        headers=_auth(token),
        data={"locale": "fa", "family": "X"},
        files={"file": ("x.otf", _woff2(), "font/otf")},
    )
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "invalid_font_extension"
    assert "request_id" in r.json()


async def test_font_upload_bad_magic(tc, db_session):
    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="font3@example.com")
    client = tc["client"]
    r = await client.post(
        f"{BASE}/admin/fonts",
        headers=_auth(token),
        data={"locale": "ar", "family": "X"},
        files={"file": ("x.woff2", b"XXXX" + b"\x00" * 60, "font/woff2")},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_font_file"


async def test_font_upload_too_large(tc, db_session):
    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="font4@example.com")
    client = tc["client"]
    big = b"wOF2" + b"\x00" * (FONT_MAX + 1 - 4)
    r = await client.post(
        f"{BASE}/admin/fonts",
        headers=_auth(token),
        data={"locale": "en", "family": "Big"},
        files={"file": ("big.woff2", big, "font/woff2")},
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "font_too_large"


async def test_font_upload_invalid_locale(tc, db_session):
    token = await _make_super_admin(client=tc["client"], db_session=db_session, email="font5@example.com")
    client = tc["client"]
    r = await client.post(
        f"{BASE}/admin/fonts",
        headers=_auth(token),
        data={"locale": "xx", "family": "X"},
        files={"file": ("x.woff2", _woff2(), "font/woff2")},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_locale"


async def test_font_upload_forbidden_for_plain_user(tc, db_session):
    client = tc["client"]
    await _register(client, "plainfont@example.com")
    tokens = await _login(client, "plainfont@example.com")
    r = await client.post(
        f"{BASE}/admin/fonts",
        headers=_auth(tokens["access_token"]),
        data={"locale": "fa", "family": "X"},
        files={"file": ("x.woff2", _woff2(), "font/woff2")},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"

    r = await client.delete(
        f"{BASE}/admin/fonts/fa", headers=_auth(tokens["access_token"])
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# endpoint عمومی تنظیمات (polish #3 — وب آن را در هر ریکوئست می‌خواند)
# ---------------------------------------------------------------------------


async def test_settings_public_returns_whitelisted_keys(tc, db_session):
    client = tc["client"]

    r = await client.get(f"{BASE}/settings/public")
    assert r.status_code == 200, r.text
    body = r.json()

    expected = {
        "particles",
        "fonts.fa",
        "fonts.ar",
        "fonts.en",
        "hero.fa",
        "hero.ar",
        "hero.en",
        "home.sections",
        # maps phase: CRM-controlled map popup shape (public by design).
        "places.popup",
        # globe phase: extensible place types + default globe view.
        "places.types",
        "places.globe",
        # Quran UX rework: CRM display-tab defaults (non-sensitive
        # display preferences; also fixes the pre-existing gap where
        # CRM madhhab/speed/photo choices never reached the web).
        "quran.madhhab_default",
        "quran.player_default_speed",
        "quran.player_show_photo",
        "quran.waveform_style",
    }
    assert set(body["settings"].keys()) == expected
    # هیچ کلید حساسی لو نرفته
    assert "jwt_secret" not in body["settings"]
    assert "smtp_password" not in body["settings"]
    assert "version" in body
    # مقادیر پیش‌فرض معتبر
    assert body["settings"]["particles"]["enabled"] is True


async def test_settings_public_reflects_crm_write(tc, db_session):
    """نوشتن از CRM (ادمین) بلافاصله در endpoint عمومی دیده می‌شود."""
    client = tc["client"]
    email = f"pub-{uuid.uuid4().hex[:8]}@example.com"
    token = await _make_super_admin(client, db_session, email)

    r = await client.put(
        f"{BASE}/admin/settings",
        headers=_auth(token),
        json={"settings": {"particles": {"count": 7, "enabled": False}}},
    )
    assert r.status_code == 200, r.text
    new_version = r.json()["version"]

    r = await client.get(f"{BASE}/settings/public")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["settings"]["particles"]["count"] == 7
    assert body["settings"]["particles"]["enabled"] is False
    assert body["version"] == new_version
