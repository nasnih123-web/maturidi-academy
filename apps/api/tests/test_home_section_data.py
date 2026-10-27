"""تست‌های endpoint ادمین دادهٔ بخش‌های خانه.

PUT /api/v1/admin/home/sections/{key}/data — جایگزینی کامل data یک بخش
(همان خلأیی که تا پیش از این، جمعیت اسلات‌های صفحهٔ اصلی را ناممکن کرده
بود: هیچ مسیر ادمینی برای نوشتن HomeSection.data وجود نداشت).
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _item(i: int, **over: object) -> dict:
    d: dict = {
        "id": f"demo-{i}",
        "title": {"fa": f"نمونهٔ {i}", "ar": f"عينة {i}", "en": f"Demo {i}"},
        "subtitle": {"fa": "نمونهٔ نمایشی", "ar": "عينة تجريبية", "en": "Demo sample"},
        "badge": {"fa": "نمایشی", "ar": "تجريبي", "en": "Demo"},
        "url": "/fa/library",
    }
    d.update(over)
    return d


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ RBAC واقعی از جدول‌ها (الگوی فاز ۱۰/۱۱/۱۴)."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role = Role(name=f"hsd_test_role_{suffix}", description="home section data test")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست دادهٔ بخش",
            email=f"hsd-{suffix}@example.com",
            phone=f"+98901{abs(hash(suffix)) % 10**7:07d}",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


async def _seed_sections(tc):
    from app.seed import seed_home_sections

    async with tc["maker"]() as db:
        await seed_home_sections(db)
        await db.commit()


async def test_admin_sets_section_data_and_public_get_reflects_it(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    items = [_item(i) for i in range(1, 4)]
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": items, "layout": "shelf"},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["key"] == "fresh_library"
    assert len(body["data"]["items"]) == 3
    assert body["data"]["layout"] == "shelf"

    pub = await tc["client"].get(f"{BASE}/home/sections")
    assert pub.status_code == 200
    sec = next(s for s in pub.json()["sections"] if s["key"] == "fresh_library")
    assert len(sec["data"]["items"]) == 3
    assert sec["data"]["items"][0]["title"]["fa"] == "نمونهٔ 1"


async def test_section_data_requires_auth(tc):
    await _seed_sections(tc)
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(1)]},
    )
    assert r.status_code == 401


async def test_section_data_requires_platform_settings_permission(tc):
    await _seed_sections(tc)
    outsider = await _make_user(tc, ("content.bulk",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(1)]},
        headers=outsider,
    )
    assert r.status_code == 403


async def test_section_data_unknown_key_404(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/no_such_section/data",
        json={"items": [_item(1)]},
        headers=admin,
    )
    assert r.status_code == 404


async def test_section_data_more_than_12_items_422(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(i) for i in range(13)]},
        headers=admin,
    )
    assert r.status_code == 422


async def test_section_data_empty_title_422(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(1, title={"fa": "", "ar": "", "en": "  "})]},
        headers=admin,
    )
    assert r.status_code == 422


async def test_section_data_unsafe_url_422(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(1, url="javascript:alert(1)")]},
        headers=admin,
    )
    assert r.status_code == 422


async def test_section_data_bad_layout_422(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(1)], "layout": "carousel"},
        headers=admin,
    )
    assert r.status_code == 422


async def test_seed_preserves_admin_saved_section_data(tc):
    """رگرسیون: اجرای دوبارهٔ seed نباید دادهٔ ذخیره‌شدهٔ بخش را پاک کند.

    تا پیش از اصلاح، seed_home_sections در هر بوت مقدار data را با مقدار spec
    (برای بیشتر بخش‌ها None) بازنویسی می‌کرد و هر استقرار مجدد API دادهٔ
    بخش‌های پرشده از پنل CRM را به null برمی‌گرداند.
    """
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    items = [_item(i) for i in range(1, 4)]
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": items, "layout": "shelf"},
        headers=admin,
    )
    assert r.status_code == 200, r.text

    await _seed_sections(tc)

    pub = await tc["client"].get(f"{BASE}/home/sections")
    assert pub.status_code == 200
    sec = next(s for s in pub.json()["sections"] if s["key"] == "fresh_library")
    assert sec["data"] is not None
    assert len(sec["data"]["items"]) == 3
    assert sec["data"]["items"][0]["title"]["fa"] == "نمونهٔ 1"


# ---------------------------------------------------------------------------
# Footer payload ({columns, brand} on the same endpoint, key "footer")
# ---------------------------------------------------------------------------


def _footer_payload(**over: object) -> dict:
    d: dict = {
        "columns": [
            {
                "heading": {"fa": "پلتفرم", "ar": "المنصة", "en": "Platform"},
                "links": [
                    {
                        "label": {"fa": "فتوا", "ar": "الفتوى", "en": "Fatwa"},
                        "href": "/fatwa",
                    },
                    {
                        "label": {"fa": "سایت بیرونی", "ar": "موقع خارجي", "en": "External"},
                        "href": "https://example.org/about",
                    },
                ],
            }
        ],
        "brand": {
            "tagline": {"fa": "شعار آزمایشی", "ar": "شعار تجريبي", "en": "Test tagline"},
            "rights": {"fa": "© {year} آزمون", "ar": "© {year} اختبار", "en": "© {year} test"},
        },
    }
    d.update(over)
    return d


async def test_footer_data_saved_and_public_get_reflects_it(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/footer/data",
        json=_footer_payload(),
        headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["key"] == "footer"
    # A footer save must not invent an items key.
    assert "items" not in body["data"]
    assert body["data"]["columns"][0]["links"][0]["href"] == "/fatwa"
    assert body["data"]["brand"]["tagline"]["fa"] == "شعار آزمایشی"

    pub = await tc["client"].get(f"{BASE}/home/sections")
    assert pub.status_code == 200
    sec = next(s for s in pub.json()["sections"] if s["key"] == "footer")
    assert sec["data"]["columns"][0]["links"][1]["href"] == "https://example.org/about"


async def test_footer_unsafe_href_422(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    payload = _footer_payload()
    payload["columns"][0]["links"][0]["href"] = "javascript:alert(1)"
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/footer/data",
        json=payload,
        headers=admin,
    )
    assert r.status_code == 422


async def test_footer_empty_payload_422(tc):
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/footer/data",
        json={},
        headers=admin,
    )
    assert r.status_code == 422


async def test_footer_columns_cleared_without_touching_items_sections(tc):
    """Saving footer columns, then an items section, keeps both payloads intact."""
    await _seed_sections(tc)
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/footer/data",
        json=_footer_payload(),
        headers=admin,
    )
    assert r.status_code == 200, r.text
    r = await tc["client"].put(
        f"{BASE}/admin/home/sections/fresh_library/data",
        json={"items": [_item(1)]},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    pub = await tc["client"].get(f"{BASE}/home/sections")
    secs = {s["key"]: s for s in pub.json()["sections"]}
    assert len(secs["footer"]["data"]["columns"]) == 1
    assert len(secs["fresh_library"]["data"]["items"]) == 1
    assert "columns" not in secs["fresh_library"]["data"]
