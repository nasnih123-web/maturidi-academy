"""سرویس فاز ۱۶ — مدیریت پروژه و نیروی انسانی داخلی (PMS).

§۱۵.۲: تمام منطق کسب‌وکار این‌جاست؛ روتر فقط صدا می‌زند (§۱۵.۶).
§۱۵.۴: متن‌های قابل‌مشاهده همیشه LocalizedText.
§۴: رویدادهای دامنه (outbox) — project.created / task.created / task.assigned /
    task.status_changed / task.due_soon.
§۱۴: audit روی create/update/delete/move/assign.
اعلان محول‌شدن/سررسید از طریق notify_service با احترام به
notification_preferences؛ تحویل در جدول notifications ثبت می‌شود.
"""
from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import (
    Notification,
    Project,
    StaffMember,
    Task,
    User,
)
from app.modules.admin import notify_service

from . import schemas


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# صفحه‌بندی cursor (§۱)
# ---------------------------------------------------------------------------


def _encode_cursor(ts: datetime, lid: UUID) -> str:
    raw = f"{ts.astimezone(UTC).isoformat()}|{lid}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts_s, id_s = raw.rsplit("|", 1)
        return datetime.fromisoformat(ts_s), UUID(id_s)
    except Exception:
        raise APIError(400, "bad_cursor", "نشانگر صفحه‌بندی نامعتبر است")


# ---------------------------------------------------------------------------
# اعلان‌ها — محول‌شدن و نزدیک‌شدن سررسید
# ---------------------------------------------------------------------------

_NOTIF_CHANNELS = ["email", "sms", "push", "in_app"]


async def _notify_task_event(
    db: AsyncSession,
    *,
    assignee_id: UUID,
    kind: str,  # "assigned" | "due_soon"
    task: Task,
    project_title: dict,
) -> bool:
    """اعلان به محول‌شونده با احترام به notification_preferences.

    کانال‌های مؤثر از notify_service.effective_channels می‌آیند؛ تحویل in_app
    در جدول notifications ثبت می‌شود (notif_type="task")؛ کانال‌های دیگر از
    senderهای واقعی notify_service (با تنزل صادقانه‌ی همان ماژول).
    برمی‌گرداند: آیا دست‌کم یک کانال ارسال شد.
    """
    user = await db.get(User, assignee_id)
    if user is None or not user.is_active:
        return False
    channels = await notify_service.effective_channels(db, user, _NOTIF_CHANNELS)
    if not channels:
        return False

    fa_title = (task.title or {}).get("fa") or ""
    if kind == "assigned":
        titles = {
            "fa": "تسک جدید به شما محول شد",
            "ar": "تم إسناد مهمة جديدة إليك",
            "en": "A new task was assigned to you",
        }
        bodies = {
            "fa": f"«{fa_title}» به شما محول شد.",
            "ar": f"تم إسناد «{fa_title}» إليك.",
            "en": f"«{fa_title}» was assigned to you.",
        }
    else:
        titles = {
            "fa": "سررسید تسک نزدیک است",
            "ar": "موعد المهمة قريب",
            "en": "Task deadline is approaching",
        }
        bodies = {
            "fa": f"سررسید «{fa_title}» کمتر از ۲۴ ساعت دیگر است.",
            "ar": f"موعد «{fa_title}» خلال أقل من ٢٤ ساعة.",
            "en": f"«{fa_title}» is due within 24 hours.",
        }

    delivered: list[str] = []
    for ch in channels:
        if not notify_service.CHANNEL_CONFIGURED[ch]():
            continue
        if ch == "in_app":
            db.add(Notification(
                user_id=user.id,
                notif_type="task",
                title=titles,
                body=bodies["fa"],
                data={
                    "source": "pms",
                    "kind": kind,
                    "task_id": str(task.id),
                    "project_id": str(task.project_id),
                },
            ))
            delivered.append(ch)
            continue
        ok, _err = await notify_service.CHANNEL_SENDERS[ch](
            db, user, titles["fa"], bodies["fa"]
        )
        if ok:
            delivered.append(ch)
    await db.flush()
    return bool(delivered)


