"""تست‌های inbox اعلان‌های دریافتی کاربر (فاز ۱۶ — تکمیل‌کنندهٔ هماهنگ‌کننده).

پوشش:
(a) لیست اعلان‌های خودِ کاربر + شمارش خوانده‌نشده‌ها
(b) فیلتر unread_only
(c) علامت‌گذاری خوانده‌شدن (idempotent)
(d) ایزولاسیون: کاربر دیگر اعلان من را نمی‌بیند / نمی‌تواند خوانده کند (۴۰۴)
(e) صفحه‌بندی cursor-based
"""
from __future__ import annotations

import uuid

import pytest

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register_login(client, email: str) -> tuple[str, uuid.UUID]:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    uid = uuid.UUID(r.json()["id"])
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"], uid


async def _seed_notification(db_session, user_id: uuid.UUID, n: int = 1):
    from app.models.models import Notification

    rows = []
    for i in range(n):
        row = Notification(
            user_id=user_id,
            notif_type="task",
            title={"fa": f"اعلان تست {i}", "ar": f"إشعار {i}", "en": f"test {i}"},
            body="متن",
            data={"source": "pms", "kind": "assigned"},
        )
        db_session.add(row)
        rows.append(row)
    await db_session.commit()
    return rows


@pytest.mark.asyncio
async def test_my_notifications_list_and_unread_count(tc, db_session):
    client = tc["client"]
    token_a, uid_a = await _register_login(client, "me-notif-a@example.com")
    await _register_login(client, "me-notif-b@example.com")
    await _seed_notification(db_session, uid_a, 3)

    r = await client.get(f"{BASE}/users/me/notifications", headers=_auth(token_a))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["unread_count"] == 3
    assert len(body["items"]) == 3
    # جدیدترین اول
    assert body["items"][0]["title"]["fa"] == "اعلان تست 2"
    assert body["items"][0]["read_at"] is None


@pytest.mark.asyncio
async def test_my_notifications_isolated_per_user(tc, db_session):
    client = tc["client"]
    token_a, uid_a = await _register_login(client, "me-notif-c@example.com")
    token_b, _ = await _register_login(client, "me-notif-d@example.com")
    await _seed_notification(db_session, uid_a, 1)

    r = await client.get(f"{BASE}/users/me/notifications", headers=_auth(token_b))
    assert r.status_code == 200, r.text
    assert r.json()["unread_count"] == 0
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_mark_read_idempotent_and_owned_only(tc, db_session):
    client = tc["client"]
    token_a, uid_a = await _register_login(client, "me-notif-e@example.com")
    token_b, _ = await _register_login(client, "me-notif-f@example.com")
    (row,) = await _seed_notification(db_session, uid_a, 1)

    # کاربر دیگر → ۴۰۴
    r = await client.post(
        f"{BASE}/users/me/notifications/{row.id}/read", headers=_auth(token_b)
    )
    assert r.status_code == 404, r.text

    # مالک → خوانده می‌شود
    r = await client.post(
        f"{BASE}/users/me/notifications/{row.id}/read", headers=_auth(token_a)
    )
    assert r.status_code == 200, r.text
    assert r.json()["read_at"] is not None

    # تکرار → idempotent، خطا نمی‌دهد
    r = await client.post(
        f"{BASE}/users/me/notifications/{row.id}/read", headers=_auth(token_a)
    )
    assert r.status_code == 200, r.text

    # فیلتر unread_only دیگر آن را برنمی‌گرداند
    r = await client.get(
        f"{BASE}/users/me/notifications?unread_only=true", headers=_auth(token_a)
    )
    assert r.status_code == 200, r.text
    assert r.json()["unread_count"] == 0
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_my_notifications_cursor_pagination(tc, db_session):
    client = tc["client"]
    token_a, uid_a = await _register_login(client, "me-notif-g@example.com")
    await _seed_notification(db_session, uid_a, 5)

    r = await client.get(
        f"{BASE}/users/me/notifications?limit=2", headers=_auth(token_a)
    )
    assert r.status_code == 200, r.text
    page1 = r.json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"]

    r = await client.get(
        f"{BASE}/users/me/notifications?limit=2&cursor={page1['next_cursor']}",
        headers=_auth(token_a),
    )
    assert r.status_code == 200, r.text
    page2 = r.json()
    assert len(page2["items"]) == 2
    ids1 = {i["id"] for i in page1["items"]}
    ids2 = {i["id"] for i in page2["items"]}
    assert not ids1 & ids2  # بدون تکرار

    # کرسر نامعتبر → ۴۰۰
    r = await client.get(
        f"{BASE}/users/me/notifications?cursor=bogus", headers=_auth(token_a)
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_my_notifications_requires_auth(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/users/me/notifications")
    assert r.status_code in (401, 403), r.text
