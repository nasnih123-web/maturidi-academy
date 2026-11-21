"""تست‌های فهرست مدیریتی کتابخانه (CRM) — صفحه‌بندی کرسری، فیلتر وضعیت، جست‌وجو.

پوشش:
- صفحه‌بندی: پیمایش با limit=20 و کرسر after تا انتها — بدون هم‌پوشانی بین
  صفحه‌ها و با پوشش کامل آیتم‌های ساخته‌شده (دیتابیس تست session-shared است).
- جست‌وجو (q) روی عنوان فارسی پیدا می‌کند — رگرسیون ADR-0033: LIKE روی ستون
  JSON به‌خاطر unicode-escape بودن ذخیره‌سازی، متن فارسی را پیدا نمی‌کرد.
- فیلتر status فقط آیتم‌های همان وضعیت گردش‌کار را برمی‌گرداند.
"""
from __future__ import annotations

import json
import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن با مجوزهای داده‌شده (الگوی test_library_phase9)."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (await db.execute(select(Permission).where(Permission.key == key))).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        test_role = Role(name=f"lib_list_role_{suffix}", description="library list test role")
        db.add(test_role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=test_role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فهرست کتابخانه",
            email=f"liblist-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=test_role.id))
        await db.commit()
        token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


async def _admin(tc):
    return await _make_user(tc, permissions=("library.manage",))


def _meta(kind: str, **over) -> dict:
    m = {
        "kind": kind,
        "title": _L(f"آیتم تست {kind}"),
        "description": _L("توضیح تست"),
        "topic_tags": ["test"],
        "visibility": "public",
    }
    m.update(over)
    return m


async def _create_video(client, headers, title: str, idx: int) -> str:
    """ساخت ویدیوی لینکی (بدون فایل) با عنوان مشخص؛ id برگردانده می‌شود."""
    meta = _meta(
        "video",
        title=_L(title),
        external_url=f"https://youtu.be/Pg{idx:09d}",
    )
    r = await client.post(
        f"{BASE}/admin/library/items",
        data={"metadata": json.dumps(meta)},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_admin_list_cursor_pagination(tc):
    # دیتابیس تست session-shared است؛ پس ادعاها نسبی‌اند: صفحه‌ها با limit=20
    # پیمایش می‌شوند تا next_cursor تمام شود — بدون هم‌پوشانی، و هر ۲۵ آیتم
    # ساخته‌شدهٔ این تست باید در خروجی باشند.
    client = tc["client"]
    admin = await _admin(tc)
    created = {
        await _create_video(client, admin, f"ویدیوی صفحه‌بندی {i}", i) for i in range(25)
    }

    collected: list[str] = []
    cursor: str | None = None
    first_page_size: int | None = None
    for _ in range(10):
        params: dict = {"kind": "video", "limit": 20}
        if cursor:
            params["after"] = cursor
        r = await client.get(f"{BASE}/admin/library/items", params=params, headers=admin)
        assert r.status_code == 200, r.text
        body = r.json()
        if first_page_size is None:
            first_page_size = len(body["items"])
        collected.extend(it["id"] for it in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert first_page_size == 20
    assert cursor is None  # پیمایش واقعاً به انتها رسید
    assert len(collected) == len(set(collected))  # هیچ آیتمی دوبار نیامد
    assert created <= set(collected)


async def test_admin_list_search_matches_persian_title(tc):
    client = tc["client"]
    admin = await _admin(tc)
    await _create_video(client, admin, "ویدیوی معمولی یک", 101)
    special = await _create_video(client, admin, "عنوان متمایز برای جست‌وجو", 102)
    await _create_video(client, admin, "ویدیوی معمولی دو", 103)

    r = await client.get(
        f"{BASE}/admin/library/items",
        params={"q": "متمایز"},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [it["id"] for it in items] == [special]


async def test_admin_list_status_filter(tc):
    client = tc["client"]
    admin = await _admin(tc)
    draft_id = await _create_video(client, admin, "پیش‌نویس می‌ماند", 201)
    review_id = await _create_video(client, admin, "می‌رود برای بررسی", 202)
    r = await client.post(
        f"{BASE}/admin/library/items/{review_id}/transition",
        json={"to": "in_review"},
        headers=admin,
    )
    assert r.status_code == 200, r.text

    r = await client.get(
        f"{BASE}/admin/library/items",
        params={"status": "in_review", "limit": 100},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    review_ids = {it["id"] for it in r.json()["items"]}
    assert review_id in review_ids
    assert draft_id not in review_ids

    r = await client.get(
        f"{BASE}/admin/library/items",
        params={"status": "draft", "limit": 100},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    draft_ids = {it["id"] for it in r.json()["items"]}
    assert draft_id in draft_ids
    assert review_id not in draft_ids