def _task_out(t: Task) -> schemas.TaskOut:
    return schemas.TaskOut(
        id=t.id, project_id=t.project_id, title=t.title,
        description=t.description, assignee_id=t.assignee_id, status=t.status,
        due_date=t.due_date, priority=t.priority,
        related_entity_type=t.related_entity_type,
        related_entity_id=t.related_entity_id, created_by=t.created_by,
        created_at=t.created_at, updated_at=t.updated_at,
    )


# ---------------------------------------------------------------------------
# پروژه‌ها
# ---------------------------------------------------------------------------


async def create_project(
    db: AsyncSession, body: schemas.ProjectIn, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.ProjectOut:
    p = Project(
        title=body.title.model_dump(), status=body.status, created_by=actor.id,
    )
    db.add(p)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.project.create",
        entity_type="project", entity_id=str(p.id),
        new_values={"title": body.title.model_dump(), "status": body.status},
        ip=ip, user_agent=ua,
    )
    await emit_event(
        db, aggregate_type="project", aggregate_id=str(p.id),
        event_type="project.created",
        payload={"project_id": str(p.id), "title": body.title.model_dump(),
                 "status": body.status},
    )
    await db.commit()
    await db.refresh(p)
    return schemas.ProjectOut(
        id=p.id, title=p.title, status=p.status, created_by=p.created_by,
        created_at=p.created_at, updated_at=p.updated_at, task_count=0,
    )


async def list_projects(
    db: AsyncSession, *, cursor: str | None = None, limit: int = 20,
) -> tuple[list[schemas.ProjectOut], str | None]:
    stmt = (
        select(Project).order_by(Project.created_at.desc(), Project.id.desc())
    )
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Project.created_at < ts,
                and_(Project.created_at == ts, Project.id < lid),
            )
        )
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    items = []
    for p in rows:
        cnt = (
            await db.execute(
                select(func.count()).select_from(Task).where(Task.project_id == p.id)
            )
        ).scalar_one()
        items.append(schemas.ProjectOut(
            id=p.id, title=p.title, status=p.status, created_by=p.created_by,
            created_at=p.created_at, updated_at=p.updated_at, task_count=cnt,
        ))
    return items, next_cursor


async def get_project(db: AsyncSession, project_id: UUID) -> Project:
    p = await db.get(Project, project_id)
    if p is None:
        raise APIError(404, "project_not_found", "پروژه یافت نشد")
    return p


async def project_out(db: AsyncSession, p: Project) -> schemas.ProjectOut:
    cnt = (
        await db.execute(
            select(func.count()).select_from(Task).where(Task.project_id == p.id)
        )
    ).scalar_one()
    return schemas.ProjectOut(
        id=p.id, title=p.title, status=p.status, created_by=p.created_by,
        created_at=p.created_at, updated_at=p.updated_at, task_count=cnt,
    )


async def update_project(
    db: AsyncSession, project_id: UUID, body: schemas.ProjectPatch, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.ProjectOut:
    p = await get_project(db, project_id)
    old = {"title": p.title, "status": p.status}
    if body.title is not None:
        p.title = body.title.model_dump()
    if body.status is not None:
        p.status = body.status
    p.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.project.update",
        entity_type="project", entity_id=str(p.id), old_values=old,
        new_values={"title": p.title, "status": p.status}, ip=ip, user_agent=ua,
    )
    await db.commit()
    await db.refresh(p)
    return await project_out(db, p)


async def delete_project(
    db: AsyncSession, project_id: UUID, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> None:
    p = await get_project(db, project_id)
    # حذف صریح تسک‌ها — سازگار با همهٔ دیتابیس‌ها (بدون اتکا به CASCADE سمت DB)
    task_ids = (
        await db.execute(select(Task.id).where(Task.project_id == p.id))
    ).scalars().all()
    for tid in task_ids:
        t = await db.get(Task, tid)
        if t is not None:
            await db.delete(t)
    await db.delete(p)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.project.delete",
        entity_type="project", entity_id=str(project_id),
        old_values={"title": p.title, "status": p.status, "deleted_tasks": len(task_ids)},
        ip=ip, user_agent=ua,
    )
    await db.commit()


# ---------------------------------------------------------------------------
# تسک‌ها
# ---------------------------------------------------------------------------


async def _require_assignee(db: AsyncSession, assignee_id: UUID | None) -> None:
    if assignee_id is None:
        return
    u = await db.get(User, assignee_id)
    if u is None or not u.is_active:
        raise APIError(404, "assignee_not_found", "کاربر محول‌شونده یافت نشد")


