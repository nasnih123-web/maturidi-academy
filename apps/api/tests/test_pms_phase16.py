"""تست‌های فاز ۱۶ (Track بک‌اند): مدیریت پروژه و نیروی انسانی داخلی (PMS).

پوشش:
(a) چرخهٔ کامل تسک: ساخت → محول‌شدن → جابه‌جایی در وضعیت‌ها (گذار نامعتبر رد می‌شود)
(b) تسک وصل به library_item + lookup معکوس by-entity
(c) محول‌شونده هنگام assignment اعلان می‌گیرد (ردیف Notification ثبت می‌شود)
(d) کرون due_soon: اعلان + علامت‌گذاری، بدون اسپم در اجرای دوم
(e) RBAC: کاربر بدون مجوز ۴۰۳ می‌گیرد (write و read)
(f) CRUD نیروی انسانی + audit log + رویدادهای دامنه
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.modules.projects import service as pms_service

BASE = "/api/v1"


# ---------------------------------------------------------------------------
# کمک‌ها
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str) -> dict:
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
    return r.json()


async def _login(client, email: str) -> str:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _pms_admin_token(client, db_session, email: str) -> str:
    """کاربر با نقش super_admin + مجوز projects.manage (الگوی تست فاز ۱۵)."""
    from sqlalchemy import select

    from app.models.models import Permission, Role, RolePermission, UserRole

    me = await _register(client, email)
    token = await _login(client, email)
    role = (
        await db_session.execute(select(Role).where(Role.name == "super_admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="super_admin", description="test")
        db_session.add(role)
        await db_session.flush()
    perm = (
        await db_session.execute(
            select(Permission).where(Permission.key == "projects.manage")
        )
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="projects.manage", description="test")
        db_session.add(perm)
        await db_session.flush()
    exists = (
        await db_session.execute(
            select(UserRole).where(
                UserRole.user_id == uuid.UUID(me["id"]), UserRole.role_id == role.id
            )
        )
    ).first()
    if not exists:
        db_session.add(UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id))
    rp = (
        await db_session.execute(
            select(RolePermission).where(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == perm.id,
            )
        )
    ).first()
    if not rp:
        db_session.add(RolePermission(role_id=role.id, permission_id=perm.id))

    # remediation-pass-2 Track 1 (§۵): نقش ممتاز بدون TOTP با هیچ توکنی به
    # endpoint ادمین نمی‌رسد؛ helper سکرت TOTP هم می‌نشاند.
    import json

    import pyotp

    from app.core.secrets import encrypt_value
    from app.models.models import User as _T1User

    _t1u = (
        await db_session.execute(select(_T1User).where(_T1User.id == uuid.UUID(me["id"])))
    ).scalar_one()
    _t1u.totp_secret = json.dumps(encrypt_value(pyotp.random_base32()))
    await db_session.commit()
    return token


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


async def _make_project(client, headers, title: str = "پروژه تست") -> dict:
    r = await client.post(
        f"{BASE}/projects",
        json={"title": _L(title), "status": "active"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# (a) چرخهٔ کامل تسک + گذارهای کانبان
# ---------------------------------------------------------------------------


async def test_task_lifecycle_and_kanban_transitions(tc, db_session):
    client = tc["client"]
    admin_headers = _auth(await _pms_admin_token(client, db_session, "pms-admin@example.com"))
    proj = await _make_project(client, admin_headers)

    # ساخت تسک
    r = await client.post(
        f"{BASE}/projects/{proj['id']}/tasks",
        json={"title": _L("ترجمهٔ سند"), "priority": "high"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    task = r.json()
    assert task["status"] == "backlog"
    task_id = task["id"]

    # گذار نامعتبر: backlog → done مستقیم
    r = await client.post(
        f"{BASE}/projects/tasks/{task_id}/move",
        json={"status": "done"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_status_transition"

    # چرخهٔ مجاز: backlog → todo → in_progress → review → done
    for nxt in ("todo", "in_progress", "review", "done"):
        r = await client.post(
            f"{BASE}/projects/tasks/{task_id}/move",
            json={"status": nxt},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == nxt

    # گذار نامعتبر از done: done → in_progress رد می‌شود
    r = await client.post(
        f"{BASE}/projects/tasks/{task_id}/move",
        json={"status": "in_progress"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text

    # بازگشایی مجاز است: done → todo
    r = await client.post(
        f"{BASE}/projects/tasks/{task_id}/move",
        json={"status": "todo"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "todo"

    # رویدادهای دامنه (§۴)
    from sqlalchemy import select

    from app.models.models import DomainEvent

    ev_types = (
        await db_session.execute(
            select(DomainEvent.event_type).where(
                DomainEvent.aggregate_id == task_id
            )
        )
    ).scalars().all()
    assert "task.created" in ev_types
    assert "task.status_changed" in ev_types

    # audit log (§۱۴)
    from app.models.models import AuditLog

    actions = (
        await db_session.execute(
            select(AuditLog.action).where(AuditLog.entity_id == task_id)
        )
    ).scalars().all()
    assert "projects.task.create" in actions
    assert "projects.task.move" in actions


# ---------------------------------------------------------------------------
# (b) اتصال به library_item + lookup معکوس
# ---------------------------------------------------------------------------


async def test_task_linked_to_library_item_and_reverse_lookup(tc, db_session):
    from app.models.models import LibraryItem

    client = tc["client"]
    admin_headers = _auth(await _pms_admin_token(client, db_session, "pms-admin2@example.com"))
    proj = await _make_project(client, admin_headers, "پروژه کتابخانه")

    item = LibraryItem(
        kind="pdf",
        title=_L("کتاب تست"),
        media_key="test-media-key-pms",
    )
    db_session.add(item)
    await db_session.flush()
    item_id = str(item.id)
    await db_session.commit()

    r = await client.post(
        f"{BASE}/projects/{proj['id']}/tasks",
        json={
            "title": _L("فهرست‌نویسی کتاب"),
            "related_entity_type": "library_item",
            "related_entity_id": item_id,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    task = r.json()
    assert task["related_entity_type"] == "library_item"
    assert task["related_entity_id"] == item_id

    # lookup معکوس از سمت آیتم کتابخانه
    r = await client.get(
        f"{BASE}/projects/tasks/by-entity",
        params={"related_entity_type": "library_item", "related_entity_id": item_id},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    found = r.json()
    assert any(t["id"] == task["id"] for t in found)

    # موجودیت نامرتبط چیزی برنمی‌گرداند
    r = await client.get(
        f"{BASE}/projects/tasks/by-entity",
        params={
            "related_entity_type": "library_item",
            "related_entity_id": str(uuid.uuid4()),
        },
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json() == []


# ---------------------------------------------------------------------------
# (c) اعلان محول‌شدن به assignee
# ---------------------------------------------------------------------------


async def test_assignee_gets_notification_on_assignment(tc, db_session):
    from sqlalchemy import select

    from app.models.models import DomainEvent, Notification

    client = tc["client"]
    admin_headers = _auth(await _pms_admin_token(client, db_session, "pms-admin3@example.com"))
    worker = await _register(client, "pms-worker@example.com")
    worker_id = worker["id"]
    proj = await _make_project(client, admin_headers, "پروژه اعلان")

    # ساخت تسک با assignee → باید task.assigned + اعلان ثبت شود
    r = await client.post(
        f"{BASE}/projects/{proj['id']}/tasks",
        json={"title": _L("بازبینی ترجمه"), "assignee_id": worker_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]

    notifs = (
        await db_session.execute(
            select(Notification).where(Notification.user_id == uuid.UUID(worker_id))
        )
    ).scalars().all()
    assert len(notifs) >= 1
    n = notifs[0]
    assert n.notif_type == "task"
    assert n.data["task_id"] == task_id
    assert n.data["kind"] == "assigned"

    ev = (
        await db_session.execute(
            select(DomainEvent).where(
                DomainEvent.aggregate_id == task_id,
                DomainEvent.event_type == "task.assigned",
            )
        )
    ).scalars().all()
    assert len(ev) >= 1

    # تغییر assignee در PATCH هم اعلان می‌دهد
    worker2 = await _register(client, "pms-worker2@example.com")
    r = await client.patch(
        f"{BASE}/projects/tasks/{task_id}",
        json={"assignee_id": worker2["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    notifs2 = (
        await db_session.execute(
            select(Notification).where(
                Notification.user_id == uuid.UUID(worker2["id"])
            )
        )
    ).scalars().all()
    assert len(notifs2) >= 1
    assert notifs2[0].data["kind"] == "assigned"


# ---------------------------------------------------------------------------
# (d) کرون due_soon — اعلان + ضد اسپم
# ---------------------------------------------------------------------------


async def test_due_soon_cron_notifies_and_marks(tc, db_session):
    from sqlalchemy import select

    from app.models.models import DomainEvent, Notification

    client = tc["client"]
    admin_headers = _auth(await _pms_admin_token(client, db_session, "pms-admin4@example.com"))
    worker = await _register(client, "pms-worker3@example.com")
    proj = await _make_project(client, admin_headers, "پروژه سررسید")

    due = (datetime.now(UTC) + timedelta(hours=12)).isoformat()
    r = await client.post(
        f"{BASE}/projects/{proj['id']}/tasks",
        json={"title": _L("تسک نزدیک سررسید"), "assignee_id": worker["id"], "due_date": due},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]

    # فراخوان مستقیم تابع کرون
    out = await pms_service.run_task_due_soon_cycle(db_session)
    assert out.scanned >= 1
    assert out.notified >= 1

    due_notifs = (
        await db_session.execute(
            select(Notification).where(
                Notification.user_id == uuid.UUID(worker["id"])
            )
        )
    ).scalars().all()
    due_notifs = [n for n in due_notifs if (n.data or {}).get("kind") == "due_soon"]
    assert any(n.data["task_id"] == task_id for n in due_notifs)

    ev = (
        await db_session.execute(
            select(DomainEvent).where(
                DomainEvent.aggregate_id == task_id,
                DomainEvent.event_type == "task.due_soon",
            )
        )
    ).scalars().all()
    assert len(ev) == 1

    # اجرای دوم: بدون اسپم — چیزی دوباره اعلان نمی‌شود
    async def _due_soon_count() -> int:
        rows = (
            await db_session.execute(select(Notification))
        ).scalars().all()
        return sum(1 for n in rows if (n.data or {}).get("kind") == "due_soon")

    before = await _due_soon_count()
    out2 = await pms_service.run_task_due_soon_cycle(db_session)
    assert out2.notified == 0
    after = await _due_soon_count()
    assert after == before


# ---------------------------------------------------------------------------
# (e) RBAC — کاربر بدون مجوز
# ---------------------------------------------------------------------------


async def test_rbac_denied_for_plain_user(tc):
    client = tc["client"]
    plain_headers = _auth(await _login(client, (await _register(client, "pms-plain@example.com"))["email"]))

    # write بدون projects.manage → ۴۰۳
    r = await client.post(
        f"{BASE}/projects", json={"title": _L("x")}, headers=plain_headers
    )
    assert r.status_code == 403, r.text

    # read بدون عضویت در تیم → ۴۰۳
    r = await client.get(f"{BASE}/projects", headers=plain_headers)
    assert r.status_code == 403, r.text

    r = await client.get(f"{BASE}/staff", headers=plain_headers)
    assert r.status_code == 403, r.text

    # کاملاً بدون توکن → ۴۰۱
    r = await client.get(f"{BASE}/projects")
    assert r.status_code == 401, r.text


# ---------------------------------------------------------------------------
# (f) CRUD نیروی انسانی
# ---------------------------------------------------------------------------


async def test_staff_crud_and_audit(tc, db_session):
    from sqlalchemy import select

    from app.models.models import AuditLog

    client = tc["client"]
    admin_headers = _auth(await _pms_admin_token(client, db_session, "pms-admin5@example.com"))
    member = await _register(client, "pms-staff@example.com")

    # ساخت
    r = await client.post(
        f"{BASE}/staff",
        json={
            "user_id": member["id"],
            "title": _L("توسعه‌دهنده"),
            "department": _L("فنی"),
            "joined_date": "2026-10-01",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    staff = r.json()
    assert staff["user_id"] == member["id"]
    assert staff["is_active"] is True

    # تکراری → ۴۰۹
    r = await client.post(
        f"{BASE}/staff",
        json={"user_id": member["id"], "title": _L("x"), "department": _L("y")},
        headers=admin_headers,
    )
    assert r.status_code == 409, r.text

    # لیست
    r = await client.get(f"{BASE}/staff", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(s["id"] == staff["id"] for s in r.json())

    # عضو تیم حالا می‌تواند بخواند (read برای staff احرازشده)
    staff_headers = _auth(await _login(client, member["email"]))
    r = await client.get(f"{BASE}/projects", headers=staff_headers)
    assert r.status_code == 200, r.text

    # به‌روزرسانی + حذف
    r = await client.patch(
        f"{BASE}/staff/{staff['id']}",
        json={"title": _L("توسعه‌دهنده ارشد")},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"]["fa"] == "توسعه‌دهنده ارشد"

    r = await client.delete(f"{BASE}/staff/{staff['id']}", headers=admin_headers)
    assert r.status_code == 204, r.text

    actions = (
        await db_session.execute(
            select(AuditLog.action).where(AuditLog.entity_id == staff["id"])
        )
    ).scalars().all()
    assert "projects.staff.create" in actions
    assert "projects.staff.update" in actions
    assert "projects.staff.delete" in actions


# ---------------------------------------------------------------------------
# اعتبارسنجی‌های پایه
# ---------------------------------------------------------------------------


async def test_project_crud_and_task_filters(tc, db_session):
    client = tc["client"]
    admin_headers = _auth(await _pms_admin_token(client, db_session, "pms-admin6@example.com"))
    proj = await _make_project(client, admin_headers, "پروژه فیلتر")

    for i, st in enumerate(("backlog", "todo", "todo")):
        r = await client.post(
            f"{BASE}/projects/{proj['id']}/tasks",
            json={"title": _L(f"تسک {i}"), "status": st},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text

    r = await client.get(
        f"{BASE}/projects/{proj['id']}/tasks",
        params={"status": "todo"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) == 2
    assert all(t["status"] == "todo" for t in body["items"])

    # به‌روزرسانی پروژه
    r = await client.patch(
        f"{BASE}/projects/{proj['id']}",
        json={"status": "on_hold"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "on_hold"
    assert r.json()["task_count"] == 3

    # وضعیت نامعتبر → ۴۲۲
    r = await client.patch(
        f"{BASE}/projects/{proj['id']}",
        json={"status": "bogus"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
