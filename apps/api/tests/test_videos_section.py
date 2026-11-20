"""تست‌های بخش ویدیوها — لیست‌های پخش، صفحات تماشا، دسترسی عمومی/مدیریتی.

پوشش:
- endpointهای مدیریت بدون توکن ۴۰۱ و بدون مجوز library.manage ۴۰۳ می‌دهند
- CRUD لیست پخش + افزودن آیتم (نوع نامعتبر ۴۲۲ / آیتم غایب ۴۰۴ / تکراری ۴۰۹)
- بازترتیب: مجموعهٔ ناهمخوان ۴۲۲، ترتیب درست positionها را جابه‌جا می‌کند
- نمای عمومی: آیتم پیش‌نویس/منتشرنشده و لیست منتشرنشده دیده نمی‌شوند؛
  قواعد visibility کتابخانه (ناشناس فقط public) عیناً اعمال می‌شود
- صفحهٔ تماشا: زمینهٔ لیست پخش (موقعیت، قبلی/بعدی) و مشابه‌ها بدون خود آیتم
- candidates مدیریتی پیش‌نویس‌ها را هم برمی‌گرداند ولی pdf نه
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

BASE = "/api/v1"


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + هدر احراز — همان الگوی تست‌های کتابخانه."""
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
        role = Role(name=f"vid_test_role_{suffix}", description="videos test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست ویدیو",
            email=f"vid-{suffix}@example.com",
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
        user_id = str(user.id)
    return {"Authorization": f"Bearer {token}", "user_id": user_id}


async def _make_item(
    tc,
    *,
    kind: str = "video",
    title: str = "ویدیوی تست",
    visibility: str = "public",
    workflow_status: str = "published",
    tags: list[str] | None = None,
    duration: int | None = 600,
    age_minutes: int = 0,
) -> str:
    from app.models.models import LibraryItem

    async with tc["maker"]() as db:
        item = LibraryItem(
            kind=kind,
            title=_L(title),
            description=_L("توضیح تست"),
            cover_media_key=f"library/covers/{_uid()}.jpg",
            media_key=f"library/{kind}/{_uid()}.mp4",
            topic_tags=list(tags or []),
            visibility=visibility,
            workflow_status=workflow_status,
            duration_seconds=duration,
        )
        if age_minutes:
            item.created_at = datetime.now(UTC) - timedelta(minutes=age_minutes)
        db.add(item)
        await db.commit()
        return str(item.id)


async def _create_playlist(client, headers, **over) -> dict:
    body = {"title": _L("لیست تست"), "is_published": True, "sort_order": 0}
    body.update(over)
    r = await client.post(f"{BASE}/admin/videos/playlists", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _add(client, headers, playlist_id, item_id, **kw):
    body = {"item_id": item_id}
    body.update(kw)
    return await client.post(
        f"{BASE}/admin/videos/playlists/{playlist_id}/items",
        json=body,
        headers=headers,
    )


# ---------------------------------------------------------------------------
# احراز مدیریت
# ---------------------------------------------------------------------------


async def test_admin_endpoints_require_auth_and_permission(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/admin/videos/playlists")
    assert r.status_code == 401, r.text

    plain = await _make_user(tc)  # بدون هیچ مجوزی
    r = await client.get(f"{BASE}/admin/videos/playlists", headers=plain)
    assert r.status_code == 403, r.text
    r = await client.post(
        f"{BASE}/admin/videos/playlists",
        json={"title": _L("x")},
        headers=plain,
    )
    assert r.status_code == 403, r.text
    r = await client.get(f"{BASE}/admin/videos/candidates", headers=plain)
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# CRUD لیست پخش
# ---------------------------------------------------------------------------


async def test_playlist_crud(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    pl = await _create_playlist(client, admin, is_published=False, sort_order=3)
    assert pl["is_published"] is False
    assert pl["item_count"] == 0
    assert pl["items"] == []

    r = await client.patch(
        f"{BASE}/admin/videos/playlists/{pl['id']}",
        json={"title": _L("عنوان تازه"), "is_published": True},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"]["fa"] == "عنوان تازه"
    assert r.json()["is_published"] is True

    r = await client.get(f"{BASE}/admin/videos/playlists", headers=admin)
    assert [p["id"] for p in r.json()] == [pl["id"]]

    r = await client.delete(
        f"{BASE}/admin/videos/playlists/{pl['id']}", headers=admin
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/admin/videos/playlists", headers=admin)
    assert r.json() == []
    r = await client.get(f"{BASE}/videos/playlists/{pl['id']}")
    assert r.status_code == 404, r.text


async def test_add_item_validation_and_reorder(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))
    pl = await _create_playlist(client, admin)

    pdf_id = await _make_item(tc, kind="pdf", title="سند")
    r = await _add(client, admin, pl["id"], pdf_id)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "not_a_video"

    r = await _add(client, admin, pl["id"], str(uuid.uuid4()))
    assert r.status_code == 404, r.text

    v1 = await _make_item(tc, title="اول")
    v2 = await _make_item(tc, title="دوم")
    v3 = await _make_item(tc, title="سوم")
    for vid in (v1, v2, v3):
        r = await _add(client, admin, pl["id"], vid)
        assert r.status_code == 201, r.text
    r = await _add(client, admin, pl["id"], v1)
    assert r.status_code == 409, r.text

    # بازترتیب کامل: مجموعهٔ اشتباه ۴۲۲، مجموعهٔ درست اعمال می‌شود
    r = await client.put(
        f"{BASE}/admin/videos/playlists/{pl['id']}/items/order",
        json={"item_ids": [v3, v1]},
        headers=admin,
    )
    assert r.status_code == 422, r.text
    r = await client.put(
        f"{BASE}/admin/videos/playlists/{pl['id']}/items/order",
        json={"item_ids": [v3, v2, v1]},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["item_id"] for i in items] == [v3, v2, v1]
    assert [i["position"] for i in items] == [0, 1, 2]

    # حذف عضو: بقیه دوباره فشرده می‌شوند
    r = await client.delete(
        f"{BASE}/admin/videos/playlists/{pl['id']}/items/{v2}", headers=admin
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["item_id"] for i in items] == [v3, v1]
    assert [i["position"] for i in items] == [0, 1]
    r = await client.delete(
        f"{BASE}/admin/videos/playlists/{pl['id']}/items/{v2}", headers=admin
    )
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# نمای عمومی
# ---------------------------------------------------------------------------


async def test_public_list_visibility_rules(tc):
    client = tc["client"]
    pub = await _make_item(tc, title="عمومی", visibility="public")
    reg = await _make_item(tc, title="ثبت‌نامی", visibility="registered")
    draft = await _make_item(tc, title="پیش‌نویس", workflow_status="draft")
    await _make_item(tc, kind="pdf", title="سند عمومی")

    r = await client.get(f"{BASE}/videos")
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    assert pub in ids
    assert reg not in ids  # ناشناس فقط public
    assert draft not in ids  # پیش‌نویس هرگز عمومی نیست

    user = await _make_user(tc)
    r = await client.get(f"{BASE}/videos", headers=user)
    ids = [i["id"] for i in r.json()["items"]]
    assert reg in ids  # کاربر واردشده registered را هم می‌بیند
    assert draft not in ids


async def test_public_playlists_hide_unpublished_and_draft_items(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))

    hidden = await _create_playlist(client, admin, is_published=False)
    shown = await _create_playlist(client, admin, title=_L("نمایشی"))
    v_pub = await _make_item(tc, title="منتشرشده", duration=300)
    v_draft = await _make_item(
        tc, title="داخلی پیش‌نویس", workflow_status="draft", duration=900
    )
    for vid in (v_pub, v_draft):
        r = await _add(client, admin, shown["id"], vid)
        assert r.status_code == 201, r.text

    r = await client.get(f"{BASE}/videos/playlists")
    assert r.status_code == 200, r.text
    playlists = r.json()
    ids = [p["id"] for p in playlists]
    assert shown["id"] in ids
    assert hidden["id"] not in ids  # منتشرنشده در فهرست عمومی نیست
    entry = next(p for p in playlists if p["id"] == shown["id"])
    # آیتم پیش‌نویس داخل لیست منتشرشده هم در شمارنده/مجموع/فهرست نیست
    assert entry["item_count"] == 1
    assert entry["total_duration_seconds"] == 300
    assert [i["id"] for i in entry["items"]] == [v_pub]

    r = await client.get(f"{BASE}/videos/playlists/{hidden['id']}")
    assert r.status_code == 404, r.text
    r = await client.get(f"{BASE}/videos/playlists/{shown['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["item_count"] == 1


# ---------------------------------------------------------------------------
# صفحهٔ تماشا
# ---------------------------------------------------------------------------


async def test_watch_playlist_context_and_related(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))
    pl = await _create_playlist(client, admin)

    v1 = await _make_item(tc, title="درس یک", tags=["aqidah"], age_minutes=30)
    v2 = await _make_item(tc, title="درس دو", tags=["aqidah"], age_minutes=20)
    v3 = await _make_item(tc, title="درس سه", tags=["fiqh"], age_minutes=10)
    other = await _make_item(tc, title="مشابه برچسبی", tags=["aqidah"], age_minutes=5)
    for vid in (v1, v2, v3):
        r = await _add(client, admin, pl["id"], vid)
        assert r.status_code == 201, r.text

    r = await client.get(f"{BASE}/videos/{v2}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item"]["id"] == v2
    assert body["stream_url"]  # signed URL برای ویدیوی عمومی منتشرشده
    ctx = body["playlist"]
    assert ctx is not None
    assert ctx["playlist"]["id"] == pl["id"]
    assert ctx["position"] == 2
    assert ctx["total"] == 3
    assert ctx["prev_item_id"] == v1
    assert ctx["next_item_id"] == v3
    assert [i["id"] for i in ctx["items"]] == [v1, v2, v3]
    # عضویت‌های آیتم هم همان لیست منتشرشده را نشان می‌دهند
    assert [p["id"] for p in body["item"]["playlists"]] == [pl["id"]]

    related_ids = [i["id"] for i in body["related"]]
    assert v2 not in related_ids  # خودش هرگز در مشابه‌ها نیست
    assert related_ids[0] == other  # برچسب مشترک اول صف است
    assert v1 in related_ids and v3 in related_ids

    # پارامتر صریح playlist همان زمینه را برمی‌گرداند؛ لبه‌ها prev/next خالی
    r = await client.get(f"{BASE}/videos/{v1}?playlist={pl['id']}")
    ctx = r.json()["playlist"]
    assert ctx["position"] == 1
    assert ctx["prev_item_id"] is None
    assert ctx["next_item_id"] == v2

    # ویدیوی پیش‌نویس در صفحهٔ تماشا هم ۴۰۴ است
    draft = await _make_item(tc, title="مخفی", workflow_status="draft")
    r = await client.get(f"{BASE}/videos/{draft}")
    assert r.status_code == 404, r.text


async def test_candidates_include_drafts_exclude_non_videos(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("library.manage",))
    draft = await _make_item(tc, title="پیش‌نویس ویدیو", workflow_status="draft")
    pub = await _make_item(tc, title="ویدیوی منتشرشده")
    await _make_item(tc, kind="audio", title="صوت")

    r = await client.get(f"{BASE}/admin/videos/candidates", headers=admin)
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()]
    assert draft in ids and pub in ids
    by_id = {c["id"]: c for c in r.json()}
    assert by_id[draft]["workflow_status"] == "draft"

    r = await client.get(
        f"{BASE}/admin/videos/candidates?q=پیش‌نویس ویدیو", headers=admin
    )
    assert [c["id"] for c in r.json()] == [draft]
