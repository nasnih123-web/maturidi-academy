"""تست‌های ردیف «بدون دسته» در فهرست وردپرسی فتوا.

پوشش (متن‌ها خنثی و آزمایشی‌اند؛ هیچ حکم فقهی واقعی در تست نیست):
- اندپوینت categories ردیف بدون‌دسته را با تعداد درست و عنوان سه‌زبانه می‌دهد
- فیلتر category=__none فقط فتواهای منتشرشدهٔ بدون دسته را می‌دهد
- جمع دسته‌دار + بدون‌دسته با total فهرست برابر است (q-محدود، تا در
  دیتابیس مشترک تست‌ها آلودگی تست‌های دیگر در جمع نیاید)
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ الگوی test_fatwa_topics_listing."""
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
        role = Role(name=f"fatwa_uncat_role_{suffix}", description="fatwa uncat test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فتوا",
            email=f"fatwa-uncat-{suffix}@example.com",
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


async def _setup_mix(tc, suffix: str):
    """۲ منتشرشدهٔ دسته‌دار + ۲ منتشرشدهٔ بدون دسته + ۱ پیش‌نویس بدون دسته."""
    client = tc["client"]
    admin = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    h = {"Authorization": admin["Authorization"]}
    cat = await _make_category(client, h, f"uncat-{suffix}")
    for i in range(2):
        await _publish_topic(client, h, f"mix-{suffix}-cat-{i}", cat["id"])
    for i in range(2):
        await _publish_topic(client, h, f"mix-{suffix}-none-{i}")
    await _make_topic(client, h, f"mix-{suffix}-draft-none")
    return client, cat


async def test_categories_include_uncategorized_row(tc):
    client, cat = await _setup_mix(tc, _uid())
    r = await client.get(f"{BASE}/fatwa/topics/categories")
    assert r.status_code == 200
    by_slug = {c["slug"]: c for c in r.json()}
    assert by_slug[cat["slug"]]["published_count"] == 2
    row = by_slug["__none"]
    # پیش‌نویس بدون دسته شمرده نمی‌شود؛ فقط ۲ منتشرشدهٔ همین تست + بقیهٔ
    # تست‌های سوئیت، پس حد پایین دقیق است نه برابری سراسری.
    assert row["published_count"] >= 2
    assert row["title"]["fa"] == "بدون دسته"
    assert row["title"]["ar"] == "غير مصنّف"
    assert row["title"]["en"] == "Uncategorized"


async def test_filter_none_returns_only_uncategorized(tc):
    suffix = _uid()
    client, _cat = await _setup_mix(tc, suffix)
    r = await client.get(f"{BASE}/fatwa/topics?category=__none&q=mix-{suffix}")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert all(item["category"] is None for item in body["items"])


async def test_categorized_plus_uncategorized_sum_to_total(tc):
    suffix = _uid()
    client, cat = await _setup_mix(tc, suffix)
    q = f"mix-{suffix}"
    total = (await client.get(f"{BASE}/fatwa/topics?q={q}")).json()["total"]
    cat_total = (
        await client.get(f"{BASE}/fatwa/topics?q={q}&category={cat['slug']}")
    ).json()["total"]
    none_total = (
        await client.get(f"{BASE}/fatwa/topics?q={q}&category=__none")
    ).json()["total"]
    assert total == 4
    assert cat_total == 2
    assert none_total == 2
    assert cat_total + none_total == total
