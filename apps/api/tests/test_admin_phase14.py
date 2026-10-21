"""تست‌های فاز ۱۴ — کنترل مرکزی ادمین (Track 1: Backend).

پوشش الزامی تسک:
- جست‌وجو/فیلتر یکپارچه روی ≥۳ دامنه
- عملیات گروهی: رد RBAC + audit به‌ازای هر آیتم
- استقلال توزیع: منتشرشده در web ولی ممنوع در telegram → توزیع‌کنندهٔ تلگرام skip
- تست اتصال با providerهای mockشده
- fan-out اعلان طبق ترجیح کاربر (کاربر sms-only ایمیل نمی‌گیرد)

به‌علاوه: placement/تقویم/تعارض، نمای ۳۶۰°، نقش/مجوز، بیلدها، جزئیات یکپارچه.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

BASE = "/api/v1"

P14_PERMS = (
    "content.bulk",
    "connections.test",
    "builds.manage",
    "notifications.broadcast",
    "users.view360",
    "roles.manage",
)


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _now():
    return datetime.now(UTC)


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + توکن؛ RBAC واقعی از جدول‌ها (الگوی فاز ۱۰/۱۱)."""
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
        role = Role(name=f"p14_test_role_{suffix}", description="phase14 test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فاز ۱۴",
            email=f"p14-{suffix}@example.com",
            phone=f"+98900{abs(hash(suffix)) % 10**7:07d}",
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


async def _set_settings(tc, values: dict[str, str]):
    from app.core.platform_settings import bump_settings_version, stage_setting

    async with tc["maker"]() as db:
        for k, v in values.items():
            await stage_setting(db, k, v)
        await db.commit()
    bump_settings_version(list(values.keys()))


async def _clear_settings(tc, keys: list[str]):
    from app.core.platform_settings import bump_settings_version
    from app.models.models import PlatformSetting

    async with tc["maker"]() as db:
        for k in keys:
            row = await db.get(PlatformSetting, k)
            if row is not None:
                await db.delete(row)
        await db.commit()
    bump_settings_version(keys)


@pytest.fixture(autouse=True)
def _clean_state():
    from app.core.platform_settings import reset_settings_cache

    reset_settings_cache()
    yield
    reset_settings_cache()


# ---------------------------------------------------------------------------
# سازنده‌های محتوای تست (درج مستقیم — سریع و قطعی)
# ---------------------------------------------------------------------------


async def _make_page(tc, title: str, status: str = "draft", slug: str | None = None):
    from app.models.models import Page

    suffix = _uid()
    async with tc["maker"]() as db:
        page = Page(
            slug=slug or f"p14-{suffix}",
            title=_L(title),
            blocks=[],
            seo_meta={},
            content_type="page",
            workflow_status=status,
            published_at=_now() if status == "published" else None,
        )
        db.add(page)
        await db.commit()
        await db.refresh(page)
        return str(page.id)


async def _make_banner(tc, title: str, status: str = "draft"):
    from app.models.models import Banner

    async with tc["maker"]() as db:
        banner = Banner(title=_L(title), media={}, workflow_status=status)
        db.add(banner)
        await db.commit()
        await db.refresh(banner)
        return str(banner.id)


async def _make_library_item(tc, title: str, status: str = "draft",
                             author_id: str | None = None):
    from app.models.models import LibraryItem

    async with tc["maker"]() as db:
        item = LibraryItem(
            kind="pdf", title=_L(title), media_key=f"p14/{_uid()}.pdf",
            workflow_status=status, created_by=uuid.UUID(author_id) if author_id else None,
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)
        return str(item.id)


async def _make_submission(tc, title: str, author_id: str, status: str = "draft"):
    from app.models.models import FatwaSubmission

    async with tc["maker"]() as db:
        sub = FatwaSubmission(
            title=_L(title), body="متن فتوای تست", author_id=uuid.UUID(author_id),
            workflow_status=status,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        return str(sub.id)


async def _make_course(tc, title: str):
    from app.models.models import Course

    async with tc["maker"]() as db:
        course = Course(title=_L(title), is_active=True)
        db.add(course)
        await db.commit()
        await db.refresh(course)
        return str(course.id)


async def _make_post(tc, author_id: str, body: str):
    from app.models.models import SocialPost

    async with tc["maker"]() as db:
        post = SocialPost(author_id=uuid.UUID(author_id), body=body)
        db.add(post)
        await db.commit()
        await db.refresh(post)
        return str(post.id)


# ---------------------------------------------------------------------------
# ۱) صندوق واحد: جست‌وجو/فیلتر روی ≥۳ دامنه + صفحه‌بندی کرسری
# ---------------------------------------------------------------------------


async def test_unified_inbox_search_across_domains(tc):
    admin = await _make_user(tc, P14_PERMS)
    kw = f"صندوق‌تست-{_uid()}"
    author = await _make_user(tc, ())
    page_id = await _make_page(tc, f"{kw} صفحه", status="published")
    item_id = await _make_library_item(tc, f"{kw} کتاب", status="published")
    sub_id = await _make_submission(tc, f"{kw} فتوا", author["user_id"],
                                    status="published")
    await _make_course(tc, f"{kw} دوره")
    await _make_post(tc, author["user_id"], f"{kw} پست اجتماعی")

    client = tc["client"]
    r = await client.get(f"{BASE}/admin/content/items",
                         params={"q": kw, "limit": 50}, headers=admin)
    assert r.status_code == 200, r.text
    data = r.json()
    domains = {it["domain"] for it in data["items"]}
    # حداقل ۳ دامنه: content، library، fatwa (+lms و social هم ثبت‌اند)
    assert {"content", "library", "fatwa"} <= domains, domains
    ids = {it["id"] for it in data["items"]}
    assert {page_id, item_id, sub_id} <= ids

    # فیلتر دامنه
    r = await client.get(f"{BASE}/admin/content/items",
                         params={"q": kw, "domain": "library"}, headers=admin)
    assert r.status_code == 200
    items = r.json()["items"]
    assert items and all(it["domain"] == "library" for it in items)

    # فیلتر وضعیت
    r = await client.get(f"{BASE}/admin/content/items",
                         params={"q": kw, "status": "published"}, headers=admin)
    assert r.status_code == 200
    assert all(it["status"] == "published" for it in r.json()["items"])

    # فیلتر نویسنده
    r = await client.get(f"{BASE}/admin/content/items",
                         params={"q": kw, "author_id": author["user_id"]},
                         headers=admin)
    assert r.status_code == 200
    got = r.json()["items"]
    assert got and all(it["author_id"] == author["user_id"] for it in got)


async def test_unified_inbox_cursor_pagination(tc):
    admin = await _make_user(tc, P14_PERMS)
    kw = f"صفحه‌بندی-{_uid()}"
    for i in range(3):
        await _make_page(tc, f"{kw} {i}")
    client = tc["client"]
    r1 = await client.get(f"{BASE}/admin/content/items",
                          params={"q": kw, "limit": 2}, headers=admin)
    assert r1.status_code == 200
    d1 = r1.json()
    assert len(d1["items"]) == 2
    assert d1["next_cursor"]
    r2 = await client.get(f"{BASE}/admin/content/items",
                          params={"q": kw, "limit": 2,
                                  "cursor": d1["next_cursor"]}, headers=admin)
    assert r2.status_code == 200
    d2 = r2.json()
    assert len(d2["items"]) == 1
    assert d2["items"][0]["id"] not in {it["id"] for it in d1["items"]}


async def test_inbox_requires_permission(tc):
    outsider = await _make_user(tc, ())
    r = await tc["client"].get(f"{BASE}/admin/content/items", headers=outsider)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# ۲) عملیات گروهی: رد RBAC + audit + idempotency
# ---------------------------------------------------------------------------


async def test_bulk_rbac_denial(tc):
    outsider = await _make_user(tc, ())
    page_id = await _make_page(tc, f"bulk-{_uid()}")
    r = await tc["client"].post(
        f"{BASE}/admin/content/bulk", headers=outsider,
        json={"items": [{"domain": "content", "content_type": "page",
                         "id": page_id}],
              "action": "transition", "params": {"to": "in_review"}})
    assert r.status_code == 403


async def test_bulk_transition_with_audit_and_idempotency(tc):
    from app.models.models import AuditLog, Page

    admin = await _make_user(tc, P14_PERMS)
    p1 = await _make_page(tc, f"bulk-a-{_uid()}")
    p2 = await _make_banner(tc, f"bulk-b-{_uid()}")
    client = tc["client"]
    body = {"items": [{"domain": "content", "content_type": "page", "id": p1},
                      {"domain": "content", "content_type": "banner", "id": p2}],
            "action": "transition", "params": {"to": "in_review"}}
    r = await client.post(f"{BASE}/admin/content/bulk", headers=admin, json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["succeeded"] == 2 and data["failed"] == 0
    assert all(x["ok"] and not x.get("skipped") for x in data["results"])

    # وضعیت‌ها واقعاً عوض شدند
    async with tc["maker"]() as db:
        assert (await db.get(Page, uuid.UUID(p1))).workflow_status == "in_review"
        # audit به‌ازای هر آیتمِ تغییرکرده
        rows = (await db.execute(
            select(AuditLog).where(
                AuditLog.action == "content.bulk.transition",
                AuditLog.entity_id.in_([p1, p2])))).scalars().all()
        assert len(rows) == 2, f"expected 2 audit rows, got {len(rows)}"

    # تکرار همان عملیات → idempotent: skipped، بدون audit جدید
    r = await client.post(f"{BASE}/admin/content/bulk", headers=admin, json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["succeeded"] == 2 and data["skipped"] == 2
    async with tc["maker"]() as db:
        rows = (await db.execute(
            select(AuditLog).where(
                AuditLog.action == "content.bulk.transition",
                AuditLog.entity_id.in_([p1, p2])))).scalars().all()
        assert len(rows) == 2


async def test_bulk_transition_errors_reported_per_item(tc):
    admin = await _make_user(tc, P14_PERMS)
    p1 = await _make_page(tc, f"bulk-err-{_uid()}")  # draft
    course_id = await _make_course(tc, f"bulk-err-c-{_uid()}")  # بدون گردش‌کار
    r = await tc["client"].post(
        f"{BASE}/admin/content/bulk", headers=admin,
        json={"items": [
            {"domain": "content", "content_type": "page", "id": p1},
            {"domain": "lms", "content_type": "course", "id": course_id},
            {"domain": "content", "content_type": "page",
             "id": "00000000-0000-0000-0000-000000000000"},
        ], "action": "transition", "params": {"to": "published"}})
    assert r.status_code == 200, r.text
    data = r.json()
    by_id = {x["id"]: x for x in data["results"]}
    # draft → published نامعتبر است (جهش)
    assert not by_id[p1]["ok"] and by_id[p1]["error"]["code"] == "invalid_transition"
    # دوره گردش‌کار ندارد
    assert by_id[course_id]["error"]["code"] == "transition_unsupported"
    # آیتم ناموجود
    assert not by_id["00000000-0000-0000-0000-000000000000"]["ok"]
    assert data["failed"] == 3


async def test_bulk_distribution_and_schedule(tc):
    admin = await _make_user(tc, P14_PERMS)
    item_id = await _make_library_item(tc, f"bulk-dist-{_uid()}", status="published")
    future = (_now() + timedelta(days=2)).isoformat()
    r = await tc["client"].post(
        f"{BASE}/admin/content/bulk", headers=admin,
        json={"items": [{"domain": "library", "content_type": "library_item",
                         "id": item_id}],
              "action": "distribution",
              "params": {"channels": {
                  "telegram": {"enabled": True, "scheduled_at": future,
                               "schedule_tz": "Asia/Tehran"},
                  "ai_knowledge": {"enabled": False}}}})
    assert r.status_code == 200, r.text
    assert r.json()["succeeded"] == 1

    r = await tc["client"].get(
        f"{BASE}/admin/content/distribution", headers=admin,
        params={"domain": "library", "content_type": "library_item",
                "id": item_id})
    assert r.status_code == 200
    ch = r.json()["channels"]
    assert ch["telegram"]["enabled"] is True
    assert ch["telegram"]["source"] == "explicit"
    assert ch["telegram"]["schedule_tz"] == "Asia/Tehran"
    assert ch["ai_knowledge"]["enabled"] is False


# ---------------------------------------------------------------------------
# ۳) استقلال توزیع: web منتشر ولی telegram ممنوع → skip در زمان سرو
# ---------------------------------------------------------------------------


async def test_distribution_independence_telegram_skipped(tc, monkeypatch):
    from app.models.models import TelegramPublished
    from app.modules.telegram import bot_service, distribute_service

    admin = await _make_user(tc, P14_PERMS)
    client = tc["client"]
    # آیتم منتشرشده در web
    forbidden_id = await _make_library_item(tc, f"tg-forbidden-{_uid()}",
                                            status="published")
    allowed_id = await _make_library_item(tc, f"tg-allowed-{_uid()}",
                                          status="published")
    # ممنوعیت صریح تلگرام برای اولی
    r = await client.put(
        f"{BASE}/admin/content/distribution", headers=admin,
        params={"domain": "library", "content_type": "library_item",
                "id": forbidden_id},
        json={"channel": "telegram", "enabled": False})
    assert r.status_code == 200, r.text

    sent_calls: list = []

    async def _fake_send(db, chat_id, text, **kwargs):
        sent_calls.append((chat_id, text))
        return 4242

    monkeypatch.setattr(bot_service, "send_message", _fake_send)

    async with tc["maker"]() as db:
        for cid in (forbidden_id, allowed_id):
            db.add(TelegramPublished(
                source_content_type="library_item",
                source_content_id=cid,
                distribution_target="test-channel",
                idempotency_key=f"p14-{_uid()}-{cid[:8]}",
                status="pending",
            ))
        await db.commit()
        rows = (await db.execute(
            select(TelegramPublished)
            .where(TelegramPublished.distribution_target == "test-channel")
            .order_by(TelegramPublished.created_at))).scalars().all()
        row_forbidden = next(r for r in rows
                             if r.source_content_id == forbidden_id)
        row_allowed = next(r for r in rows
                           if r.source_content_id == allowed_id)

        out_forbidden = await distribute_service.send_pending(db, row_forbidden.id)
        out_allowed = await distribute_service.send_pending(db, row_allowed.id)

    assert out_forbidden["status"] == "skipped"
    assert out_forbidden["error"] == "distribution_forbidden"
    assert out_allowed["status"] == "sent"
    assert out_allowed["published_message_id"] == 4242
    # فقط آیتم مجاز واقعاً ارسال شد
    assert len(sent_calls) == 1


# ---------------------------------------------------------------------------
# ۴) اتصالات بیرونی: وضعیت بدون secret + تست با provider جعلی
# ---------------------------------------------------------------------------


async def test_connections_status_hides_secrets(tc):
    admin = await _make_user(tc, P14_PERMS)
    await _set_settings(tc, {
        "ai.claude_api_key": "sk-ant-secret-123",
        "telegram.session": "telethon-session-secret",
        "telegram.phone_masked": "+98***12",
    })
    r = await tc["client"].get(f"{BASE}/admin/connections/status", headers=admin)
    assert r.status_code == 200, r.text
    body = r.text
    assert "sk-ant-secret-123" not in body
    assert "telethon-session-secret" not in body
    data = r.json()
    assert data["ai"]["configured"] is True
    assert data["telegram"]["connected"] is True
    assert data["telegram"]["account"] == "+98***12"
    assert data["payment"]["configured"] is False  # صادقانه: فاز ۱۵
    assert data["sms"]["configured"] is False
    await _clear_settings(tc, ["ai.claude_api_key", "telegram.session",
                               "telegram.phone_masked"])


async def test_connection_test_with_mocked_provider(tc, monkeypatch):
    from app.models.models import AuditLog
    from app.modules.admin import connections_service

    admin = await _make_user(tc, P14_PERMS)

    async def _fake_ai(db, params):
        return {"ok": True, "provider": "fake", "model": "fake-1"}

    monkeypatch.setitem(connections_service.TESTERS, "ai", _fake_ai)
    r = await tc["client"].post(f"{BASE}/admin/connections/test/ai",
                                headers=admin, json={})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True and data["provider"] == "fake"
    assert "latency_ms" in data

    # نتیجه در audit ثبت شده، بدون secret
    async with tc["maker"]() as db:
        row = (await db.execute(
            select(AuditLog).where(
                AuditLog.action == "connections.test.ai")
            .order_by(AuditLog.created_at.desc()))).scalars().first()
        assert row is not None
        assert row.new_values["ok"] is True

    # پرداخت: صادقانه در دسترس نیست
    r = await tc["client"].post(f"{BASE}/admin/connections/test/payment",
                                headers=admin, json={})
    assert r.status_code == 200
    assert r.json()["ok"] is False
    assert r.json()["error"] == "payment_not_available"

    # سرویس ناشناخته
    r = await tc["client"].post(f"{BASE}/admin/connections/test/nope",
                                headers=admin, json={})
    assert r.status_code == 404


async def test_connection_test_rbac(tc):
    outsider = await _make_user(tc, ())
    r = await tc["client"].get(f"{BASE}/admin/connections/status",
                               headers=outsider)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# ۵) اعلان چندکاناله طبق ترجیح کاربر
# ---------------------------------------------------------------------------


async def _set_prefs(tc, user_id: str, prefs: dict[str, bool]):
    from app.models.models import NotificationPreference

    async with tc["maker"]() as db:
        for channel, enabled in prefs.items():
            db.add(NotificationPreference(
                user_id=uuid.UUID(user_id), channel=channel,
                notif_type="product", enabled=enabled))
        await db.commit()


async def test_notification_fanout_honors_preferences(tc, monkeypatch):
    from app.models.models import NotificationDelivery
    from app.modules.admin import notify_service

    admin = await _make_user(tc, P14_PERMS)
    # کاربر sms-only: فقط پیامک فعال، بقیه صریحاً غیرفعال
    u_sms = await _make_user(tc, ())
    await _set_prefs(tc, u_sms["user_id"],
                     {"sms": True, "email": False, "push": False,
                      "in_app": False})
    # کاربر بدون هیچ ترجیحی: فقط in_app پیش‌فرض
    u_plain = await _make_user(tc, ())

    calls: list = []

    async def _fake_email(db, user, title, body):
        calls.append(("email", str(user.id)))
        return True, None

    async def _fake_sms(db, user, title, body):
        calls.append(("sms", str(user.id)))
        return True, None

    monkeypatch.setitem(notify_service.CHANNEL_SENDERS, "email", _fake_email)
    monkeypatch.setitem(notify_service.CHANNEL_SENDERS, "sms", _fake_sms)
    monkeypatch.setitem(notify_service.CHANNEL_CONFIGURED, "email", lambda: True)
    monkeypatch.setitem(notify_service.CHANNEL_CONFIGURED, "sms", lambda: True)

    r = await tc["client"].post(
        f"{BASE}/admin/notifications/broadcast", headers=admin,
        json={"title": "اطلاعیه تست", "body": "متن اطلاعیه",
              "cohort": {"type": "users",
                         "user_ids": [u_sms["user_id"], u_plain["user_id"]]},
              "channels": ["email", "sms", "in_app"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_recipients"] == 2

    by_user: dict[str, dict[str, str]] = {}
    async with tc["maker"]() as db:
        rows = (await db.execute(
            select(NotificationDelivery).where(
                NotificationDelivery.broadcast_id == uuid.UUID(data["id"])))
        ).scalars().all()
        for d in rows:
            by_user.setdefault(str(d.user_id), {})[d.channel] = d.status

    sms_user = by_user[u_sms["user_id"]]
    # کاربر sms-only: فقط sms ارسال شد — ایمیل نگرفت
    assert sms_user["sms"] == "sent"
    assert sms_user["email"] == "skipped"
    assert ("email", u_sms["user_id"]) not in calls
    assert ("sms", u_sms["user_id"]) in calls

    plain_user = by_user[u_plain["user_id"]]
    # کاربر بدون ترجیح: فقط in_app (پیش‌فرض) — ایمیل/پیامک نه
    assert plain_user["in_app"] == "sent"
    assert plain_user["email"] == "skipped"
    assert plain_user["sms"] == "skipped"
    assert ("email", u_plain["user_id"]) not in calls


async def test_notification_honest_sms_degradation(tc):
    """provider پیامک پیکربندی نشده → skip صادقانه، نه موفقیت جعلی."""
    from app.models.models import NotificationDelivery
    from app.modules.admin import notify_service

    admin = await _make_user(tc, P14_PERMS)
    u = await _make_user(tc, ())
    await _set_prefs(tc, u["user_id"], {"sms": True})
    # CHANNEL_CONFIGURED واقعی: sms_api_key خالی → False
    assert notify_service.CHANNEL_CONFIGURED["sms"]() is False

    r = await tc["client"].post(
        f"{BASE}/admin/notifications/broadcast", headers=admin,
        json={"title": "تست", "body": "متن",
              "cohort": {"type": "users", "user_ids": [u["user_id"]]},
              "channels": ["sms"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_sent"] == 0 and data["total_skipped"] == 1
    async with tc["maker"]() as db:
        d = (await db.execute(
            select(NotificationDelivery).where(
                NotificationDelivery.broadcast_id == uuid.UUID(data["id"])))
        ).scalars().one()
        assert d.status == "skipped"
        assert d.skip_reason == "sms_not_configured"


async def test_broadcast_rbac(tc):
    outsider = await _make_user(tc, ())
    r = await tc["client"].post(f"{BASE}/admin/notifications/broadcast",
                               headers=outsider,
                               json={"title": "x", "body": "y",
                                     "channels": ["in_app"]})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# placement / تقویم / تعارض
# ---------------------------------------------------------------------------


async def test_placements_and_calendar_conflict(tc):
    admin = await _make_user(tc, P14_PERMS)
    client = tc["client"]
    p1 = await _make_page(tc, f"cal-a-{_uid()}", status="published")
    p2 = await _make_page(tc, f"cal-b-{_uid()}", status="published")
    now = _now()
    window = {"starts_at": (now - timedelta(hours=1)).isoformat(),
              "ends_at": (now + timedelta(hours=1)).isoformat()}
    for pid in (p1, p2):
        r = await client.put(
            f"{BASE}/admin/content/placements", headers=admin,
            json={"domain": "content", "content_type": "page",
                  "content_id": pid, "surface": "homepage.section",
                  "slot": "hero", **window})
        assert r.status_code == 200, r.text

    r = await client.get(f"{BASE}/admin/content/placements", headers=admin,
                         params={"surface": "homepage.section"})
    assert r.status_code == 200 and len(r.json()) >= 2

    r = await client.get(
        f"{BASE}/admin/content/calendar", headers=admin,
        params={"date_from": (now - timedelta(days=1)).isoformat(),
                "date_to": (now + timedelta(days=1)).isoformat()})
    assert r.status_code == 200, r.text
    data = r.json()
    # تعارض: دو محتوا هم‌زمان در یک slot
    assert len(data["conflicts"]) >= 1
    c = data["conflicts"][0]
    assert c["surface"] == "homepage.section" and c["slot"] == "hero"
    # آیتم‌های منتشرشده در فید هستند
    pub_ids = {it["id"] for it in data["items"] if it["kind"] == "published"}
    assert {p1, p2} <= pub_ids


# ---------------------------------------------------------------------------
# جزئیات یکپارچه
# ---------------------------------------------------------------------------


async def test_item_detail(tc):
    admin = await _make_user(tc, P14_PERMS)
    author = await _make_user(tc, ())
    page_id = await _make_page(tc, f"detail-{_uid()}", status="published")
    async with tc["maker"]() as db:
        from app.models.models import Page

        page = await db.get(Page, uuid.UUID(page_id))
        page.created_by = uuid.UUID(author["user_id"])
        await db.commit()
    r = await tc["client"].get(
        f"{BASE}/admin/content/items/content/page/{page_id}", headers=admin)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["preview"]["title"]
    assert data["workflow"]["status"] == "published"
    assert data["workflow"]["allowed_transitions"] == ["archived"]
    assert data["author"]["id"] == author["user_id"]
    assert "web" in data["distribution"]["channels"]
    assert isinstance(data["audit"], list)
    assert isinstance(data["placements"], list)

    r = await tc["client"].get(
        f"{BASE}/admin/content/items/content/page/00000000-0000-0000-0000-000000000000",
        headers=admin)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# نمای ۳۶۰° کاربر
# ---------------------------------------------------------------------------


async def test_user_360_overview(tc):
    admin = await _make_user(tc, P14_PERMS)
    user = await _make_user(tc, ())
    await _make_post(tc, user["user_id"], f"پست ۳۶۰ درجه {_uid()}")
    await _make_submission(tc, f"فتوای ۳۶۰ {_uid()}", user["user_id"])
    r = await tc["client"].get(f"{BASE}/admin/users/{user['user_id']}/overview",
                               headers=admin)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["profile"]["id"] == user["user_id"]
    assert data["social"]["posts"] == 1
    assert len(data["fatwa"]["submissions"]) == 1
    for key in ("roles", "lms", "library", "notifications", "audit_trail"):
        assert key in data

    # RBAC
    outsider = await _make_user(tc, ())
    r = await tc["client"].get(f"{BASE}/admin/users/{user['user_id']}/overview",
                               headers=outsider)
    assert r.status_code == 403
    # کاربر ناموجود
    r = await tc["client"].get(
        f"{BASE}/admin/users/00000000-0000-0000-0000-000000000000/overview",
        headers=admin)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# نقش/مجوز
# ---------------------------------------------------------------------------


async def test_roles_crud(tc):
    from app.models.models import AuditLog

    admin = await _make_user(tc, P14_PERMS)
    client = tc["client"]
    name = f"p14_role_{_uid()}"

    r = await client.post(f"{BASE}/admin/roles", headers=admin,
                          json={"name": name, "description": "نقش تست",
                                "permission_keys": ["content.bulk"]})
    assert r.status_code == 201, r.text
    role_id = r.json()["id"]
    assert r.json()["permissions"][0]["key"] == "content.bulk"

    r = await client.get(f"{BASE}/admin/roles", headers=admin)
    assert r.status_code == 200
    assert any(x["name"] == name for x in r.json())

    r = await client.put(f"{BASE}/admin/roles/{role_id}", headers=admin,
                         json={"description": "به‌روزشده",
                               "permission_keys": ["content.bulk",
                                                   "connections.test"]})
    assert r.status_code == 200, r.text
    assert len(r.json()["permissions"]) == 2

    async with tc["maker"]() as db:
        row = (await db.execute(
            select(AuditLog).where(AuditLog.action == "roles.create",
                                   AuditLog.entity_id == role_id))
        ).scalars().first()
        assert row is not None

    r = await client.delete(f"{BASE}/admin/roles/{role_id}", headers=admin)
    assert r.status_code == 200

    # مجوز نامعتبر
    r = await client.post(f"{BASE}/admin/roles", headers=admin,
                          json={"name": f"p14_bad_{_uid()}",
                                "permission_keys": ["no.such.perm"]})
    assert r.status_code == 422

    # RBAC
    outsider = await _make_user(tc, ())
    r = await client.get(f"{BASE}/admin/roles", headers=outsider)
    assert r.status_code == 403


async def test_roles_super_admin_protected(tc):
    from app.models.models import Role

    admin = await _make_user(tc, P14_PERMS)
    created = False
    try:
        async with tc["maker"]() as db:
            sa_role = (await db.execute(
                select(Role).where(Role.name == "super_admin"))).scalar_one_or_none()
            if sa_role is None:
                sa_role = Role(name="super_admin", description="sa")
                db.add(sa_role)
                await db.commit()
                await db.refresh(sa_role)
                created = True
            sa_id = str(sa_role.id)
        r = await tc["client"].delete(f"{BASE}/admin/roles/{sa_id}", headers=admin)
        assert r.status_code == 422
        r = await tc["client"].put(f"{BASE}/admin/roles/{sa_id}", headers=admin,
                                   json={"permission_keys": []})
        assert r.status_code == 422
    finally:
        # پاک‌سازی تا تست‌های دیگر (test_auth) که فرض می‌کنند super_admin
        # وجود ندارد، نشکنند — فقط اگر خودمان ساخته باشیم
        if created:
            async with tc["maker"]() as db:
                role = (await db.execute(
                    select(Role).where(Role.name == "super_admin")
                )).scalar_one_or_none()
                if role is not None:
                    await db.delete(role)
                    await db.commit()


# ---------------------------------------------------------------------------
# بیلدها
# ---------------------------------------------------------------------------


async def test_builds_prereqs_rebuild_releases(tc):
    admin = await _make_user(tc, P14_PERMS)
    client = tc["client"]

    r = await client.get(f"{BASE}/admin/builds/prereqs", headers=admin)
    assert r.status_code == 200, r.text
    data = r.json()
    # هیچ گواهی‌ای آپلود نشده — صادقانه گزارش می‌شود
    assert all(not v["present"] for v in data["signing"].values())
    assert data["platforms"]["android"]["ready"] is False
    assert "google_play" in data["platforms"]["android"]["missing"]

    # F-05 remediation: بدون ارائه‌دهندهٔ بیلد پیکربندی‌شده (توکن/repo گیت‌هاب
    # در env تست نیست) rebuild صادقانه 503 است و هیچ «queued» دروغینی ساخته
    # نمی‌شود — جریان dispatch موفق در tests/test_builds_dispatch.py پوشش دارد.
    r = await client.post(f"{BASE}/admin/builds/rebuild", headers=admin,
                          json={"platform": "android", "version": "1.0.0"})
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "build_provider_not_configured"
    r = await client.get(f"{BASE}/admin/builds/prereqs", headers=admin)
    assert r.json()["provider"]["configured"] is False

    r = await client.get(f"{BASE}/admin/builds/releases", headers=admin)
    assert r.status_code == 200 and r.json() == []

    # ثبت نسخهٔ امضاشده (CI) — download_url فقط وقتی signed
    r = await client.post(f"{BASE}/admin/builds/releases", headers=admin,
                          json={"platform": "android", "version": "1.0.0",
                                "build_number": "42", "signed": False,
                                "download_url": "https://example.com/app.apk"})
    assert r.status_code == 201, r.text
    assert r.json()["download_url"] is None  # امضانشده → لینک نمی‌دهد
    assert r.json()["signed"] is False

    r = await client.post(f"{BASE}/admin/builds/releases", headers=admin,
                          json={"platform": "android", "version": "1.0.1",
                                "build_number": "43", "signed": True,
                                "download_url": "https://example.com/app-101.apk"})
    assert r.status_code == 201
    assert r.json()["download_url"] == "https://example.com/app-101.apk"

    r = await client.get(f"{BASE}/admin/builds/releases",
                         params={"platform": "android"}, headers=admin)
    assert len(r.json()) == 2

    outsider = await _make_user(tc, ())
    r = await client.get(f"{BASE}/admin/builds/releases", headers=outsider)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# پوشش تکمیلی endpointهای باقی‌مانده
# ---------------------------------------------------------------------------


async def test_remaining_endpoints_coverage(tc):
    admin = await _make_user(tc, P14_PERMS)
    client = tc["client"]

    # فهرست adapterها
    r = await client.get(f"{BASE}/admin/content/adapters", headers=admin)
    assert r.status_code == 200
    adapters = r.json()
    assert len(adapters) >= 11
    assert any(a["domain"] == "fatwa" and a["content_type"] == "fatwa_submission"
               for a in adapters)

    # کانال‌های اعلان + وضعیت پیکربندی
    r = await client.get(f"{BASE}/admin/notifications/channels", headers=admin)
    assert r.status_code == 200
    chs = {c["key"]: c["configured"] for c in r.json()["channels"]}
    assert chs["in_app"] is True
    assert chs["sms"] is False  # sms_api_key تنظیم نشده — صادقانه

    # آمار تحویل (خالی ولی ۲۰۰)
    r = await client.get(f"{BASE}/admin/notifications/delivery-stats",
                         headers=admin)
    assert r.status_code == 200

    # فهرست پخش‌ها
    r = await client.get(f"{BASE}/admin/notifications/broadcasts", headers=admin)
    assert r.status_code == 200 and isinstance(r.json(), list)

    # صف درخواست‌های بیلد
    r = await client.get(f"{BASE}/admin/builds/requests", headers=admin)
    assert r.status_code == 200 and isinstance(r.json(), list)

    # فهرست مجوزها
    r = await client.get(f"{BASE}/admin/roles/permissions", headers=admin)
    assert r.status_code == 200
    keys = {p["key"] for p in r.json()}
    assert {"content.bulk", "connections.test", "builds.manage",
            "notifications.broadcast", "users.view360",
            "roles.manage"} <= keys

    # حذف placement
    page_id = await _make_page(tc, f"del-place-{_uid()}")
    r = await client.put(f"{BASE}/admin/content/placements", headers=admin,
                         json={"domain": "content", "content_type": "page",
                               "content_id": page_id,
                               "surface": "banner_area"})
    assert r.status_code == 200
    pid = r.json()["id"]
    r = await client.delete(f"{BASE}/admin/content/placements/{pid}",
                            headers=admin)
    assert r.status_code == 200
    r = await client.get(f"{BASE}/admin/content/placements", headers=admin,
                         params={"surface": "banner_area",
                                 "content_id": page_id})
    assert r.json() == []

    # placement نامعتبر (دامنهٔ ناشناخته)
    r = await client.put(f"{BASE}/admin/content/placements", headers=admin,
                         json={"domain": "nope", "content_type": "x",
                               "content_id": page_id, "surface": "banner_area"})
    assert r.status_code == 404

    # distribution کانال نامعتبر
    r = await client.put(f"{BASE}/admin/content/distribution", headers=admin,
                         params={"domain": "content", "content_type": "page",
                                 "id": page_id},
                         json={"channel": "nope", "enabled": True})
    assert r.status_code == 422

    # تقویم با ورودی تاریخ naive (باید UTC فرض شود، نه خطا)
    r = await client.get(f"{BASE}/admin/content/calendar", headers=admin,
                         params={"date_from": "2026-01-01T00:00:00",
                                 "date_to": "2026-12-31T23:59:59"})
    assert r.status_code == 200
