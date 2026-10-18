"""تست‌های CMS و تقویم اسلامی — فاز ۴.

روی دیتابیس SQLite مشترک (فیکسچر tc)؛ داده‌ها با کلیدهای یکتا ساخته می‌شوند.
توکن ادمین مستقیم با create_access_token ساخته می‌شود (بدون sid) تا به
rate-limit لاگین تست‌های دیگر نخوریم.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

BASE = "/api/v1/content"

_LT = {"fa": "متن فارسی", "ar": "نص عربي", "en": "English text"}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_admin(tc):
    """کاربر ادمین با مجوزهای content.create و content.publish + توکن."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = {}
        for key in ("content.create", "content.publish"):
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms[key] = p
        role = (
            await db.execute(select(Role).where(Role.name == "cms_manager_test"))
        ).scalar_one_or_none()
        if role is None:
            role = Role(name="cms_manager_test", description="cms test role")
            db.add(role)
            await db.flush()
            for p in perms.values():
                db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="ادمین تست",
            email=f"cms-admin-{suffix}@example.com",
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


def _authz(h: dict) -> dict:
    return {"Authorization": h["Authorization"]}


# ---------------------------------------------------------------------------
# گردش‌کار §۹
# ---------------------------------------------------------------------------


async def test_page_workflow_transitions(tc):
    client = tc["client"]
    h = await _make_admin(tc)

    body = {
        "slug": f"test-page-{_uid()}",
        "title": _LT,
        "blocks": [{"type": "paragraph", "text": _LT}],
        "content_type": "page",
    }
    r = await client.post(f"{BASE}/pages", json=body, headers=_authz(h))
    assert r.status_code == 201, r.text
    page = r.json()
    assert page["workflow_status"] == "draft"
    assert page["version"] == 1
    pid = page["id"]

    # گذار نامعتبر: draft → published مستقیم ممنوع است
    r = await client.post(
        f"{BASE}/pages/{pid}/transition", json={"to": "published"}, headers=_authz(h)
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_transition"

    # وضعیت ناشناخته
    r = await client.post(
        f"{BASE}/pages/{pid}/transition", json={"to": "nope"}, headers=_authz(h)
    )
    assert r.status_code == 422

    # مسیر درست: draft → in_review → approved → published
    for nxt in ("in_review", "approved", "published"):
        r = await client.post(
            f"{BASE}/pages/{pid}/transition", json={"to": nxt}, headers=_authz(h)
        )
        assert r.status_code == 200, r.text
    page = r.json()
    assert page["workflow_status"] == "published"
    assert page["version"] == 4
    assert page["published_at"] is not None
    # پیش‌فرض distribution هنگام انتشار (ADR-002): فقط web=true
    assert page["distribution"]["web"] is True
    assert page["distribution"]["mobile"] is False
    assert page["distribution"]["ai_knowledge"] is False

    # published → draft ممنوع (فقط archived)
    r = await client.post(
        f"{BASE}/pages/{pid}/transition", json={"to": "draft"}, headers=_authz(h)
    )
    assert r.status_code == 422

    # رویدادهای دامنه برای هر گذار ثبت شده‌اند
    from app.models.models import DomainEvent

    async with tc["maker"]() as db:
        evts = (
            await db.execute(
                select(DomainEvent.event_type).where(
                    DomainEvent.aggregate_type == "page",
                    DomainEvent.aggregate_id == pid,
                )
            )
        ).scalars().all()
    assert "page.created" in evts
    assert "page.published" in evts

    # DELETE = بایگانی
    r = await client.delete(f"{BASE}/pages/{pid}", headers=_authz(h))
    assert r.status_code == 200
    assert r.json()["workflow_status"] == "archived"


async def test_publish_requires_publish_permission(tc):
    client = tc["client"]
    h = await _make_admin(tc)
    # حذف مجوز publish از نقش تستی برای این سناریو — کاربر دوم بدون publish
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        p_create = (
            await db.execute(
                select(Permission).where(Permission.key == "content.create")
            )
        ).scalar_one()
        role = Role(name=f"cms_creator_{suffix}")
        db.add(role)
        await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=p_create.id))
        user = User(
            full_name="سازنده",
            email=f"cms-creator-{suffix}@example.com",
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
    h2 = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        f"{BASE}/pages",
        json={"slug": f"nopub-{suffix}", "title": _LT, "content_type": "page"},
        headers=h2,
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    # ساخت و in_review با content.create آزاد است
    r = await client.post(
        f"{BASE}/pages/{pid}/transition", json={"to": "in_review"}, headers=h2
    )
    assert r.status_code == 200, r.text
    # انتشار بدون content.publish ممنوع است
    r = await client.post(
        f"{BASE}/pages/{pid}/transition",
        json={"to": "approved"},
        headers=h2,
    )
    assert r.status_code == 200  # approved انتشار نیست
    r = await client.post(
        f"{BASE}/pages/{pid}/transition", json={"to": "published"}, headers=h2
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


# ---------------------------------------------------------------------------
# کرون تقویم اسلامی — نیمهٔ شعبان
# ---------------------------------------------------------------------------


def _mid_shaban_gregorian() -> date:
    """یک تاریخ میلادی که در تقویم hijri-converter برابر ۱۵ شعبان است."""
    from hijri_converter import Gregorian

    d = date(2026, 1, 1)
    while d < date(2029, 1, 1):
        h = Gregorian(d.year, d.month, d.day).to_hijri()
        if (h.month, h.day) == (8, 15):
            return d
        d += timedelta(days=1)
    raise AssertionError("no 15 Shaban found in range")


async def _make_theme(tc, name_fa: str, active: bool = False):
    from app.models.models import Theme

    async with tc["maker"]() as db:
        t = Theme(
            name={"fa": name_fa, "ar": name_fa, "en": name_fa}, is_active=active
        )
        db.add(t)
        await db.commit()
        await db.refresh(t)
        return str(t.id)


async def test_calendar_cycle_mid_shaban_theme_switch_and_revert(tc):
    from app.core.platform_settings import reset_settings_cache, stage_setting
    from app.modules.content import cms_service

    reset_settings_cache()
    default_theme = await _make_theme(tc, "تم پیش‌فرض تست", active=True)
    shaban_theme = await _make_theme(tc, "تم نیمه شعبان تست")
    today = _mid_shaban_gregorian()
    slug_suffix = _uid()

    async with tc["maker"]() as db:
        await stage_setting(db, cms_service.CALENDAR_DEFAULT_THEME_KEY, default_theme)
        await stage_setting(db, cms_service.CALENDAR_ACTIVE_KEY, json.dumps({}))
        await db.commit()
    reset_settings_cache()

    client = tc["client"]
    h = await _make_admin(tc)
    # رویداد نیمهٔ شعبان: انتشار خودکار، بدون نیاز به تأیید ادمین
    r = await client.post(
        f"{BASE}/events",
        json={
            "name": _LT,
            "hijri_month": 8,
            "hijri_day": 15,
            "auto_publish": True,
            "needs_admin_confirmation": False,
            "theme_id": shaban_theme,
        },
        headers=_authz(h),
    )
    assert r.status_code == 201, r.text
    event_id = r.json()["id"]

    # اجرای کرون با «امروز» تزریقی = نیمهٔ شعبان
    async with tc["maker"]() as db:
        result = await cms_service.run_islamic_calendar_cycle(db, today=today)
    assert result["hijri"] == {"month": 8, "day": 15}
    assert event_id in result["published"]
    assert result["theme"]["action"] == "activated"
    assert result["theme"]["theme_id"] == shaban_theme

    # وضعیت رویداد published شده و رویداد دامنه ثبت شده است
    r = await client.get(f"{BASE}/events/{event_id}", headers=_authz(h))
    assert r.json()["workflow_status"] == "published"

    # اجرای دوباره در همان روز idempotent است
    async with tc["maker"]() as db:
        result2 = await cms_service.run_islamic_calendar_cycle(db, today=today)
    assert result2["theme"]["action"] == "unchanged"
    assert result2["published"] == []

    # روز بعد: هیچ رویدادی نیست → بازگشت به تم پیش‌فرض
    async with tc["maker"]() as db:
        result3 = await cms_service.run_islamic_calendar_cycle(
            db, today=today + timedelta(days=1)
        )
    assert result3["theme"]["action"] == "reverted"
    assert result3["theme"]["theme_id"] == default_theme
    assert f"cms-event-{slug_suffix}" not in json.dumps(result3)  # sanity


async def test_calendar_cycle_respects_admin_confirmation(tc):
    from app.core.platform_settings import reset_settings_cache
    from app.modules.content import cms_service

    reset_settings_cache()
    today = _mid_shaban_gregorian()
    client = tc["client"]
    h = await _make_admin(tc)

    async def make_event(status_flow: list[str]):
        r = await client.post(
            f"{BASE}/events",
            json={
                "name": _LT,
                "hijri_month": 8,
                "hijri_day": 15,
                "auto_publish": True,
                "needs_admin_confirmation": True,  # نیازمند تأیید ادمین
            },
            headers=_authz(h),
        )
        assert r.status_code == 201, r.text
        eid = r.json()["id"]
        for nxt in status_flow:
            rr = await client.post(
                f"{BASE}/events/{eid}/transition", json={"to": nxt}, headers=_authz(h)
            )
            assert rr.status_code == 200, rr.text
        return eid

    # در انتظار تأیید (draft): کرون منتشرش نمی‌کند
    pending = await make_event([])
    # تأییدشده توسط ادمین (approved): کرون منتشرش می‌کند
    approved = await make_event(["in_review", "approved"])

    async with tc["maker"]() as db:
        await cms_service.run_islamic_calendar_cycle(db, today=today)

    r = await client.get(f"{BASE}/events/{pending}", headers=_authz(h))
    assert r.json()["workflow_status"] == "draft"
    r = await client.get(f"{BASE}/events/{approved}", headers=_authz(h))
    assert r.json()["workflow_status"] == "published"


# ---------------------------------------------------------------------------
# ناوبری: درخت + sort_order
# ---------------------------------------------------------------------------


async def test_nav_ordering_parent_child(tc):
    client = tc["client"]
    h = await _make_admin(tc)
    sfx = _uid()

    async def nav(label_fa, parent=None, order=0, locale=None):
        body = {
            "label": {"fa": label_fa, "ar": label_fa, "en": label_fa},
            "url": f"/x-{sfx}",
            "sort_order": order,
        }
        if parent:
            body["parent_id"] = parent
        if locale:
            body["locale"] = locale
        r = await client.post(f"{BASE}/nav", json=body, headers=_authz(h))
        assert r.status_code == 201, r.text
        return r.json()["id"]

    root_b = await nav(f"ریشه ب {sfx}", order=20)
    root_a = await nav(f"ریشه الف {sfx}", order=10)
    child_2 = await nav(f"فرزند ۲ {sfx}", parent=root_a, order=2)
    child_1 = await nav(f"فرزند ۱ {sfx}", parent=root_a, order=1)
    await nav(f"انگلیسی {sfx}", parent=root_a, order=0, locale="en")

    # عمومی fa: ریشه‌ها مرتب، فرزندها مرتب، آیتم en حذف شده
    r = await client.get(f"{BASE}/public/nav", params={"locale": "fa"})
    assert r.status_code == 200
    tree = r.json()
    labels = [n["label"]["fa"] for n in tree if sfx in n["label"]["fa"]]
    assert labels.index(f"ریشه الف {sfx}") < labels.index(f"ریشه ب {sfx}")
    node_a = next(n for n in tree if n["id"] == root_a)
    child_labels = [c["label"]["fa"] for c in node_a["children"]]
    assert child_labels == [f"فرزند ۱ {sfx}", f"فرزند ۲ {sfx}"]

    # عمومی en: آیتم en هم دیده می‌شود
    r = await client.get(f"{BASE}/public/nav", params={"locale": "en"})
    node_a_en = next(n for n in r.json() if n["id"] == root_a)
    assert any(c["label"]["fa"] == f"انگلیسی {sfx}" for c in node_a_en["children"])

    # DELETE روی nav یعنی visible=false (نه حذف فیزیکی)
    r = await client.delete(f"{BASE}/nav/{root_b}", headers=_authz(h))
    assert r.status_code == 200
    assert r.json()["visible"] is False
    r = await client.get(f"{BASE}/public/nav", params={"locale": "fa"})
    assert root_b not in [n["id"] for n in r.json()]


# ---------------------------------------------------------------------------
# بنر: پنجرهٔ زمانی
# ---------------------------------------------------------------------------


async def _publish_banner(client, h, sfx, **kw):
    body = {
        "title": _LT,
        "media": {"type": "image", "url": "https://example.com/b.png"},
        "placement": f"test-{sfx}",
    }
    body.update(kw)
    r = await client.post(f"{BASE}/banners", json=body, headers=_authz(h))
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    for nxt in ("in_review", "approved", "published"):
        rr = await client.post(
            f"{BASE}/banners/{bid}/transition", json={"to": nxt}, headers=_authz(h)
        )
        assert rr.status_code == 200, rr.text
    return bid


async def test_banner_scheduling_window(tc):
    client = tc["client"]
    h = await _make_admin(tc)
    sfx = _uid()
    now = datetime.now(timezone.utc)

    active = await _publish_banner(
        client,
        h,
        sfx,
        starts_at=(now - timedelta(hours=1)).isoformat(),
        ends_at=(now + timedelta(hours=1)).isoformat(),
    )
    future = await _publish_banner(
        client,
        h,
        sfx,
        starts_at=(now + timedelta(days=1)).isoformat(),
        ends_at=(now + timedelta(days=2)).isoformat(),
    )
    expired = await _publish_banner(
        client,
        h,
        sfx,
        starts_at=(now - timedelta(days=2)).isoformat(),
        ends_at=(now - timedelta(days=1)).isoformat(),
    )
    # پیش‌نویس منتشرنشده هم نباید دیده شود
    r = await client.post(
        f"{BASE}/banners",
        json={"title": _LT, "placement": f"test-{sfx}"},
        headers=_authz(h),
    )
    draft = r.json()["id"]

    r = await client.get(f"{BASE}/public/banners", params={"placement": f"test-{sfx}"})
    assert r.status_code == 200
    ids = [b["id"] for b in r.json()]
    assert active in ids
    assert future not in ids
    assert expired not in ids
    assert draft not in ids


# ---------------------------------------------------------------------------
# صفحه‌های حقوقی + رضایت هنگام ثبت‌نام
# ---------------------------------------------------------------------------


async def test_legal_pages_seed_and_consent_version(tc):
    from app.modules.content import cms_service
    from app.modules.content.legal import LEGAL_TEXT_VERSION

    async with tc["maker"]() as db:
        await cms_service.seed_legal_pages(db)
        await cms_service.seed_legal_pages(db)  # دوباره — باید idempotent باشد

    client = tc["client"]
    for slug in ("terms", "privacy"):
        r = await client.get(f"{BASE}/public/pages/slug/{slug}")
        assert r.status_code == 200, r.text
        page = r.json()
        assert page["workflow_status"] == "published"
        assert page["slug"] == slug
        assert len(page["blocks"]) > 3  # محتوای واقعی، نه lorem
        for lang in ("fa", "ar", "en"):
            assert page["title"][lang]
            assert "lorem" not in page["blocks"][1]["text"][lang].lower()

    # ثبت‌نام → ردیف‌های رضایت با نسخهٔ جاری متن حقوقی
    email = f"consent-{_uid()}@example.com"
    r = await client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "کاربر رضایت",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text

    from app.core.security import create_access_token  # noqa
    from app.models.models import User, UserConsent

    async with tc["maker"]() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        rows = (
            await db.execute(
                select(UserConsent).where(UserConsent.user_id == user.id)
            )
        ).scalars().all()
    types = {c.consent_type: c.text_version for c in rows}
    assert types == {"terms": LEGAL_TEXT_VERSION, "privacy": LEGAL_TEXT_VERSION}


# ---------------------------------------------------------------------------
# home/sections: ترتیب و نمایش از CMS
# ---------------------------------------------------------------------------


async def test_home_sections_respect_cms_order_and_visibility(tc):
    from app.models.models import HomeSection

    sfx = _uid()
    async with tc["maker"]() as db:
        for key, order, visible in (
            (f"cms-z-{sfx}", 30, True),
            (f"cms-a-{sfx}", 10, True),
            (f"cms-hidden-{sfx}", 5, False),
        ):
            db.add(
                HomeSection(
                    key=key,
                    sort_order=order,
                    visible=visible,
                    title={"fa": key, "ar": key, "en": key},
                )
            )
        await db.commit()

    client = tc["client"]
    r = await client.get("/api/v1/home/sections")
    assert r.status_code == 200
    keys = [s["key"] for s in r.json()["sections"]]
    mine = [k for k in keys if sfx in k]
    assert mine == [f"cms-a-{sfx}", f"cms-z-{sfx}"]  # مرتب + مخفی حذف شده

    # پاک‌سازی — دیتابیس تست بین فایل‌ها مشترک است و test_home لیست دقیق می‌خواهد
    from sqlalchemy import delete as sa_delete

    async with tc["maker"]() as db:
        await db.execute(
            sa_delete(HomeSection).where(HomeSection.key.like(f"%{sfx}%"))
        )
        await db.commit()


# ---------------------------------------------------------------------------
# نقل‌قول‌ها و اعلان‌های عمومی
# ---------------------------------------------------------------------------


async def test_public_quotes_and_announcements(tc):
    client = tc["client"]
    h = await _make_admin(tc)
    sfx = _uid()
    placement = f"q-{sfx}"

    r = await client.post(
        f"{BASE}/quotes",
        json={"text": _LT, "scholar": _LT, "placements": [placement]},
        headers=_authz(h),
    )
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    for nxt in ("in_review", "approved", "published"):
        await client.post(
            f"{BASE}/quotes/{qid}/transition", json={"to": nxt}, headers=_authz(h)
        )

    r = await client.get(f"{BASE}/public/quotes", params={"placement": placement})
    assert r.status_code == 200
    assert any(q["id"] == qid for q in r.json())
    r = await client.get(f"{BASE}/public/quotes", params={"placement": "elsewhere"})
    assert all(q["id"] != qid for q in r.json())

    r = await client.post(
        f"{BASE}/announcements",
        json={"message": _LT, "placement": f"a-{sfx}"},
        headers=_authz(h),
    )
    aid = r.json()["id"]
    for nxt in ("in_review", "approved", "published"):
        await client.post(
            f"{BASE}/announcements/{aid}/transition", json={"to": nxt}, headers=_authz(h)
        )
    r = await client.get(f"{BASE}/public/announcements", params={"placement": f"a-{sfx}"})
    assert r.status_code == 200
    assert any(a["id"] == aid for a in r.json())
    assert r.json()[0]["dismissible"] is True


async def test_calendar_theme_public_endpoint(tc):
    from app.core.platform_settings import reset_settings_cache, stage_setting
    from app.modules.content import cms_service

    reset_settings_cache()
    async with tc["maker"]() as db:
        await stage_setting(
            db,
            cms_service.CALENDAR_ACTIVE_KEY,
            json.dumps({"event_id": "e1", "theme_id": "t1", "activated_at": None}),
        )
        await db.commit()
    reset_settings_cache()

    client = tc["client"]
    r = await client.get(f"{BASE}/public/calendar/theme")
    assert r.status_code == 200
    body = r.json()
    assert body["theme_id"] == "t1"
    assert body["event_id"] == "e1"
    assert body["hijri"]["month"] in range(1, 13)