async def create_task(
    db: AsyncSession, project_id: UUID, body: schemas.TaskIn, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.TaskOut:
    await get_project(db, project_id)
    await _require_assignee(db, body.assignee_id)
    t = Task(
        project_id=project_id,
        title=body.title.model_dump(),
        description=body.description.model_dump() if body.description else None,
        assignee_id=body.assignee_id,
        status=body.status,
        due_date=body.due_date,
        priority=body.priority,
        related_entity_type=body.related_entity_type,
        related_entity_id=body.related_entity_id,
        created_by=actor.id,
    )
    db.add(t)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.task.create",
        entity_type="task", entity_id=str(t.id),
        new_values={"project_id": str(project_id), "title": body.title.model_dump(),
                    "status": t.status, "assignee_id": str(t.assignee_id) if t.assignee_id else None},
        ip=ip, user_agent=ua,
    )
    await emit_event(
        db, aggregate_type="task", aggregate_id=str(t.id),
        event_type="task.created",
        payload={"task_id": str(t.id), "project_id": str(project_id),
                 "title": body.title.model_dump(), "status": t.status,
                 "assignee_id": str(t.assignee_id) if t.assignee_id else None},
    )
    if t.assignee_id:
        await log_audit(
            db, actor_id=actor.id, actor_type="staff", action="projects.task.assign",
            entity_type="task", entity_id=str(t.id),
            new_values={"assignee_id": str(t.assignee_id)},
            ip=ip, user_agent=ua,
        )
        await emit_event(
            db, aggregate_type="task", aggregate_id=str(t.id),
            event_type="task.assigned",
            payload={"task_id": str(t.id), "assignee_id": str(t.assignee_id),
                     "by": str(actor.id)},
        )
        await _notify_task_event(
            db, assignee_id=t.assignee_id, kind="assigned",
            task=t, project_title=(await db.get(Project, project_id)).title,
        )
    await db.commit()
    await db.refresh(t)
    return _task_out(t)


async def get_task(db: AsyncSession, task_id: UUID) -> Task:
    t = await db.get(Task, task_id)
    if t is None:
        raise APIError(404, "task_not_found", "تسک یافت نشد")
    return t


async def list_tasks(
    db: AsyncSession, project_id: UUID, *,
    status: str | None = None, assignee_id: UUID | None = None,
    cursor: str | None = None, limit: int = 20,
) -> tuple[list[schemas.TaskOut], str | None]:
    await get_project(db, project_id)
    stmt = (
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(Task.created_at.desc(), Task.id.desc())
    )
    if status:
        stmt = stmt.where(Task.status == status)
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Task.created_at < ts,
                and_(Task.created_at == ts, Task.id < lid),
            )
        )
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return [_task_out(t) for t in rows], next_cursor


async def tasks_by_entity(
    db: AsyncSession, *, related_entity_type: str, related_entity_id: UUID,
) -> list[schemas.TaskOut]:
    """lookup معکوس — تسک‌های وصل‌شده به یک موجودیت دیگر فازها (مثلاً library_item)."""
    rows = (
        await db.execute(
            select(Task)
            .where(
                Task.related_entity_type == related_entity_type,
                Task.related_entity_id == related_entity_id,
            )
            .order_by(Task.created_at.desc(), Task.id.desc())
        )
    ).scalars().all()
    return [_task_out(t) for t in rows]


