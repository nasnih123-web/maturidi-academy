"""تست‌های مقالات وردپرسی — دسته‌ها، فهرست عمومی، شمارنده‌ها، سئو.

پوشش (متن‌ها خنثی و آزمایشی‌اند؛ هیچ محتوای فقهی در تست نیست):
- فهرست عمومی فقط منتشرشده‌ها را می‌دهد؛ پیش‌نویس دیده نمی‌شود
- صفحه‌بندی و total درست است؛ فیلتر دسته (شامل __none) و جستجو کار می‌کند
- جزئیات بازدید را زیاد می‌کند؛ share شمارنده را زیاد می‌کند
- متا بازدید را زیاد نمی‌کند
- دسته‌ها تعداد منتشرشدهٔ درست می‌دهند؛ CRUD دسته + ۴۰۹هایش
- ادمین list و PUT کار می‌کند؛ گذار به published مقدار published_at را می‌گذارد
- پرش مستقیم draft → published نامعتبر است (۴۲۲)
- بایگانی و بازگردانی به پیش‌نویس (archived → draft) کار می‌کند
- نامک یکتا: تکرار ۴۰۹ می‌دهد؛ نامک با فاصله/اسلش ۴۲۲ می‌دهد
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"

DOC = {
    "type": "doc",
    "content": [
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": "متن آزمایشی بدنهٔ مقاله"}],
        }
    ],
}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ الگوی test_fatwa_topics_listing (RBAC واقعی از جدول‌ها)."""
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
        role = Role(name=f"articles_wp_role_{suffix}", description="articles wp test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست مقاله",
            email=f"articles-wp-{suffix}@example.com",
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
        f"{BASE}/admin/articles/categories",
        json={"slug": slug, "title": {"fa": f"دستهٔ آزمایشی {slug}"}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _make_article(client, headers, suffix: str, category_id=None):
    body = {
        "title": {"fa": f"عنوان آزمایشی مقاله {suffix}"},
        "body": DOC,
        "slug": f"maghaleh-{suffix}",
        "seo_title": f"عنوان سئوی آزمایشی {suffix}",
        "seo_description": f"توضیح متای آزمایشی {suffix}",
        "author_name": "نویسندهٔ آزمایشی",
        "featured_image_url": "https://example.com/cover.jpg",
    }
    if category_id:
        body["category_id"] = category_id
    r = await client.post(f"{BASE}/admin/articles", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _set_status(client, headers, article_id: str, status: str):
    r = await client.patch(
        f"{BASE}/admin/articles/{article_id}/status",
        json={"status": status},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _publish_article(client, headers, suffix: str, category_id=None):
    """مقاله + چرخهٔ کامل تا published."""
    art = await _make_article(client, headers, suffix, category_id)
    await _set_status(client, headers, art["id"], "in_review")
    await _set_status(client, headers, art["id"], "approved")
    published = await _set_status(client, headers, art["id"], "published")
    assert published["published_at"], "published_at باید موقع انتشار ثبت شود"
    return published


async def test_public_list_hides_drafts_and_counts_published(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    cat = await _make_category(client, h, f"cat-{suffix}")
    await _make_article(client, h, f"draft-{suffix}", cat["id"])
    await _publish_article(client, h, f"pub-{suffix}", cat["id"])

    r = await client.get(f"{BASE}/articles?q=draft-{suffix}")
    assert r.status_code == 200
    assert r.json()["total"] == 0

    r = await client.get(f"{BASE}/articles?q=pub-{suffix}")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["slug"] == f"maghaleh-pub-{suffix}"
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
    slugs = []
    for i in range(3):
        a = await _publish_article(client, h, f"pg-{suffix}-{i}", cat_a["id"])
        slugs.append(a["slug"])
    await _publish_article(client, h, f"pg-{suffix}-other", cat_b["id"])

    r = await client.get(
        f"{BASE}/articles?category=pa-{suffix}&page=1&per_page=2"
    )
    body = r.json()
    assert body["total"] == 3
    assert body["pages"] == 2
    assert len(body["items"]) == 2
    r = await client.get(
        f"{BASE}/articles?category=pa-{suffix}&page=2&per_page=2"
    )
    assert len(r.json()["items"]) == 1

    r = await client.get(
        f"{BASE}/articles?category=pa-{suffix}&exclude={slugs[0]}"
    )
    got = [it["slug"] for it in r.json()["items"]]
    assert slugs[0] not in got
    assert len(got) == 2


async def test_public_detail_counts_views_and_share(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    pub = await _publish_article(client, h, f"cnt-{suffix}")
    slug = pub["slug"]

    r = await client.get(f"{BASE}/articles/{slug}")
    assert r.status_code == 200
    assert r.json()["view_count"] == 1
    assert r.json()["body"]["type"] == "doc"
    r = await client.get(f"{BASE}/articles/{slug}")
    assert r.json()["view_count"] == 2

    r = await client.post(f"{BASE}/articles/{slug}/share")
    assert r.status_code == 200
    assert r.json()["share_count"] == 1
    r = await client.get(f"{BASE}/articles/{slug}")
    assert r.json()["share_count"] == 1


async def test_public_detail_and_share_reject_drafts(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    art = await _make_article(client, h, f"rej-{suffix}")
    slug = art["slug"]

    r = await client.get(f"{BASE}/articles/{slug}")
    assert r.status_code == 404
    r = await client.post(f"{BASE}/articles/{slug}/share")
    assert r.status_code == 404


async def test_public_meta_does_not_count_views(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    pub = await _publish_article(client, h, f"meta-{suffix}")
    slug = pub["slug"]

    r = await client.get(f"{BASE}/articles/{slug}/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == slug
    assert body["seo_title"] == f"عنوان سئوی آزمایشی meta-{suffix}"
    assert body["seo_description"] == f"توضیح متای آزمایشی meta-{suffix}"
    assert "view_count" not in body
    # جزئیات بعد از متا هنوز باید بازدید اول را بشمارد، نه دوم.
    r = await client.get(f"{BASE}/articles/{slug}")
    assert r.json()["view_count"] == 1

    draft = await _make_article(client, h, f"meta-draft-{suffix}")
    r = await client.get(f"{BASE}/articles/{draft['slug']}/meta")
    assert r.status_code == 404


async def test_article_categories_counts(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    # ردیف «بدون دسته» سراسری است (همهٔ تست‌های نشست در یک DB مشترک‌اند)،
    # پس مقدار پایه را اول می‌خوانیم و افزایش دقیقاً یک واحدی را می‌سنجیم.
    r = await client.get(f"{BASE}/articles/categories")
    none_before = next(
        (row["published_count"] for row in r.json() if row["slug"] == "__none"),
        0,
    )
    cat = await _make_category(client, h, f"cc-{suffix}")
    await _publish_article(client, h, f"cc-{suffix}-1", cat["id"])
    await _publish_article(client, h, f"cc-{suffix}-2", cat["id"])
    await _publish_article(client, h, f"cc-{suffix}-nocat")
    await _make_article(client, h, f"cc-{suffix}-draft", cat["id"])

    r = await client.get(f"{BASE}/articles/categories")
    assert r.status_code == 200
    rows = {row["slug"]: row["published_count"] for row in r.json()}
    assert rows[f"cc-{suffix}"] == 2
    assert rows["__none"] == none_before + 1


async def test_category_crud_and_conflicts(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    slug = f"crud-{suffix}"
    cat = await _make_category(client, h, slug)

    r = await client.post(
        f"{BASE}/admin/articles/categories",
        json={"slug": slug, "title": {"fa": "تکراری"}},
        headers=h,
    )
    assert r.status_code == 409

    r = await client.put(
        f"{BASE}/admin/articles/categories/{cat['id']}",
        json={"slug": slug, "title": {"fa": "دستهٔ ویرایش‌شده"}},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["title"]["fa"] == "دستهٔ ویرایش‌شده"

    # دستهٔ در حال استفاده حذف نمی‌شود.
    await _publish_article(client, h, f"crud-{suffix}-art", cat["id"])
    r = await client.delete(
        f"{BASE}/admin/articles/categories/{cat['id']}", headers=h
    )
    assert r.status_code == 409

    # دستهٔ خالی حذف می‌شود.
    empty = await _make_category(client, h, f"crud-empty-{suffix}")
    r = await client.delete(
        f"{BASE}/admin/articles/categories/{empty['id']}", headers=h
    )
    assert r.status_code == 204


async def test_admin_list_and_put(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    art = await _make_article(client, h, f"adm-{suffix}")

    r = await client.get(
        f"{BASE}/admin/articles?status=draft&q=adm-{suffix}", headers=h
    )
    assert r.status_code == 200
    assert r.json()["total"] == 1

    r = await client.put(
        f"{BASE}/admin/articles/{art['id']}",
        json={
            "title": {"fa": f"عنوان ویرایش‌شده {suffix}"},
            "body": DOC,
            "slug": f"maghaleh-adm-{suffix}",
            "seo_title": None,
            "seo_description": None,
            "category_id": None,
            "author_name": "نویسندهٔ تازه",
            "featured_image_url": None,
        },
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["title"]["fa"] == f"عنوان ویرایش‌شده {suffix}"
    assert r.json()["author_name"] == "نویسندهٔ تازه"


async def test_invalid_transition_rejected(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    art = await _make_article(client, h, f"jmp-{suffix}")
    r = await client.patch(
        f"{BASE}/admin/articles/{art['id']}/status",
        json={"status": "published"},
        headers=h,
    )
    assert r.status_code == 422


async def test_archived_restore_to_draft(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    pub = await _publish_article(client, h, f"arc-{suffix}")
    slug = pub["slug"]

    archived = await _set_status(client, h, pub["id"], "archived")
    assert archived["workflow_status"] == "archived"
    assert archived["published_at"], "تاریخ انتشار با بایگانی پاک نمی‌شود"
    r = await client.get(f"{BASE}/articles/{slug}")
    assert r.status_code == 404

    # بازگردانی فقط به پیش‌نویس مجاز است؛ انتشار مستقیم از بایگانی ۴۲۲ است.
    r = await client.patch(
        f"{BASE}/admin/articles/{pub['id']}/status",
        json={"status": "published"},
        headers=h,
    )
    assert r.status_code == 422
    restored = await _set_status(client, h, pub["id"], "draft")
    assert restored["workflow_status"] == "draft"

    r = await client.get(
        f"{BASE}/admin/articles?status=archived", headers=h
    )
    slugs = [it["slug"] for it in r.json()["items"]]
    assert slug not in slugs


async def test_slug_uniqueness_and_validation(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    suffix = _uid()
    await _make_article(client, h, f"slug-{suffix}")

    dup = {
        "title": {"fa": "تکراری"},
        "body": DOC,
        "slug": f"maghaleh-slug-{suffix}",
    }
    r = await client.post(f"{BASE}/admin/articles", json=dup, headers=h)
    assert r.status_code == 409

    bad = {
        "title": {"fa": "نامعتبر"},
        "body": DOC,
        "slug": "bad slug/with space",
    }
    r = await client.post(f"{BASE}/admin/articles", json=bad, headers=h)
    assert r.status_code == 422

    # نامک فارسی یونیکد باید کار کند.
    fa_body = {
        "title": {"fa": "مقالهٔ فارسی"},
        "body": DOC,
        "slug": f"مقاله-آزمایشی-{suffix}",
    }
    r = await client.post(f"{BASE}/admin/articles", json=fa_body, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["slug"] == f"مقاله-آزمایشی-{suffix}"


async def test_admin_category_requires_permission(tc):
    client = tc["client"]
    nobody = await _make_user(tc, ())
    h = {"Authorization": nobody["Authorization"]}
    r = await client.post(
        f"{BASE}/admin/articles/categories",
        json={"slug": f"noperm-{_uid()}", "title": {"fa": "x"}},
        headers=h,
    )
    assert r.status_code == 403
