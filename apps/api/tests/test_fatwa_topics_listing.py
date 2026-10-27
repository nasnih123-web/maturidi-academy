"""تست‌های فهرست وردپرسی فتوا — دسته‌ها، فهرست عمومی، شمارنده‌ها.

پوشش (متن‌ها خنثی و آزمایشی‌اند؛ هیچ حکم فقهی واقعی در تست نیست):
- فهرست عمومی فقط منتشرشده‌ها را می‌دهد؛ پیش‌نویس دیده نمی‌شود
- صفحه‌بندی و total درست است؛ فیلتر دسته و جستجو کار می‌کند
- جزئیات بازدید را زیاد می‌کند؛ share شمارنده را زیاد می‌کند
- دسته‌ها تعداد منتشرشدهٔ درست می‌دهند؛ CRUD دسته + ۴۰۹هایش
- ادمین list و PUT کار می‌کند؛ گذار به published مقدار published_at را می‌گذارد
- پرش مستقیم draft → published نامعتبر است (۴۲۲)
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ الگوی test_fatwa_phase6 (RBAC واقعی از جدول‌ها)."""
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
        role = Role(name=f"fatwa_wp_role_{suffix}", description="fatwa wp test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فتوا",
            email=f"fatwa-wp-{suffix}@example.com",
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
        return {"Authorization": f"Bearer {token}"}


async def _make_category(client, headers, slug: str):
    r = await client.post(
        f"{BASE}/admin/fatwa/categories",
        json={"slug": slug, "title": {"fa": f"دستهٔ آزمایشی {slug}"}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _make_topic(client, headers, suffix: str, category_id=None):
    body = {
        "title": {"fa": f"عنوان آزمایشی {suffix}"},
        "description": {"fa": f"متن آزمایشی جواب {suffix}"},
        "author_name": "نویسندهٔ آزمایشی",
        "featured_image_url": "https://example.com/cover.jpg",
    }
    if category_id:
        body["category_id"] = category_id
    r = await client.post(f"{BASE}/admin/fatwa/topics", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _make_position(client, headers, topic_id: str, madhab: str):
    r = await client.post(
        f"{BASE}/admin/fatwa/positions",
        json={
            "topic_id": topic_id,
            "madhab": madhab,
            "position_text": {"fa": f"متن آزمایشی موضع {madhab}"},
            "evidence_refs": ["منبع آزمایشی"],
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _set_status(client, headers, topic_id: str, status: str):
    r = await client.patch(
        f"{BASE}/admin/fatwa/topics/{topic_id}/status",
        json={"status": status},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _publish_topic(client, headers, suffix: str, category_id=None):
    """موضوع + ۴ موضع + چرخهٔ کامل تا published."""
    topic = await _make_topic(client, headers, suffix, category_id)
    for madhab in ("hanafi", "shafii", "maliki", "hanbali"):
        await _make_position(client, headers, topic["id"], madhab)
    await _set_status(client, headers, topic["id"], "in_review")
    await _set_status(client, headers, topic["id"], "approved")
    published = await _set_status(client, headers, topic["id"], "published")
    assert published["published_at"], "published_at باید موقع انتشار ثبت شود"
    return published


async def test_public_list_hides_drafts_and_counts_published(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    cat = await _make_category(client, h, f"cat-{suffix}")
    await _make_topic(client, h, f"draft-{suffix}", cat["id"])
    await _publish_topic(client, h, f"pub-{suffix}", cat["id"])

    r = await client.get(f"{BASE}/fatwa/topics?q=draft-{suffix}")
    assert r.status_code == 200
    assert r.json()["total"] == 0

    r = await client.get(f"{BASE}/fatwa/topics?q=pub-{suffix}")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["category"]["slug"] == f"cat-{suffix}"
    assert item["author_name"] == "نویسندهٔ آزمایشی"
    assert item["featured_image_url"] == "https://example.com/cover.jpg"
    assert item["published_at"]
    assert item["view_count"] == 0
    assert item["share_count"] == 0


async def test_public_pagination_category_filter_and_exclude(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    cat_a = await _make_category(client, h, f"pa-{suffix}")
    cat_b = await _make_category(client, h, f"pb-{suffix}")
    ids = []
    for i in range(3):
        t = await _publish_topic(client, h, f"pg-{suffix}-{i}", cat_a["id"])
        ids.append(t["id"])
    await _publish_topic(client, h, f"pg-{suffix}-other", cat_b["id"])

    r = await client.get(
        f"{BASE}/fatwa/topics?category=pa-{suffix}&page=1&per_page=2"
    )
    body = r.json()
    assert body["total"] == 3
    assert body["pages"] == 2
    assert len(body["items"]) == 2
    r = await client.get(
        f"{BASE}/fatwa/topics?category=pa-{suffix}&page=2&per_page=2"
    )
    assert len(r.json()["items"]) == 1

    r = await client.get(
        f"{BASE}/fatwa/topics?category=pa-{suffix}&exclude={ids[0]}"
    )
    got = {it["id"] for it in r.json()["items"]}
    assert ids[0] not in got
    assert len(got) == 2


async def test_public_detail_counts_views_and_share(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    topic = await _publish_topic(client, h, f"view-{suffix}")

    r = await client.get(f"{BASE}/fatwa/topics/{topic['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["view_count"] == 1
    assert len(body["positions"]) == 4
    r = await client.get(f"{BASE}/fatwa/topics/{topic['id']}")
    assert r.json()["view_count"] == 2

    r = await client.post(f"{BASE}/fatwa/topics/{topic['id']}/share")
    assert r.status_code == 200
    assert r.json()["share_count"] == 1
    r = await client.post(f"{BASE}/fatwa/topics/{topic['id']}/share")
    assert r.json()["share_count"] == 2


async def test_public_detail_and_share_reject_drafts(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    topic = await _make_topic(client, h, f"draftonly-{suffix}")
    r = await client.get(f"{BASE}/fatwa/topics/{topic['id']}")
    assert r.status_code == 404
    r = await client.post(f"{BASE}/fatwa/topics/{topic['id']}/share")
    assert r.status_code == 404


async def test_topic_categories_counts(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    cat = await _make_category(client, h, f"cnt-{suffix}")
    await _make_category(client, h, f"empty-{suffix}")
    await _publish_topic(client, h, f"cnt-{suffix}-1", cat["id"])
    await _publish_topic(client, h, f"cnt-{suffix}-2", cat["id"])
    await _make_topic(client, h, f"cnt-{suffix}-draft", cat["id"])

    r = await client.get(f"{BASE}/fatwa/topics/categories")
    assert r.status_code == 200
    by_slug = {c["slug"]: c["published_count"] for c in r.json()}
    assert by_slug[f"cnt-{suffix}"] == 2
    assert by_slug[f"empty-{suffix}"] == 0


async def test_category_crud_and_conflicts(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    cat = await _make_category(client, h, f"crud-{suffix}")

    r = await client.post(
        f"{BASE}/admin/fatwa/categories",
        json={"slug": f"crud-{suffix}", "title": {"fa": "تکراری"}},
        headers=h,
    )
    assert r.status_code == 409

    r = await client.put(
        f"{BASE}/admin/fatwa/categories/{cat['id']}",
        json={"slug": f"crud2-{suffix}", "title": {"fa": "دستهٔ ویرایش‌شده"}},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["slug"] == f"crud2-{suffix}"

    topic = await _make_topic(client, h, f"inuse-{suffix}", cat["id"])
    assert topic["category_id"] == cat["id"]
    r = await client.delete(f"{BASE}/admin/fatwa/categories/{cat['id']}", headers=h)
    assert r.status_code == 409

    r = await client.get(f"{BASE}/admin/fatwa/categories", headers=h)
    assert r.status_code == 200
    assert any(c["slug"] == f"crud2-{suffix}" for c in r.json())

    free = await _make_category(client, h, f"free-{suffix}")
    r = await client.delete(f"{BASE}/admin/fatwa/categories/{free['id']}", headers=h)
    assert r.status_code == 204


async def test_admin_list_and_put(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    cat = await _make_category(client, h, f"adm-{suffix}")
    topic = await _make_topic(client, h, f"adm-{suffix}", cat["id"])

    r = await client.get(
        f"{BASE}/admin/fatwa/topics?status=draft&q=adm-{suffix}", headers=h
    )
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["workflow_status"] == "draft"

    r = await client.put(
        f"{BASE}/admin/fatwa/topics/{topic['id']}",
        json={
            "title": {"fa": f"عنوان ویرایش‌شده {suffix}"},
            "description": {"fa": "متن ویرایش‌شده"},
            "category_id": None,
            "author_name": "نویسندهٔ تازه",
            "featured_image_url": None,
        },
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["author_name"] == "نویسندهٔ تازه"
    assert r.json()["category_id"] is None


async def test_invalid_transition_rejected(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    topic = await _make_topic(client, h, f"jump-{suffix}")
    r = await client.patch(
        f"{BASE}/admin/fatwa/topics/{topic['id']}/status",
        json={"status": "published"},
        headers=h,
    )
    assert r.status_code == 422


async def test_admin_category_requires_permission(tc):
    client = tc["client"]
    plain = await _make_user(tc, ())
    r = await client.post(
        f"{BASE}/admin/fatwa/categories",
        json={"slug": f"noperm-{_uid()}", "title": {"fa": "x"}},
        headers={"Authorization": plain["Authorization"]},
    )
    assert r.status_code == 403
