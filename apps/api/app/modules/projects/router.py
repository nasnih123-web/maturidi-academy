"""روتر فاز ۱۶ — مدیریت پروژه و نیروی انسانی داخلی (PMS).

§۱۵.۶: روتر هرگز مستقیم به دیتابیس دسترسی ندارد — فقط service صدا زده می‌شود.
RBAC: همهٔ writeها مجوز projects.manage می‌خواهند؛ readها «کارمند احرازشده»
(کاربر دارای projects.manage یا ردیف فعال در staff_members).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import Permission, RolePermission, StaffMember, User, UserRole
from app.modules.auth.dependencies import get_current_user, require_permission

from . import schemas, service

projects_router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
staff_router = APIRouter(prefix="/api/v1/staff", tags=["staff"])

_projects_admin = require_permission("projects.manage")


async def _staff_reader(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """خوانش: کارمند احرازشده — دارندهٔ projects.manage یا عضو فعال تیم."""
    has_perm = (
        await db.execute(
            select(Permission.id)
            .select_from(UserRole)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(UserRole.user_id == user.id, Permission.key == "projects.manage")
            .limit(1)
        )
    ).first()
    if has_perm:
        return user
    staff = (
        await db.execute(
            select(StaffMember.id).where(
                StaffMember.user_id == user.id, StaffMember.is_active.is_(True)
            )
        )
    ).first()
    if not staff:
        raise APIError(403, "forbidden", "دسترسی کافی نیست — فقط اعضای تیم")
    return user


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


# ---------------------------------------------------------------------------
# پروژه‌ها
# ---------------------------------------------------------------------------


@projects_router.get("", response_model=schemas.ProjectPage)
async def list_projects(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    items, next_cursor = await service.list_projects(db, cursor=cursor, limit=limit)
    return {"items": items, "next_cursor": next_cursor}


@projects_router.post("", response_model=schemas.ProjectOut, status_code=201)
async def create_project(
    request: Request,
    body: schemas.ProjectIn,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_project(
        db, body, actor=user, ip=_client_ip(request), ua=_ua(request)
    )


@projects_router.get("/{project_id}", response_model=schemas.ProjectOut)
async def get_project(
    project_id: UUID,
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    return await service.project_out(db, await service.get_project(db, project_id))


@projects_router.patch("/{project_id}", response_model=schemas.ProjectOut)
async def update_project(
    project_id: UUID,
    request: Request,
    body: schemas.ProjectPatch,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_project(
        db, project_id, body, actor=user, ip=_client_ip(request), ua=_ua(request)
    )


@projects_router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    request: Request,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_project(
        db, project_id, actor=user, ip=_client_ip(request), ua=_ua(request)
    )
    return None


# ---------------------------------------------------------------------------
# تسک‌ها
# ---------------------------------------------------------------------------


# ثبت زودتر از /tasks/{task_id} تا «by-entity» با پارامتر مسیر اشتباه نشود.
@projects_router.get("/tasks/by-entity", response_model=list[schemas.TaskOut])
async def tasks_by_entity(
    related_entity_type: str = Query(),
    related_entity_id: UUID = Query(),
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    """lookup معکوس — تسک‌های وصل‌شده به یک موجودیت (مثلاً library_item)."""
    return await service.tasks_by_entity(
        db, related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )


@projects_router.get("/{project_id}/tasks", response_model=schemas.TaskPage)
async def list_tasks(
    project_id: UUID,
    status: str | None = Query(default=None, pattern="^(backlog|todo|in_progress|review|done)$"),
    assignee_id: UUID | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    items, next_cursor = await service.list_tasks(
        db, project_id, status=status, assignee_id=assignee_id,
        cursor=cursor, limit=limit,
    )
    return {"items": items, "next_cursor": next_cursor}


@projects_router.post("/{project_id}/tasks", response_model=schemas.TaskOut, status_code=201)
async def create_task(
    project_id: UUID,
    request: Request,
    body: schemas.TaskIn,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_task(
        db, project_id, body, actor=user, ip=_client_ip(request), ua=_ua(request)
    )


@projects_router.get("/tasks/{task_id}", response_model=schemas.TaskOut)
async def get_task(
    task_id: UUID,
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    return service._task_out(await service.get_task(db, task_id))


@projects_router.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
async def update_task(
    task_id: UUID,
    request: Request,
    body: schemas.TaskPatch,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_task(
        db, task_id, body, actor=user, ip=_client_ip(request), ua=_ua(request)
    )


@projects_router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: UUID,
    request: Request,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_task(
        db, task_id, actor=user, ip=_client_ip(request), ua=_ua(request)
    )
    return None


@projects_router.post("/tasks/{task_id}/move", response_model=schemas.TaskOut)
async def move_task(
    task_id: UUID,
    request: Request,
    body: schemas.TaskMove,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    """جابه‌جایی روی بورد کانبان — گذار نامعتبر ۴۲۲ می‌گیرد."""
    return await service.move_task(
        db, task_id, body.status, actor=user,
        ip=_client_ip(request), ua=_ua(request),
    )


# ---------------------------------------------------------------------------
# نیروی انسانی
# ---------------------------------------------------------------------------


@staff_router.get("", response_model=list[schemas.StaffOut])
async def list_staff(
    active_only: bool = Query(default=True),
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_staff(db, active_only=active_only)


@staff_router.post("", response_model=schemas.StaffOut, status_code=201)
async def create_staff(
    request: Request,
    body: schemas.StaffIn,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_staff(
        db, body, actor=user, ip=_client_ip(request), ua=_ua(request)
    )


@staff_router.get("/{staff_id}", response_model=schemas.StaffOut)
async def get_staff(
    staff_id: UUID,
    user: User = Depends(_staff_reader),
    db: AsyncSession = Depends(get_db),
):
    return service._staff_out(await service.get_staff(db, staff_id))


@staff_router.patch("/{staff_id}", response_model=schemas.StaffOut)
async def update_staff(
    staff_id: UUID,
    request: Request,
    body: schemas.StaffPatch,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_staff(
        db, staff_id, body, actor=user, ip=_client_ip(request), ua=_ua(request)
    )


@staff_router.delete("/{staff_id}", status_code=204)
async def delete_staff(
    staff_id: UUID,
    request: Request,
    user: User = Depends(_projects_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_staff(
        db, staff_id, actor=user, ip=_client_ip(request), ua=_ua(request)
    )
    return None
