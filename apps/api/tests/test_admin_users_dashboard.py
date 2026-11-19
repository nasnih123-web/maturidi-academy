"""تست‌های فاز C — داشبورد کاربران CRM + بخش‌های تازهٔ نمای ۳۶۰°.

پوشش:
- پارس User-Agent (مرورگر/OS/کلاس دستگاه).
- لیست داشبورد: غنی‌سازی ردیف (وضعیت ثبت‌نام، کشور مؤثر، IP/دستگاه
  ثبت‌نام و آخرین فعالیت، شمارش‌ها) + جست‌وجو/فیلتر/مرتب‌سازی.
- آمار سربرگ (به‌صورت تفاضلی — دیتابیس تست بین فایل‌ها مشترک است).
- RBAC و اعتبارسنجی فیلترها.
- نمای ۳۶۰°: بخش‌های registration/sessions/donations/hifz فاز C.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

BASE = "/api/v1"
PERMS = ("users.view360",)

CHROME_ANDROID = (
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36"
)
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 "
    "Safari/604.1"
)
FIREFOX_WIN = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) "
    "Gecko/20100101 Firefox/121.0"
)


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _t(day: int) -> datetime:
    return datetime(2026, 1, day, 12, 0, tzinfo=UTC)


async def _make_user(tc, permissions: tuple[str, ...] = (), **overrides):
    """کاربر تست + هدر احراز — الگوی test_admin_phase14 (RBAC واقعی)."""
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
        role = Role(name=f"dash_test_role_{suffix}", description="phase C test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        fields = {
            "full_name": "کاربر داشبورد",
            "email": f"dash-{suffix}@example.com",
            "phone": None,
            "password_hash": hash_password("TestPass123"),
            "locale": "fa",
            "is_active": True,
            "is_verified": True,
        }
        fields.update(overrides)
        user = User(**fields)
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


async def _seed_activity(tc, user_id: str, *, register=None, sessions=(),
                         marker=False, fatwa=0, attempts=0, tests=0,
                         donations=()):
    """ردیف‌های جانبی یک کاربر داشبورد: نشانگر، audit ثبت‌نام، نشست، فعالیت."""
    from app.models.models import (
        AuditLog,
        ClusterMember,
        Donation,
        HifzAttempt,
        HifzTest,
        PasswordResetToken,
        PaymentIntent,
        QuestionCluster,
        Session,
    )

    uid = uuid.UUID(user_id)
    async with tc["maker"]() as db:
        if marker:
            db.add(PasswordResetToken(
                user_id=uid, token_hash=f"marker-{_uid()}",
                purpose="password_setup",
                expires_at=_t(20) + timedelta(days=7), used=False,
            ))
        if register is not None:
            ip, ua, at = register
            db.add(AuditLog(
                actor_id=uid, actor_type="user", action="user.register",
                entity_type="user", entity_id=str(uid),
                ip=ip, user_agent=ua, created_at=at,
            ))
        for ip, ua, created, active in sessions:
            db.add(Session(
                user_id=uid, device_info=ua, ip=ip,
                created_at=created, last_active_at=active, revoked=False,
            ))
        for i in range(fatwa):
            cluster = QuestionCluster(representative_question=f"سوال {_uid()}")
            db.add(cluster)
            await db.flush()
            db.add(ClusterMember(
                cluster_id=cluster.id, question_text="متن سوال",
                user_id=uid, source="direct",
            ))
        for _ in range(attempts):
            db.add(HifzAttempt(user_id=uid, surah=1, status="completed"))
        for _ in range(tests):
            db.add(HifzTest(user_id=uid, surah_start=1, surah_end=2))
        for amount, status in donations:
            intent = PaymentIntent(
                idempotency_key=f"dash-{_uid()}", amount=amount,
                currency="IRR", donor_id=uid, status="succeeded",
                gateway="card",
            )
            db.add(intent)
            await db.flush()
            db.add(Donation(
                donor_id=uid, payment_intent_id=intent.id, gateway="card",
                gateway_reference=f"ref-{_uid()}", status=status,
                amount=amount, currency="IRR",
            ))
        await db.commit()


async def _make_avatar(tc) -> str:
    from app.models.models import MediaAsset

    async with tc["maker"]() as db:
        asset = MediaAsset(
            owner_id=None, kind="image", storage_key=f"avatars/x-{_uid()}.png",
            mime_type="image/png", size_bytes=10, visibility="public",
        )
        db.add(asset)
        await db.commit()
        return str(asset.id)


# ---------------------------------------------------------------------------
# پارس UA
# ---------------------------------------------------------------------------


def test_parse_user_agent():
    from app.core.user_agent import parse_user_agent

    p = parse_user_agent(CHROME_ANDROID)
    assert p["browser"] == "Chrome" and p["browser_major"] == "120"
    assert p["os"] == "Android" and p["device"] == "mobile"

    p = parse_user_agent(SAFARI_IPHONE)
    assert p["browser"] == "Safari" and p["os"] == "iOS"
    assert p["device"] == "mobile"

    p = parse_user_agent(FIREFOX_WIN)
    assert p["browser"] == "Firefox" and p["os"] == "Windows"
    assert p["device"] == "desktop"

    p = parse_user_agent("Mozilla/5.0 (compatible; Googlebot/2.1)")
    assert p["device"] == "bot"

    p = parse_user_agent(None)
    assert p["device"] == "unknown" and p["summary"] is None
    p = parse_user_agent("curl/8.4.0")
    assert p["device"] == "bot"


# ---------------------------------------------------------------------------
# لیست داشبورد
# ---------------------------------------------------------------------------


async def _seed_three(tc):
    """سه کاربر با دامنهٔ ایمیل یکتا: A در انتظار، B کامل، C کشور از شماره."""
    tag = _uid()
    digits = str(uuid.uuid4().int % 10**9).zfill(9)
    a = await _make_user(
        tc, (), email=f"dash-{tag}-a@example.com", is_verified=False,
        phone=f"+989{digits}", created_at=_t(1),
    )
    await _seed_activity(
        tc, a["user_id"], marker=True,
        register=("1.2.3.4", CHROME_ANDROID, _t(1)),
    )
    avatar_id = await _make_avatar(tc)
    from datetime import date

    b = await _make_user(
        tc, (), email=f"dash-{tag}-b@example.com", created_at=_t(2),
        country_code="TR", gender="male", date_of_birth=date(2000, 1, 15),
        avatar_media_id=uuid.UUID(avatar_id),
    )
    await _seed_activity(
        tc, b["user_id"],
        register=("9.9.9.9", FIREFOX_WIN, _t(2)),
        sessions=(("5.6.7.8", SAFARI_IPHONE, _t(3), _t(5)),),
        fatwa=1, attempts=1, tests=1, donations=((5000, "succeeded"),),
    )
    c = await _make_user(
        tc, (), email=f"dash-{tag}-c@example.com", created_at=_t(3),
        phone=f"+4420{digits[:8]}", is_verified=True,
    )
    await _seed_activity(
        tc, c["user_id"],
        sessions=(("8.8.8.8", FIREFOX_WIN, _t(3), _t(4)),),
    )
    return tag, a, b, c


async def test_dashboard_list_rows_and_filters(tc):
    admin = await _make_user(tc, PERMS)
    tag, a, b, c = await _seed_three(tc)
    q = f"dash-{tag}"

    r = await tc["client"].get(
        f"{BASE}/admin/users/dashboard", params={"q": q}, headers=admin
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 3
    rows = {row["email"].split("-")[-1]: row for row in data["items"]}
    ra, rb, rc = rows["a@example.com"], rows["b@example.com"], rows["c@example.com"]

    # A: در انتظار + IP/دستگاه ثبت‌نام از audit
    assert ra["registration_status"] == "pending"
    assert ra["profile_complete"] is False
    assert "date_of_birth" in ra["missing_profile_fields"]
    assert ra["registration"]["ip"] == "1.2.3.4"
    assert ra["registration"]["browser"] == "Chrome"
    assert ra["registration"]["device"] == "mobile"
    assert ra["last_activity"] is None

    # B: کامل + کشور پروفایل + آخرین فعالیت + شمارش‌ها
    assert rb["registration_status"] == "completed"
    assert rb["profile_complete"] is True
    assert rb["country_code"] == "TR" and rb["country_source"] == "profile"
    assert rb["last_activity"]["ip"] == "5.6.7.8"
    assert rb["last_activity"]["browser"] == "Safari"
    assert rb["counts"] == {
        "fatwa_questions": 1, "hifz_sessions": 1,
        "hifz_tests": 1, "donations": 1,
    }

    # C: کشور استخراج‌شده از شمارهٔ تأییدشده
    assert rc["country_code"] == "GB" and rc["country_source"] == "phone"

    async def _emails(**params):
        rr = await tc["client"].get(
            f"{BASE}/admin/users/dashboard",
            params={"q": q, **params}, headers=admin,
        )
        assert rr.status_code == 200, rr.text
        return sorted(i["email"] for i in rr.json()["items"])

    assert await _emails(status="pending") == [f"dash-{tag}-a@example.com"]
    assert await _emails(status="completed") == [
        f"dash-{tag}-b@example.com", f"dash-{tag}-c@example.com",
    ]
    assert await _emails(country="TR") == [f"dash-{tag}-b@example.com"]
    assert await _emails(country="GB") == [f"dash-{tag}-c@example.com"]
    assert await _emails(profile="complete") == [f"dash-{tag}-b@example.com"]
    assert await _emails(profile="incomplete") == [
        f"dash-{tag}-a@example.com", f"dash-{tag}-c@example.com",
    ]

    # مرتب‌سازی بر اساس آخرین فعالیت: B (روز ۵) ← C (روز ۴) ← A (بدون نشست)
    r = await tc["client"].get(
        f"{BASE}/admin/users/dashboard",
        params={"q": q, "sort": "last_activity", "order": "desc"},
        headers=admin,
    )
    order_ids = [i["id"] for i in r.json()["items"]]
    assert order_ids == [b["user_id"], c["user_id"], a["user_id"]]

    # صفحه‌بندی
    r = await tc["client"].get(
        f"{BASE}/admin/users/dashboard",
        params={"q": q, "limit": 2, "offset": 2}, headers=admin,
    )
    assert r.json()["total"] == 3 and len(r.json()["items"]) == 1


async def test_dashboard_stats_delta(tc):
    admin = await _make_user(tc, PERMS)

    async def _stats():
        r = await tc["client"].get(f"{BASE}/admin/users/stats", headers=admin)
        assert r.status_code == 200, r.text
        return r.json()

    before = await _stats()
    await _seed_three(tc)
    after = await _stats()
    assert after["total_users"] - before["total_users"] == 3
    assert after["pending"] - before["pending"] == 1
    assert after["completed"] - before["completed"] == 2
    assert after["profile_complete"] - before["profile_complete"] == 1


async def test_dashboard_rbac_and_bad_filters(tc):
    outsider = await _make_user(tc, ())
    r = await tc["client"].get(f"{BASE}/admin/users/dashboard", headers=outsider)
    assert r.status_code == 403
    r = await tc["client"].get(f"{BASE}/admin/users/stats", headers=outsider)
    assert r.status_code == 403

    admin = await _make_user(tc, PERMS)
    r = await tc["client"].get(
        f"{BASE}/admin/users/dashboard", params={"status": "bogus"}, headers=admin
    )
    assert r.status_code == 422
    r = await tc["client"].get(
        f"{BASE}/admin/users/dashboard", params={"sort": "bogus"}, headers=admin
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# نمای ۳۶۰° — بخش‌های فاز C
# ---------------------------------------------------------------------------


async def test_overview_phase_c_sections(tc):
    admin = await _make_user(tc, PERMS)
    avatar_id = await _make_avatar(tc)
    from datetime import date

    user = await _make_user(
        tc, (), country_code="IR", gender="female",
        date_of_birth=date(1999, 5, 1),
        avatar_media_id=uuid.UUID(avatar_id),
    )
    await _seed_activity(
        tc, user["user_id"],
        register=("1.2.3.4", CHROME_ANDROID, _t(1)),
        sessions=(("5.6.7.8", SAFARI_IPHONE, _t(3), _t(5)),),
        attempts=2, tests=1,
        donations=((7000, "succeeded"), (3000, "refunded")),
    )

    r = await tc["client"].get(
        f"{BASE}/admin/users/{user['user_id']}/overview", headers=admin
    )
    assert r.status_code == 200, r.text
    data = r.json()

    profile = data["profile"]
    assert profile["registration_status"] == "completed"
    assert profile["profile_complete"] is True
    assert profile["country_code"] == "IR"
    assert profile["date_of_birth"] == "1999-05-01"
    assert profile["gender"] == "female"
    assert profile["avatar_media_id"] == avatar_id

    reg = data["registration"]
    assert reg["ip"] == "1.2.3.4" and reg["browser"] == "Chrome"

    assert len(data["sessions"]) == 1
    sess = data["sessions"][0]
    assert sess["ip"] == "5.6.7.8" and sess["browser"] == "Safari"
    assert sess["state"] == "active" and sess["user_agent"] == SAFARI_IPHONE

    assert data["donations"]["count"] == 2
    assert data["donations"]["total_succeeded_irr"] == 7000
    assert data["hifz"]["attempts"] == 2 and data["hifz"]["tests"] == 1
    assert len(data["hifz"]["recent_attempts"]) == 2

    # audit trail حالا ip را هم دارد
    assert all("ip" in entry for entry in data["audit_trail"])


MANAGE_PERMS = ("users.view360", "users.manage")


async def test_admin_suspend_and_activate(tc):
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)
    email = f"susp-{_uid()}@example.com"
    target = await _make_user(tc, (), email=email)
    tid = target["user_id"]

    # ورود سالم است
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text

    # تعلیق
    r = await client.post(f"{BASE}/admin/users/{tid}/suspend", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False

    # توکن قبلی بی‌اعتبار و ورود تازه بسته است
    r = await client.get(f"{BASE}/users/me", headers=target)
    assert r.status_code in (401, 403)
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code in (401, 403)

    # داشبورد وضعیت معلق را نشان می‌دهد
    r = await client.get(
        f"{BASE}/admin/users/dashboard", params={"q": email}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["is_active"] is False

    # فعال‌سازی دوباره → ورود ممکن می‌شود
    r = await client.post(f"{BASE}/admin/users/{tid}/activate", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text


async def test_admin_manage_requires_permission_and_not_self(tc):
    client = tc["client"]
    viewer = await _make_user(tc, PERMS)  # فقط view360 — بدون manage
    target = await _make_user(tc, ())
    r = await client.post(
        f"{BASE}/admin/users/{target['user_id']}/suspend", headers=viewer
    )
    assert r.status_code == 403, r.text

    admin = await _make_user(tc, MANAGE_PERMS)
    r = await client.post(
        f"{BASE}/admin/users/{admin['user_id']}/suspend", headers=admin
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "self_action"


async def test_admin_delete_user(tc):
    """حذف = انتقال به سطل زباله (نرم) — با یا بی سابقه.

    پوشش کامل چرخهٔ سطل (فهرست سطل، بازیابی، حذف دائمی، ناشناس‌شدن
    حمایت) در test_admin_user_trash_activity.py است؛ این‌جا قرارداد
    پایهٔ همان دکمهٔ حذف قدیمی نگه داشته می‌شود.
    """
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)

    # کاربر بی‌فعالیت: به سطل می‌رود، نمای ۳۶۰° با پرچم سطل برمی‌گردد
    target = await _make_user(tc, ())
    tid = target["user_id"]
    r = await client.delete(f"{BASE}/admin/users/{tid}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["trashed"] is True
    r = await client.get(f"{BASE}/admin/users/{tid}/overview", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["profile"]["is_trashed"] is True

    # کاربر با حمایت مالی هم بدون 409 به سطل می‌رود و سابقه‌اش می‌ماند
    busy = await _make_user(tc, ())
    await _seed_activity(tc, busy["user_id"], donations=((5000, "succeeded"),))
    r = await client.delete(f"{BASE}/admin/users/{busy['user_id']}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["trashed"] is True
    r = await client.get(
        f"{BASE}/admin/users/{busy['user_id']}/overview", headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["donations"]["count"] == 1