async def update_task(
    db: AsyncSession, task_id: UUID, body: schemas.TaskPatch, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.TaskOut:
    t = await get_task(db, task_id)
    old_assignee = t.assignee_id
    old = {
        "title": t.title, "description": t.description, "assignee_id": str(old_assignee) if old_assignee else None,
        "due_date": t.due_date.isoformat() if t.due_date else None, "priority": t.priority,
        "related_entity_type": t.related_entity_type,
        "related_entity_id": str(t.related_entity_id) if t.related_entity_id else None,
    }
    if body.assignee_id != old_assignee and body.assignee_id is not None:
        await _require_assignee(db, body.assignee_id)
    if body.title is not None:
        t.title = body.title.model_dump()
    if body.description is not None:
        t.description = body.description.model_dump()
    # assignee_id=None یعنی «برداشتن محول‌شدن» — فقط وقتی کلید آمده تغییر می‌کند
    if "assignee_id" in (body.model_fields_set or set()):
        t.assignee_id = body.assignee_id
    if body.due_date is not None:
        t.due_date = body.due_date
    if body.priority is not None:
        t.priority = body.priority
    if body.related_entity_type is not None:
        t.related_entity_type = body.related_entity_type
    if body.related_entity_id is not None:
        t.related_entity_id = body.related_entity_id
    t.updated_at = _utcnow()
    await db.flush()

    new_assignee = t.assignee_id
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.task.update",
        entity_type="task", entity_id=str(t.id), old_values=old,
        new_values={"title": t.title, "assignee_id": str(new_assignee) if new_assignee else None,
                    "priority": t.priority, "status": t.status},
        ip=ip, user_agent=ua,
    )
    if new_assignee != old_assignee and new_assignee is not None:
        await log_audit(
            db, actor_id=actor.id, actor_type="staff", action="projects.task.assign",
            entity_type="task", entity_id=str(t.id),
            old_values={"assignee_id": str(old_assignee) if old_assignee else None},
            new_values={"assignee_id": str(new_assignee)},
            ip=ip, user_agent=ua,
        )
        await emit_event(
            db, aggregate_type="task", aggregate_id=str(t.id),
            event_type="task.assigned",
            payload={"task_id": str(t.id), "assignee_id": str(new_assignee),
                     "by": str(actor.id)},
        )
        await _notify_task_event(
            db, assignee_id=new_assignee, kind="assigned",
            task=t, project_title=(await db.get(Project, t.project_id)).title,
        )
    await db.commit()
    await db.refresh(t)
    return _task_out(t)


async def delete_task(
    db: AsyncSession, task_id: UUID, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> None:
    t = await get_task(db, task_id)
    await db.delete(t)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.task.delete",
        entity_type="task", entity_id=str(task_id),
        old_values={"title": t.title, "status": t.status,
                    "project_id": str(t.project_id)},
        ip=ip, user_agent=ua,
    )
    await db.commit()


async def move_task(
    db: AsyncSession, task_id: UUID, status: str, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.TaskOut:
    """جابه‌جایی روی بورد کانبان — فقط گذارهای مجاز (schemas.TASK_TRANSITIONS)."""
    t = await get_task(db, task_id)
    if status not in schemas.TASK_TRANSITIONS.get(t.status, ()):
        raise APIError(
            422, "invalid_status_transition",
            f"گذار از {t.status} به {status} مجاز نیست",
            {"from": t.status, "to": status,
             "allowed": list(schemas.TASK_TRANSITIONS.get(t.status, ()))},
        )
    old_status = t.status
    t.status = status
    t.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.task.move",
        entity_type="task", entity_id=str(t.id),
        old_values={"status": old_status}, new_values={"status": status},
        ip=ip, user_agent=ua,
    )
    await emit_event(
        db, aggregate_type="task", aggregate_id=str(t.id),
        event_type="task.status_changed",
        payload={"task_id": str(t.id), "from": old_status, "to": status,
                 "by": str(actor.id)},
    )
    await db.commit()
    await db.refresh(t)
    return _task_out(t)


# ---------------------------------------------------------------------------
# کرون سررسید — tasks با due_date در ۲۴ ساعت آینده
# ---------------------------------------------------------------------------

_DUE_WINDOW = timedelta(hours=24)
_RENOTIFY_AFTER = timedelta(hours=20)


