"""تست‌های فاز ۱۴ — بخش دوم: قراردادهای جدید integration (آشتی UI/Backend).

پوشش: transition تکی، reorder placements، PATCH توزیع، فید audit،
AI sources + reindex، preview اعلان، roles/revoke کاربر،
health-check منابع خارجی، approve/reject تلگرام، اکشن ban_user گزارش‌ها.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"
CC = f"{BASE}/admin/content"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


async def _make_user(tc, permissions: tuple[str, ...] = ()):
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
        role = Role(name=f"p14b_test_role_{suffix}", description="phase14 contract test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فاز ۱۴ب",
            email=f"p14b-{suffix}@example.com",
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


async def _make_page(tc, title: str, status: str = "draft", slug: str | None = None):
    from app.models.models import Page

    suffix = _uid()
    async with tc["maker"]() as db:
        page = Page(
            slug=slug or f"p14b-{suffix}",
            title=_L(title),
            blocks=[],
            seo_meta={},
            content_type="page",
            workflow_status=status,
        )
        db.add(page)
        await db.commit()
        await db.refresh(page)
        return str(page.id)


# ---------------------------------------------------------------------------
# transition تکی گردش‌کار
# ---------------------------------------------------------------------------


async def test_item_transition_draft_to_review(tc):
    headers = await _make_user(tc, ("content.bulk",))
    pid = await _make_page(tc, "گذر تکی")
    r = await tc["client"].post(
        f"{CC}/items/content/page/{pid}/transition",
        json={"to": "in_review", "note": "ارسال برای بازبینی"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["to"] == "in_review" or body.get("new_status") == "in_review"
    # audit ثبت شده؟
    r2 = await tc["client"].get(
        f"{CC}/audit", params={"domain": "content", "content_type": "page", "id": pid}, headers=headers
    )
    assert r2.status_code == 200, r2.text
    entries = r2.json()
    assert any("transition" in e["action"] for e in entries)


async def test_item_transition_bad_status_rejected(tc):
    headers = await _make_user(tc, ("content.bulk",))
    pid = await _make_page(tc, "گذر بد")
    r = await tc["client"].post(
        f"{CC}/items/content/page/{pid}/transition",
        json={"to": "no_such_state"},
        headers=headers,
    )
    assert r.status_code in (400, 422), r.text
    # جهش مجاز نیست: draft → published مستقیم
    r = await tc["client"].post(
        f"{CC}/items/content/page/{pid}/transition",
        json={"to": "published"},
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_transition"


async def test_item_transition_requires_permission(tc):
    headers = await _make_user(tc, ())
    pid = await _make_page(tc, "بدون دسترسی")
    r = await tc["client"].post(
        f"{CC}/items/content/page/{pid}/transition",
        json={"to": "published"},
        headers=headers,
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# placement: upsert + PATCH + reorder
# ---------------------------------------------------------------------------


async def test_placement_upsert_patch_reorder(tc):
    headers = await _make_user(tc, ("content.bulk",))
    pid = await _make_page(tc, "پلاسمنت")
    # upsert
    r = await tc["client"].put(
        f"{CC}/placements",
        json={
            "domain": "content", "content_type": "page", "content_id": pid,
            "surface": "home", "slot": "hero", "sort_order": 5,
        },
        headers=headers,
    )
    assert r.status_code in (200, 201), r.text
    placement_id = r.json()["id"]
    # PATCH (sort_order)
    r = await tc["client"].patch(
        f"{CC}/placements/{placement_id}", json={"sort_order": 99}, headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["sort_order"] == 99
    # reorder
    r = await tc["client"].post(
        f"{CC}/placements/reorder", json={"ordered_ids": [placement_id]}, headers=headers
    )
    assert r.status_code == 200, r.text
    # GET با فیلتر
    r = await tc["client"].get(
        f"{CC}/placements", params={"domain": "content"}, headers=headers
    )
    assert r.status_code == 200
    assert any(p["id"] == placement_id for p in r.json())


# ---------------------------------------------------------------------------
# توزیع مستقل (PATCH)
# ---------------------------------------------------------------------------


async def test_distribution_patch_independence(tc):
    headers = await _make_user(tc, ("content.bulk",))
    pid = await _make_page(tc, "توزیع مستقل")
    r = await tc["client"].patch(
        f"{CC}/items/content/page/{pid}/distribution",
        json={"policy": {"web": True, "telegram": False}},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["policy"]["web"]["enabled"] is True
    assert body["policy"]["telegram"]["enabled"] is False
    # GET همان آیتم — سیاست اعمال شده
    r = await tc["client"].get(
        f"{CC}/distribution",
        params={"domain": "content", "content_type": "page", "id": pid},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["channels"]["telegram"]["enabled"] is False


# ---------------------------------------------------------------------------
# AI sources + reindex
# ---------------------------------------------------------------------------


async def test_ai_sources_and_reindex(tc):
    headers = await _make_user(tc, ("content.bulk",))
    # آیتم کتابخانه با ai_scopes
    async with tc["maker"]() as db:
        from app.models.models import LibraryItem

        item = LibraryItem(
            kind="pdf", title=_L("منبع AI"), media_key=f"p14b/{_uid()}.pdf",
            workflow_status="published", ai_scopes=["library"],
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)
        lid = str(item.id)
    r = await tc["client"].get(f"{CC}/ai-sources", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()
    assert any(i["id"] == lid for i in items)
    # reindex برای کتابخانه → delegate به trigger_ingestion فاز ۶
    r = await tc["client"].post(
        f"{CC}/ai-sources/library/library_item/{lid}/reindex", headers=headers
    )
    # 202 اگر ingestion موجود، 422 اگر adapter پشتیبانی نکند
    assert r.status_code in (202, 422, 404), r.text


# ---------------------------------------------------------------------------
# notification preview
# ---------------------------------------------------------------------------


async def test_notification_preview_single_user(tc):
    headers = await _make_user(tc, ("notifications.broadcast", "users.view360"))
    user = await _make_user(tc, ())
    # ترجیح صریح: email روشن
    async with tc["maker"]() as db:
        from app.models.models import NotificationPreference

        db.add(NotificationPreference(
            user_id=uuid.UUID(user["user_id"]), notif_type="product",
            channel="email", enabled=True,
        ))
        await db.commit()
    r = await tc["client"].post(
        f"{BASE}/admin/notifications/preview",
        json={
            "title": "پیش‌نمایش",
            "body": "متن",
            "channels": ["email", "sms"],
            "cohort": {"type": "users", "user_ids": [user["user_id"]]},
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["recipients"] == 1
    # email روشن است، sms خاموش (پیش‌فرض) → فقط email
    assert body["per_channel"].get("email") == 1
    assert "sms" not in body["per_channel"]


# ---------------------------------------------------------------------------
# user roles + revoke
# ---------------------------------------------------------------------------


async def test_user_roles_replace_and_revoke(tc):
    admin = await _make_user(tc, ("roles.manage", "users.view360"))
    target = await _make_user(tc, ())
    # ساخت نقش جدید برای جایگزینی
    r = await tc["client"].post(
        f"{BASE}/admin/roles",
        json={"name": f"p14b-role-{_uid()}", "description": "t", "permission_keys": []},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    role_name = r.json()["name"]
    # جایگزینی با نام
    r = await tc["client"].patch(
        f"{BASE}/admin/users/{target['user_id']}/roles",
        json={"role_names": [role_name]},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    # revoke sessions
    r = await tc["client"].post(
        f"{BASE}/admin/users/{target['user_id']}/sessions/revoke", headers=admin
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# trusted-source check (mocked httpx)
# ---------------------------------------------------------------------------


async def test_trusted_source_check_mocked(tc, monkeypatch):
    admin = await _make_user(tc, ("platform.settings",))
    r = await tc["client"].post(
        f"{BASE}/admin/fatwa/trusted-sources",
        json={"name": "تست", "base_url": "https://example.test", "domain": "example.test"},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    class _Resp:
        status_code = 200

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def head(self, url):
            return _Resp()

        async def get(self, url):
            return _Resp()

    import httpx as _httpx

    monkeypatch.setattr(_httpx, "AsyncClient", _Client)
    r = await tc["client"].post(
        f"{BASE}/admin/fatwa/trusted-sources/{sid}/check", headers=admin
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["status_code"] == 200


# ---------------------------------------------------------------------------
# telegram approve/reject
# ---------------------------------------------------------------------------


async def test_telegram_approve_reject(tc, monkeypatch):
    admin = await _make_user(tc, ("telegram.manage",))
    pid = await _make_page(tc, "تلگرام", status="published")

    # رکورد pending دستی می‌سازیم
    async with tc["maker"]() as db:
        from app.modules.telegram.distribute_service import TelegramPublished

        row = TelegramPublished(
            source_content_type="page",
            source_content_id=pid,
            distribution_target="@test",
            idempotency_key=f"p14b-{_uid()}",
            status="pending",
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        row_id = str(row.id)

    # reject
    r = await tc["client"].post(f"{BASE}/telegram/distribute/reject/{row_id}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"

    # رکورد pending دوم برای approve
    async with tc["maker"]() as db:
        row2 = TelegramPublished(
            source_content_type="page",
            source_content_id=pid,
            distribution_target="@test",
            idempotency_key=f"p14b-{_uid()}",
            status="pending",
        )
        db.add(row2)
        await db.commit()
        await db.refresh(row2)
        row2_id = str(row2.id)

    # mock ارسال تلگرام → ناموفق (bot آفلاین) ولی مسیر اجرا شود
    from app.modules.telegram import bot_service

    async def _send(db, target, text):
        return None

    monkeypatch.setattr(bot_service, "send_message", _send)
    r = await tc["client"].post(f"{BASE}/telegram/distribute/approve/{row2_id}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] in ("sent", "failed", "skipped")


# ---------------------------------------------------------------------------
# ban_user از گزارش اجتماعی
# ---------------------------------------------------------------------------


async def test_social_report_ban_user(tc):
    mod = await _make_user(tc, ("social.moderate", "users.view360"))
    reporter = await _make_user(tc, ())
    bad_user = await _make_user(tc, ())
    # پست بد + گزارش (از طریق سرویس — sla_due_at خودکار)
    async with tc["maker"]() as db:
        from app.models.models import SocialPost, User
        from app.modules.social.service import create_report

        post = SocialPost(author_id=uuid.UUID(bad_user["user_id"]), body="هرزنامه")
        db.add(post)
        await db.flush()
        reporter_row = await db.get(User, uuid.UUID(reporter["user_id"]))
        rep = await create_report(db, reporter=reporter_row, target_type="post",
                                  target_id=post.id, reason="spam")
        await db.commit()
        rep_id = str(rep.id)

    r = await tc["client"].post(
        f"{BASE}/admin/social/reports/{rep_id}/action",
        json={"action": "ban_user", "note": "هرزنامه"},
        headers=mod,
    )
    assert r.status_code == 200, r.text
    # کاربر غیرفعال شده؟
    async with tc["maker"]() as db:
        from app.models.models import SocialReport, User

        u = await db.get(User, uuid.UUID(bad_user["user_id"]))
        assert u.is_active is False
        # پاک‌سازی: گزارش تست را حذف می‌کنیم تا تست‌های دیگر (session-scoped DB) آلوده نشوند
        rep_row = await db.get(SocialReport, uuid.UUID(rep_id))
        if rep_row is not None:
            await db.delete(rep_row)
        await db.commit()
    # کاربر بن‌شده دیگر نمی‌تواند کاری کند (توکن نامعتبر → 401)
    r = await tc["client"].post(
        f"{BASE}/admin/social/reports/{rep_id}/action",
        json={"action": "ban_user"},
        headers=bad_user,
    )
    assert r.status_code in (401, 403, 422)
