"""تست‌های فاز ۱۳ (Track 1 — بک‌اند): موتور همگام‌سازی آفلاین.

پوشش (ADR-0010):
- تعارض یادداشت دو دستگاه آفلاین → هر دو نسخه در conflict_records، بدون دورریز
- حذف آفلاین → pull دستگاه دوم شامل tombstone است
- pull با کرسر فقط تغییرات جدیدتر را می‌دهد
- بازپخش همان batch (همان client_op_idها) idempotent است
- پیشرفت اسکالر با max-wins ادغام می‌شود (هرگز تعارض ندارد)
- شمارش روزانهٔ ذکر با max-wins
- offline-pack: شروع‌شده > دنبال‌شده > محبوب
- کرسر دستگاه، رویدادهای دامنهٔ تعارض، کانال web_push، کلیدهای push
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست سینک",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, identifier: str, password: str = "TestPass123") -> str:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": identifier, "password": password}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _user_token(client, email: str) -> str:
    await _register(client, email)
    return await _login(client, email)


async def _create_note(client, token: str, text: str = "یادداشت اول") -> dict:
    r = await client.post(
        f"{BASE}/quran/notes",
        json={"surah": 1, "ayah": 1, "note_text": text, "is_private": True},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()


def _op(client_op_id: str, entity_type: str, entity_id: str, op_type: str,
        payload: dict | None = None, base_version: int = 0) -> dict:
    return {
        "client_op_id": client_op_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "op_type": op_type,
        "payload": payload or {},
        "base_version": base_version,
    }


async def _push(client, token: str, device_id: str, ops: list[dict]) -> list[dict]:
    r = await client.post(
        f"{BASE}/sync/push",
        json={"device_id": device_id, "ops": ops},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()["results"]


async def _make_lesson(tc):
    from app.models.models import Course, Lesson

    maker = tc["maker"]
    async with maker() as db:
        course = Course(title={"fa": "دوره تست سینک"})
        db.add(course)
        await db.flush()
        lesson = Lesson(course_id=course.id, title={"fa": "درس تست سینک"})
        db.add(lesson)
        await db.commit()
        return str(lesson.id)


# ---------------------------------------------------------------------------
# ۱) تعارض یادداشت: هر دو نسخه حفظ می‌شود، هیچ‌چیز بی‌صدا دور ریخته نمی‌شود
# ---------------------------------------------------------------------------


async def test_note_conflict_preserves_both_versions(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-conflict@example.com")
    note = await _create_note(client, token)
    note_id = note["id"]

    # دستگاه A آفلاین ویرایش می‌کند و اول push می‌کند
    res_a = await _push(client, token, "dev-a", [
        _op("conf-a1", "user_ayah_note", note_id, "upsert",
            {"note_text": "ویرایش دستگاه A", "is_private": True}, base_version=1),
    ])
    assert res_a[0]["status"] == "applied"
    assert res_a[0]["version"] == 2

    # دستگاه B هم آفلاین (از همان نسخهٔ ۱) ویرایش کرده و دیرتر push می‌کند
    res_b = await _push(client, token, "dev-b", [
        _op("conf-b1", "user_ayah_note", note_id, "upsert",
            {"note_text": "ویرایش دستگاه B", "is_private": False}, base_version=1),
    ])
    assert res_b[0]["status"] == "conflicted"
    assert res_b[0]["conflict_id"] is not None
    assert res_b[0]["version"] == 2  # نسخهٔ برندهٔ سرور

    # نسخهٔ سرور (A) دست‌نخورده مانده
    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token))
    assert r.status_code == 200
    texts = [n["note_text"] for n in r.json()["items"]]
    assert "ویرایش دستگاه A" in texts
    assert "ویرایش دستگاه B" not in texts

    # هر دو نسخه در conflict_records
    r = await client.get(f"{BASE}/sync/conflicts", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    c = body["items"][0]
    assert c["resolution"] == "pending"
    assert c["local_payload"]["note_text"] == "ویرایش دستگاه B"
    assert c["remote_payload"]["note_text"] == "ویرایش دستگاه A"
    conflict_id = c["id"]

    # رویداد دامنهٔ تعارض صادر شده
    from app.models.models import ConflictRecord, DomainEvent

    maker = tc["maker"]
    async with maker() as db:
        ev = (
            await db.execute(
                select(DomainEvent).where(
                    DomainEvent.event_type == "sync.conflict_detected",
                    DomainEvent.aggregate_id == conflict_id,
                )
            )
        ).scalar_one_or_none()
        assert ev is not None
        rec = await db.get(ConflictRecord, uuid.UUID(conflict_id))
        assert rec is not None
        assert rec.local_payload["note_text"] == "ویرایش دستگاه B"
        assert rec.remote_payload["note_text"] == "ویرایش دستگاه A"

    # حل تعارض با keep_local → نسخهٔ B اعمال می‌شود
    r = await client.post(
        f"{BASE}/sync/conflicts/{conflict_id}/resolve",
        json={"resolution": "keep_local", "note": "نظر کاربر"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied_version"] == 3

    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token))
    texts = [n["note_text"] for n in r.json()["items"]]
    assert "ویرایش دستگاه B" in texts

    # حل دوباره → ۴۰۹
    r = await client.post(
        f"{BASE}/sync/conflicts/{conflict_id}/resolve",
        json={"resolution": "keep_remote"},
        headers=_auth(token),
    )
    assert r.status_code == 409


async def test_note_conflict_merged_resolution(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-merge@example.com")
    note = await _create_note(client, token)
    note_id = note["id"]

    await _push(client, token, "dev-a", [
        _op("merge-a1", "user_ayah_note", note_id, "upsert",
            {"note_text": "متن A", "is_private": True}, base_version=1),
    ])
    res = await _push(client, token, "dev-b", [
        _op("merge-b1", "user_ayah_note", note_id, "upsert",
            {"note_text": "متن B", "is_private": True}, base_version=1),
    ])
    conflict_id = res[0]["conflict_id"]

    r = await client.post(
        f"{BASE}/sync/conflicts/{conflict_id}/resolve",
        json={"resolution": "merged",
              "merged_payload": {"note_text": "متن ادغام‌شده A+B",
                                 "is_private": True}},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token))
    texts = [n["note_text"] for n in r.json()["items"]]
    assert "متن ادغام‌شده A+B" in texts


# ---------------------------------------------------------------------------
# ۲) حذف آفلاین → tombstone در pull دستگاه دوم
# ---------------------------------------------------------------------------


async def test_offline_delete_propagates_tombstone_via_pull(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-tomb@example.com")
    note = await _create_note(client, token)
    note_id = note["id"]

    res = await _push(client, token, "dev-a", [
        _op("tomb-del1", "user_ayah_note", note_id, "delete", base_version=1),
    ])
    assert res[0]["status"] == "applied"

    # دستگاه دوم با pull حذف را می‌بیند
    r = await client.get(
        f"{BASE}/sync/pull", params={"cursor": 0, "device_id": "dev-b"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    deletes = [c for c in body["changes"]
               if c["entity_id"] == note_id and c["op_type"] == "delete"]
    assert len(deletes) == 1
    assert body["new_cursor"] >= deletes[0]["seq"]

    # tombstone در دیتابیس
    from app.models.models import SyncTombstone

    maker = tc["maker"]
    async with maker() as db:
        ts = (
            await db.execute(
                select(SyncTombstone).where(
                    SyncTombstone.entity_type == "user_ayah_note",
                    SyncTombstone.entity_id == note_id,
                )
            )
        ).scalar_one_or_none()
        assert ts is not None

    # یادداشت واقعاً رفته
    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token))
    assert all(n["id"] != note_id for n in r.json()["items"])


# ---------------------------------------------------------------------------
# ۳) pull با کرسر فقط تغییرات جدیدتر را می‌دهد
# ---------------------------------------------------------------------------


async def test_pull_cursor_returns_only_newer_changes(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-cursor@example.com")

    n1 = await _create_note(client, token, "یادداشت کرسر ۱")
    n2 = await _create_note(client, token, "یادداشت کرسر ۲")

    r = await client.get(
        f"{BASE}/sync/pull", params={"cursor": 0, "device_id": "dev-c"},
        headers=_auth(token),
    )
    assert r.status_code == 200
    first = r.json()
    seqs = [c["seq"] for c in first["changes"] if c["entity_id"] in (n1["id"], n2["id"])]
    assert len(seqs) == 2
    cursor = first["new_cursor"]
    assert cursor >= max(seqs)

    # کرسر ذخیره‌شدهٔ دستگاه هم جلو رفته
    r = await client.get(
        f"{BASE}/sync/cursor", params={"device_id": "dev-c"},
        headers=_auth(token),
    )
    assert r.json()["cursor_seq"] == cursor

    n3 = await _create_note(client, token, "یادداشت کرسر ۳")
    r = await client.get(
        f"{BASE}/sync/pull", params={"cursor": cursor, "device_id": "dev-c"},
        headers=_auth(token),
    )
    second = r.json()
    assert all(c["seq"] > cursor for c in second["changes"])
    assert [c["entity_id"] for c in second["changes"]] == [n3["id"]]
    assert second["new_cursor"] > cursor


# ---------------------------------------------------------------------------
# ۴) بازپخش batch یکسان idempotent است
# ---------------------------------------------------------------------------


async def test_push_replay_is_idempotent(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-replay@example.com")
    note = await _create_note(client, token)
    note_id = note["id"]

    batch = {"device_id": "dev-r", "ops": [
        _op("replay-1", "user_ayah_note", note_id, "upsert",
            {"note_text": "متن بازپخش", "is_private": True}, base_version=1),
    ]}
    r1 = await client.post(f"{BASE}/sync/push", json=batch, headers=_auth(token))
    assert r1.status_code == 200
    r2 = await client.post(f"{BASE}/sync/push", json=batch, headers=_auth(token))
    assert r2.status_code == 200
    # دقیقاً همان پاسخ، بدون اعمال دوباره
    assert r2.json() == r1.json()
    assert r2.json()["results"][0]["status"] == "applied"
    assert r2.json()["results"][0]["version"] == 2

    from app.models.models import SyncChangeLog, SyncOperation, UserAyahNote

    maker = tc["maker"]
    async with maker() as db:
        ops = list(
            (await db.execute(
                select(SyncOperation).where(
                    SyncOperation.client_op_id == "replay-1")
            )).scalars().all()
        )
        assert len(ops) == 1
        changes = list(
            (await db.execute(
                select(SyncChangeLog).where(
                    SyncChangeLog.entity_type == "user_ayah_note",
                    SyncChangeLog.entity_id == note_id,
                    SyncChangeLog.device_id == "dev-r",
                )
            )).scalars().all()
        )
        assert len(changes) == 1  # فقط یک بار در ژورنال
        row = await db.get(UserAyahNote, uuid.UUID(note_id))
        assert row.version == 2  # دو بار اعمال نشده


# ---------------------------------------------------------------------------
# ۵) پیشرفت اسکالر: max-wins، هرگز تعارض
# ---------------------------------------------------------------------------


async def test_progress_max_wins(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-progress@example.com")
    lesson_id = await _make_lesson(tc)

    res = await _push(client, token, "dev-a", [
        _op("prog-1", "user_progress", lesson_id, "upsert",
            {"status": "in_progress", "position_seconds": 120}),
    ])
    assert res[0]["status"] == "applied"

    # دستگاه دوم: position کمتر ولی status جلوتر → هر دو max می‌شوند
    res = await _push(client, token, "dev-b", [
        _op("prog-2", "user_progress", lesson_id, "upsert",
            {"status": "completed", "position_seconds": 60}),
    ])
    assert res[0]["status"] == "applied"

    # دستگاه سوم: مقادیر عقب‌تر → هیچ‌چیز پسرفت نمی‌کند
    res = await _push(client, token, "dev-c", [
        _op("prog-3", "user_progress", lesson_id, "upsert",
            {"status": "not_started", "position_seconds": 30}),
    ])
    assert res[0]["status"] == "applied"

    from app.models.models import UserProgress

    maker = tc["maker"]
    async with maker() as db:
        prog = (
            await db.execute(
                select(UserProgress).where(
                    UserProgress.lesson_id == uuid.UUID(lesson_id))
            )
        ).scalar_one()
        assert prog.position_seconds == 120
        assert prog.status == "completed"
        assert prog.completed_at is not None

    # هیچ تعارضی برای اسکالر ساخته نشده
    r = await client.get(f"{BASE}/sync/conflicts", headers=_auth(token))
    assert r.json()["total"] == 0


async def test_dhikr_daily_count_max_wins(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-dhikr@example.com")
    entity_id = "2026-10-19:سبحان‌الله"

    res = await _push(client, token, "dev-a", [
        _op("dhk-1", "dhikr_daily_count", entity_id, "upsert",
            {"date": "2026-10-19", "dhikr_text": "سبحان‌الله",
             "total_count": 100}),
    ])
    assert res[0]["status"] == "applied"

    res = await _push(client, token, "dev-b", [
        _op("dhk-2", "dhikr_daily_count", entity_id, "upsert",
            {"date": "2026-10-19", "dhikr_text": "سبحان‌الله",
             "total_count": 40}),
    ])
    assert res[0]["status"] == "applied"

    from datetime import date as _date

    from app.models.models import DhikrDailyCount, User

    maker = tc["maker"]
    async with maker() as db:
        user = (await db.execute(
            select(User).where(User.email == "sync-dhikr@example.com")
        )).scalar_one()
        row = (
            await db.execute(
                select(DhikrDailyCount).where(
                    DhikrDailyCount.user_id == user.id,
                    DhikrDailyCount.date == _date(2026, 10, 19),
                    DhikrDailyCount.dhikr_text == "سبحان‌الله",
                )
            )
        ).scalar_one()
        assert row.total_count == 100


# ---------------------------------------------------------------------------
# ۶) offline-pack: شروع‌شده > دنبال‌شده > محبوب
# ---------------------------------------------------------------------------


async def test_offline_pack_prioritizes_started(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-pack@example.com")
    lesson_id = await _make_lesson(tc)

    await _push(client, token, "dev-a", [
        _op("pack-1", "user_progress", lesson_id, "upsert",
            {"status": "in_progress", "position_seconds": 10}),
    ])

    r = await client.get(f"{BASE}/sync/offline-pack", headers=_auth(token))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    started = [i for i in items if i["reason"] == "started"]
    assert any(i["ref_id"] == lesson_id and i["kind"] == "lesson" for i in started)
    scores_started = [i["score"] for i in started]
    scores_other = [i["score"] for i in items if i["reason"] != "started"]
    if scores_other:
        assert min(scores_started) > max(scores_other)
    # مرتب‌سازی نزولی بر اساس امتیاز
    scores = [i["score"] for i in items]
    assert scores == sorted(scores, reverse=True)


# ---------------------------------------------------------------------------
# ۷) تنظیمات پوش staged و خالی + کانال web_push
# ---------------------------------------------------------------------------


async def test_push_settings_keys_staged_empty(tc):
    from app.core.platform_settings import SETTING_DEFS, get_typed_setting

    assert SETTING_DEFS["push.fcm_server_key"]["type"] == "secret"
    assert SETTING_DEFS["push.vapid_private_key"]["type"] == "secret"
    assert SETTING_DEFS["push.vapid_public_key"]["type"] == "string"

    maker = tc["maker"]
    async with maker() as db:
        # هیچ مقداری seed نشده — خالی و staged
        assert await get_typed_setting(db, "push.fcm_server_key") is None
        assert await get_typed_setting(db, "push.vapid_public_key") is None
        assert await get_typed_setting(db, "push.vapid_private_key") is None


async def test_web_push_channel_distinct_from_push(tc):
    """web_push در seed پیش‌فرض ثبت‌نام، کانالی مجزا از push (FCM) است."""
    from app.models.models import NotificationPreference, User

    client = tc["client"]
    token = await _user_token(client, "sync-webpush@example.com")

    maker = tc["maker"]
    async with maker() as db:
        user = (await db.execute(
            select(User).where(User.email == "sync-webpush@example.com")
        )).scalar_one()
        rows = list(
            (await db.execute(
                select(NotificationPreference).where(
                    NotificationPreference.user_id == user.id,
                    NotificationPreference.notif_type == "product",
                )
            )).scalars().all()
        )
        channels = {r.channel: r.enabled for r in rows}
        # هر دو کانال به‌صورت ردیف‌های مجزا seed شده‌اند
        assert set(channels) >= {"push", "web_push"}
        assert channels["push"] is True
        assert channels["web_push"] is True
        # بازاریابی برای کانال‌های پوش پیش‌فرض خاموش است
        marketing = {
            r.channel: r.enabled
            for r in (await db.execute(
                select(NotificationPreference).where(
                    NotificationPreference.user_id == user.id,
                    NotificationPreference.notif_type == "marketing",
                )
            )).scalars().all()
        }
        assert marketing["web_push"] is False
        assert marketing["push"] is False


# ---------------------------------------------------------------------------
# تست‌های تکمیلی هماهنگ‌کننده (فاز ۱۳): devices + web-push endpoints
# ---------------------------------------------------------------------------


async def test_register_device_upsert_and_token_rotation(tc):
    """ثبت دستگاه + چرخش توکن FCM: upsert، آخرین مقدار برنده است."""
    client = tc["client"]
    token = await _user_token(client, "sync-device@example.com")

    r = await client.post(
        f"{BASE}/users/me/devices", headers=_auth(token),
        json={"device_id": "pixel-8", "platform": "android", "push_token": "fcm-aaa"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["registered"] is True

    r = await client.post(
        f"{BASE}/users/me/devices", headers=_auth(token),
        json={"device_id": "pixel-8", "platform": "android", "push_token": "fcm-bbb"},
    )
    assert r.status_code == 200, r.text

    from app.models.models import User, UserDevice
    maker = tc["maker"]
    async with maker() as db:
        user = (await db.execute(
            select(User).where(User.email == "sync-device@example.com")
        )).scalar_one()
        rows = list((await db.execute(
            select(UserDevice).where(UserDevice.user_id == user.id)
        )).scalars().all())
        assert len(rows) == 1  # upsert — نه دو ردیف
        assert rows[0].push_token == "fcm-bbb"  # آخرین توکن برنده است


async def test_register_device_rejects_bad_platform(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-device-bad@example.com")
    r = await client.post(
        f"{BASE}/users/me/devices", headers=_auth(token),
        json={"device_id": "x1", "platform": "symbian"},
    )
    assert r.status_code == 422, r.text


async def test_sync_devices_lists_my_devices(tc):
    """GET /sync/devices فقط دستگاه‌های همین کاربر را می‌دهد (owner-scoped)."""
    client = tc["client"]
    token_a = await _user_token(client, "sync-dev-a@example.com")
    token_b = await _user_token(client, "sync-dev-b@example.com")

    await client.post(
        f"{BASE}/users/me/devices", headers=_auth(token_a),
        json={"device_id": "dev-a1", "platform": "android"},
    )
    # یک push انجام می‌دهیم تا کرسر دستگاه ساخته شود
    await client.post(
        f"{BASE}/sync/push", headers=_auth(token_a),
        json={"device_id": "dev-a1", "ops": []},
    )
    r = await client.get(f"{BASE}/sync/devices", headers=_auth(token_a))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert any(i["device_id"] == "dev-a1" for i in items)

    r = await client.get(f"{BASE}/sync/devices", headers=_auth(token_b))
    assert r.status_code == 200, r.text
    assert all(i["device_id"] != "dev-a1" for i in r.json()["items"])


async def test_web_push_subscribe_unsubscribe(tc):
    """اشتراک و لغو اشتراک web push — upsert روی (user, endpoint)."""
    client = tc["client"]
    token = await _user_token(client, "sync-webpush2@example.com")
    sub = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
        "p256dh": "p256dh-key-material",
        "auth": "auth-secret",
    }
    r = await client.post(
        f"{BASE}/users/me/web-push/subscriptions", headers=_auth(token), json=sub,
    )
    assert r.status_code == 200, r.text
    assert r.json()["subscribed"] is True

    # اشتراک دوباره همان endpoint → همان یک ردیف (upsert)
    r = await client.post(
        f"{BASE}/users/me/web-push/subscriptions", headers=_auth(token), json=sub,
    )
    assert r.status_code == 200, r.text

    from app.models.models import User, WebPushSubscription
    maker = tc["maker"]
    async with maker() as db:
        user = (await db.execute(
            select(User).where(User.email == "sync-webpush2@example.com")
        )).scalar_one()
        rows = list((await db.execute(
            select(WebPushSubscription).where(WebPushSubscription.user_id == user.id)
        )).scalars().all())
        assert len(rows) == 1

    r = await client.request(
        "DELETE", f"{BASE}/users/me/web-push/subscriptions",
        headers=_auth(token), json={"endpoint": sub["endpoint"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["subscribed"] is False


async def test_web_push_rejects_non_https_endpoint(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-webpush3@example.com")
    r = await client.post(
        f"{BASE}/users/me/web-push/subscriptions", headers=_auth(token),
        json={"endpoint": "http://evil.example/hook", "p256dh": "k", "auth": "a"},
    )
    assert r.status_code == 422, r.text


async def test_vapid_key_not_configured_returns_unconfigured(tc):
    """بدون کلید VAPID در settings → configured=false، نه خطا."""
    client = tc["client"]
    token = await _user_token(client, "sync-vapid@example.com")
    r = await client.get(
        f"{BASE}/notifications/web-push/vapid-key", headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is False
    assert body["vapid_public_key"] is None


async def test_admin_sync_devices_requires_permission(tc, db_session):
    """GET /admin/sync/devices: بدون مجوز 403؛ با sync.manage همهٔ دستگاه‌ها."""
    import uuid as _uuid

    from app.models.models import Permission, Role, RolePermission, UserRole

    client = tc["client"]
    token_plain = await _user_token(client, "sync-nodev@example.com")
    r = await client.get(f"{BASE}/admin/sync/devices", headers=_auth(token_plain))
    assert r.status_code == 403, r.text

    # ساخت مجوز sync.manage و نقش ادمین (get-or-create)
    perm = (await db_session.execute(
        select(Permission).where(Permission.key == "sync.manage")
    )).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="sync.manage", description="test")
        db_session.add(perm)
        await db_session.flush()
    role = (await db_session.execute(
        select(Role).where(Role.name == "sync_admin_test")
    )).scalar_one_or_none()
    if role is None:
        role = Role(name="sync_admin_test", description="test")
        db_session.add(role)
        await db_session.flush()
    exists = (await db_session.execute(
        select(RolePermission).where(
            RolePermission.role_id == role.id,
            RolePermission.permission_id == perm.id,
        )
    )).first()
    if not exists:
        db_session.add(RolePermission(role_id=role.id, permission_id=perm.id))
    await db_session.commit()

    me = await _register(client, "sync-admin@example.com")
    db_session.add(UserRole(user_id=_uuid.UUID(me["id"]), role_id=role.id))
    await db_session.commit()
    token_admin = await _login(client, "sync-admin@example.com")

    # یک دستگاه برای کاربر دیگر ثبت می‌کنیم تا در لیست ادمین دیده شود
    token_other = await _user_token(client, "sync-other-dev@example.com")
    await client.post(
        f"{BASE}/users/me/devices", headers=_auth(token_other),
        json={"device_id": "other-phone", "platform": "ios"},
    )

    r = await client.get(f"{BASE}/admin/sync/devices", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    devices = r.json()["devices"]
    assert any(d["device_id"] == "other-phone" for d in devices)