async def run_task_due_soon_cycle(
    db: AsyncSession, *, now: datetime | None = None,
) -> schemas.DueSoonCycleOut:
    """کرون اعلان سررسید (صدا زده می‌شود از due_cron.py — صف notifications).

    کاندیداها: due_date ≤ now+24h، وضعیت ≠ done،
    due_notified_at خالی یا قدیمی‌تر از ۲۰ ساعت (ضد اسپم).
    تسک بدون محول‌شونده هم علامت‌گذاری می‌شود تا هر اجرا دوباره اسکن نشود.
    منطق با now تزریقی تست‌پذیر است.
    """
    now = now or _utcnow()
    window_end = now + _DUE_WINDOW
    renotify_before = now - _RENOTIFY_AFTER
    rows = (
        await db.execute(
            select(Task).where(
                Task.due_date.is_not(None),
                Task.due_date <= window_end,
                Task.status != "done",
                or_(
                    Task.due_notified_at.is_(None),
                    Task.due_notified_at <= renotify_before,
                ),
            )
        )
    ).scalars().all()

    scanned = len(rows)
    notified = 0
    for t in rows:
        t.due_notified_at = now
        if t.assignee_id:
            project = await db.get(Project, t.project_id)
            delivered = await _notify_task_event(
                db, assignee_id=t.assignee_id, kind="due_soon",
                task=t, project_title=project.title if project else {},
            )
            if delivered:
                notified += 1
            await emit_event(
                db, aggregate_type="task", aggregate_id=str(t.id),
                event_type="task.due_soon",
                payload={"task_id": str(t.id), "due_date": t.due_date.isoformat(),
                         "assignee_id": str(t.assignee_id), "delivered": delivered},
            )
    await db.commit()
    return schemas.DueSoonCycleOut(scanned=scanned, notified=notified)


# ---------------------------------------------------------------------------
# نیروی انسانی
# ---------------------------------------------------------------------------


def _staff_out(s: StaffMember) -> schemas.StaffOut:
    return schemas.StaffOut(
        id=s.id, user_id=s.user_id, title=s.title, department=s.department,
        joined_date=s.joined_date, is_active=s.is_active,
        created_at=s.created_at, updated_at=s.updated_at,
    )


async def create_staff(
    db: AsyncSession, body: schemas.StaffIn, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.StaffOut:
    u = await db.get(User, body.user_id)
    if u is None or not u.is_active:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    exists = (
        await db.execute(
            select(StaffMember).where(StaffMember.user_id == body.user_id)
        )
    ).first()
    if exists:
        raise APIError(409, "staff_exists", "این کاربر قبلاً عضو تیم است")
    s = StaffMember(
        user_id=body.user_id,
        title=body.title.model_dump(),
        department=body.department.model_dump(),
        joined_date=body.joined_date,
        is_active=body.is_active,
    )
    db.add(s)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.staff.create",
        entity_type="staff_member", entity_id=str(s.id),
        new_values={"user_id": str(body.user_id), "title": body.title.model_dump(),
                    "department": body.department.model_dump()},
        ip=ip, user_agent=ua,
    )
    await db.commit()
    await db.refresh(s)
    return _staff_out(s)


async def list_staff(
    db: AsyncSession, *, active_only: bool = True,
) -> list[schemas.StaffOut]:
    stmt = select(StaffMember).order_by(StaffMember.created_at.desc())
    if active_only:
        stmt = stmt.where(StaffMember.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [_staff_out(s) for s in rows]


async def get_staff(db: AsyncSession, staff_id: UUID) -> StaffMember:
    s = await db.get(StaffMember, staff_id)
    if s is None:
        raise APIError(404, "staff_not_found", "عضو تیم یافت نشد")
    return s


async def update_staff(
    db: AsyncSession, staff_id: UUID, body: schemas.StaffPatch, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> schemas.StaffOut:
    s = await get_staff(db, staff_id)
    old = {"title": s.title, "department": s.department, "is_active": s.is_active}
    if body.title is not None:
        s.title = body.title.model_dump()
    if body.department is not None:
        s.department = body.department.model_dump()
    if body.joined_date is not None:
        s.joined_date = body.joined_date
    if body.is_active is not None:
        s.is_active = body.is_active
    s.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.staff.update",
        entity_type="staff_member", entity_id=str(s.id), old_values=old,
        new_values={"title": s.title, "department": s.department,
                    "is_active": s.is_active},
        ip=ip, user_agent=ua,
    )
    await db.commit()
    await db.refresh(s)
    return _staff_out(s)


async def delete_staff(
    db: AsyncSession, staff_id: UUID, *,
    actor: User, ip: str | None = None, ua: str | None = None,
) -> None:
    s = await get_staff(db, staff_id)
    await db.delete(s)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="staff", action="projects.staff.delete",
        entity_type="staff_member", entity_id=str(staff_id),
        old_values={"user_id": str(s.user_id), "title": s.title},
        ip=ip, user_agent=ua,
    )
    await db.commit()
