"""تست‌های سطل زبالهٔ کاربران + خط زمانی فعالیت + آواتار در نمای ۳۶۰°.

قرارداد (دستور حسین ۲۰۲۶-۱۱-۱۹):
- حذف کاربر همیشه نرم است: ردیف و همهٔ سابقه‌اش می‌ماند و کاربر به
  سطل زبالهٔ بخش کاربران می‌رود؛ از فهرست اصلی و آمار کنار می‌رود و
  ورودش بسته می‌شود.
- بازیابی از سطل، کاربر را با همان سابقه برمی‌گرداند.
- حذف دائمی فقط از داخل سطل: کاربر و دادهٔ وابسته‌اش پاک می‌شود؛
  ردیف‌های مالی (حمایت) ناشناس می‌شوند تا جمع کمپین‌ها نریزد.
- رویدادهای رفتاری (پخش رسانه و…) با POST /activity/events ثبت و در
  خط زمانی و نقشهٔ فعالیت نمای ۳۶۰° دیده می‌شوند.
- آواتار کاربر با URL امضاشده در نمای ۳۶۰° برمی‌گردد و همان URL
  فایل را سرو می‌کند.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

BASE = "/api/v1"
MANAGE_PERMS = ("users.view360", "users.manage")


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = (), **overrides):
    """کاربر تست + هدر احراز — الگوی test_admin_users_dashboard."""
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
        role = Role(name=f"trash_test_role_{suffix}", description="trash test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        fields = {
            "full_name": "کاربر سطل",
            "email": f"trash-{suffix}@example.com",
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
        return {
            "Authorization": f"Bearer {token}",
            "user_id": str(user.id),
            "email": fields["email"],
        }


async def _seed_donation(tc, user_id: str, amount: int = 5000) -> str:
    from app.models.models import Donation, PaymentIntent

    uid = uuid.UUID(user_id)
    async with tc["maker"]() as db:
        intent = PaymentIntent(
            idempotency_key=f"trash-{_uid()}", amount=amount,
            currency="IRR", donor_id=uid, status="succeeded",
            gateway="card",
        )
        db.add(intent)
        await db.flush()
        donation = Donation(
            donor_id=uid, payment_intent_id=intent.id, gateway="card",
            gateway_reference=f"ref-{_uid()}", status="succeeded",
            amount=amount, currency="IRR",
        )
        db.add(donation)
        await db.commit()
        return str(donation.id)


async def test_trash_cycle_and_restore(tc):
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)
    target = await _make_user(tc, ())
    tid = target["user_id"]
    await _seed_donation(tc, tid)

    # حذف نرم → سطل
    r = await client.delete(f"{BASE}/admin/users/{tid}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["trashed"] is True

    # از فهرست اصلی رفته
    r = await client.get(
        f"{BASE}/admin/users/dashboard",
        params={"q": target["email"]}, headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0

    # در فهرست سطل هست، با زمان حذف
    r = await client.get(
        f"{BASE}/admin/users/trash", params={"q": target["email"]}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 1
    row = r.json()["items"][0]
    assert row["deleted_at"] is not None
    assert row["counts"]["donations"] == 1  # سابقه سر جایش است

    # آمار: شمارش سطل ≥ ۱ (تفاضلی — دیتابیس بین فایل‌ها مشترک نیست
    # ولی داخل همین فایل تست‌های دیگر هم کاربر می‌سازند)
    r = await client.get(f"{BASE}/admin/users/stats", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["trashed"] >= 1

    # ورود کاربر سطلی بسته است
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": target["email"], "password": "TestPass123"},
    )
    assert r.status_code in (401, 403), r.text

    # حذف دوباره = همان وضعیت (idempotent)
    r = await client.delete(f"{BASE}/admin/users/{tid}", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["trashed"] is True

    # بازیابی → برگشت کامل با سابقه
    r = await client.post(f"{BASE}/admin/users/{tid}/restore", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["restored"] is True
    r = await client.get(
        f"{BASE}/admin/users/dashboard",
        params={"q": target["email"]}, headers=admin,
    )
    assert r.json()["total"] == 1
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": target["email"], "password": "TestPass123"},
    )
    assert r.status_code == 200, r.text


async def test_permanent_delete_only_from_trash(tc):
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)
    target = await _make_user(tc, ())
    tid = target["user_id"]
    donation_id = await _seed_donation(tc, tid)

    from app.models.models import Donation, HifzAttempt

    async with tc["maker"]() as db:
        db.add(HifzAttempt(user_id=uuid.UUID(tid), surah=2, status="completed"))
        await db.commit()

    # کاربر فعال را نمی‌شود دائمی حذف کرد
    r = await client.delete(f"{BASE}/admin/users/{tid}/permanent", headers=admin)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "not_trashed"

    # به سطل، بعد حذف دائمی
    r = await client.delete(f"{BASE}/admin/users/{tid}", headers=admin)
    assert r.status_code == 200, r.text
    r = await client.delete(f"{BASE}/admin/users/{tid}/permanent", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] is True
    assert r.json()["permanent"] is True

    # کاربر و تلاش حفظش رفته‌اند؛ حمایت ناشناس مانده است
    r = await client.get(f"{BASE}/admin/users/{tid}/overview", headers=admin)
    assert r.status_code == 404, r.text
    async with tc["maker"]() as db:
        attempts = (
            await db.execute(
                select(HifzAttempt).where(HifzAttempt.user_id == uuid.UUID(tid))
            )
        ).scalars().all()
        assert attempts == []
        donation = await db.get(Donation, uuid.UUID(donation_id))
        assert donation is not None
        assert donation.donor_id is None


async def test_activity_events_flow_into_timeline(tc):
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)
    target = await _make_user(tc, ())
    tid = target["user_id"]

    # بدون توکن: 401
    r = await client.post(
        f"{BASE}/activity/events", json={"kind": "media_play", "title": "x"}
    )
    assert r.status_code == 401, r.text

    # kind ناشناخته: 422
    r = await client.post(
        f"{BASE}/activity/events",
        json={"kind": "teleport", "title": "x"}, headers=target,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "bad_event_kind"

    # ثبت پخش صوت با متای تمیز + یک کلید آلوده که باید بیفتد
    r = await client.post(
        f"{BASE}/activity/events",
        json={
            "kind": "media_play",
            "title": "تفسیر جزء ۳۰",
            "ref_type": "library_item",
            "ref_id": "item-1",
            "meta": {
                "media_kind": "audio", "seconds": 1500,
                "nested": {"no": "drop"}, "long": "x" * 500,
            },
        },
        headers=target,
    )
    assert r.status_code == 201, r.text

    from app.models.models import UserActivityEvent

    async with tc["maker"]() as db:
        rows = (
            await db.execute(
                select(UserActivityEvent)
                .where(UserActivityEvent.user_id == uuid.UUID(tid))
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].meta == {"media_kind": "audio", "seconds": 1500,
                                "long": "x" * 120}

    # خط زمانی ۳۶۰° رویداد را دارد و نقشهٔ فعالیت ۸۴ روزه است
    r = await client.get(f"{BASE}/admin/users/{tid}/overview", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    kinds = [e["kind"] for e in body["activity_timeline"]]
    assert "media_play" in kinds
    assert "account_created" in kinds
    play = next(e for e in body["activity_timeline"] if e["kind"] == "media_play")
    assert play["module"] == "media"
    assert play["data"]["title"] == "تفسیر جزء ۳۰"
    heatmap = body["activity_heatmap"]
    assert len(heatmap) == 84
    today = datetime.now(UTC).date().isoformat()
    assert heatmap[-1]["date"] == today
    assert heatmap[-1]["count"] >= 1
    assert body["profile"]["is_trashed"] is False
    assert body["profile"]["avatar_url"] is None


async def test_overview_avatar_url_serves_file(tc):
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)
    target = await _make_user(tc, ())
    tid = target["user_id"]

    from app.core.storage import get_storage
    from app.models.models import MediaAsset, User

    key = f"avatars/{tid}/test-avatar.png"
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    storage = get_storage()
    await storage.put_object(key, png, "image/png")
    async with tc["maker"]() as db:
        asset = MediaAsset(
            owner_id=uuid.UUID(tid), kind="image", storage_key=key,
            mime_type="image/png", size_bytes=len(png), visibility="public",
        )
        db.add(asset)
        await db.flush()
        user = await db.get(User, uuid.UUID(tid))
        user.avatar_media_id = asset.id
        await db.commit()

    r = await client.get(f"{BASE}/admin/users/{tid}/overview", headers=admin)
    assert r.status_code == 200, r.text
    avatar_url = r.json()["profile"]["avatar_url"]
    assert avatar_url and "avatar-by-ref" in avatar_url

    # همان URL فایل را سرو می‌کند (امضا جای احراز را می‌گیرد)
    from urllib.parse import urlsplit

    parts = urlsplit(avatar_url)
    path = parts.path + ("?" + parts.query if parts.query else "")
    r = await client.get(path)
    assert r.status_code == 200, r.text
    assert r.content == png

    # امضای دست‌کاری‌شده رد می‌شود
    r = await client.get(path[:-4] + "0000")
    assert r.status_code == 403, r.text


async def test_trash_requires_manage_permission(tc):
    client = tc["client"]
    viewer = await _make_user(tc, ("users.view360",))
    target = await _make_user(tc, ())
    tid = target["user_id"]

    r = await client.delete(f"{BASE}/admin/users/{tid}", headers=viewer)
    assert r.status_code == 403, r.text
    r = await client.post(f"{BASE}/admin/users/{tid}/restore", headers=viewer)
    assert r.status_code == 403, r.text
    r = await client.delete(f"{BASE}/admin/users/{tid}/permanent", headers=viewer)
    assert r.status_code == 403, r.text
    # ولی فهرست سطل با همان view360 خواندنی است
    r = await client.get(f"{BASE}/admin/users/trash", headers=viewer)
    assert r.status_code == 200, r.text


async def test_trashed_user_deleted_at_in_overview(tc):
    client = tc["client"]
    admin = await _make_user(tc, MANAGE_PERMS)
    target = await _make_user(tc, ())
    tid = target["user_id"]
    before = datetime.now(UTC) - timedelta(minutes=1)
    r = await client.delete(f"{BASE}/admin/users/{tid}", headers=admin)
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/admin/users/{tid}/overview", headers=admin)
    assert r.status_code == 200, r.text
    profile = r.json()["profile"]
    assert profile["is_trashed"] is True
    assert profile["deleted_at"] is not None
    deleted_at = datetime.fromisoformat(profile["deleted_at"])
    assert deleted_at >= before
    assert profile["deleted_by"] == admin["user_id"]
