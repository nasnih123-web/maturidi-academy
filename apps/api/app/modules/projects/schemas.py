"""اسکیماهای فاز ۱۶ — مدیریت پروژه و نیروی انسانی داخلی (PMS).

همهٔ متن‌های قابل‌مشاهدهٔ کاربر LocalizedText (§۱۵.۴).
"""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class LocalizedText(BaseModel):
    """متن قابل‌مشاهدهٔ کاربر — همیشه هر سه زبان (§۱۵.۴)."""

    fa: str
    ar: str
    en: str


PROJECT_STATUSES = ("active", "on_hold", "completed", "archived")
TASK_STATUSES = ("backlog", "todo", "in_progress", "review", "done")
TASK_PRIORITIES = ("low", "medium", "high", "urgent")

#: گذارهای مجاز بورد کانبان — move فقط این‌ها را قبول می‌کند.
TASK_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "backlog": ("todo",),
    "todo": ("in_progress", "backlog"),
    "in_progress": ("review", "todo"),
    "review": ("done", "in_progress"),
    "done": ("todo",),  # بازگشایی
}


# ---------------------------------------------------------------------------
# پروژه‌ها
# ---------------------------------------------------------------------------


class ProjectIn(BaseModel):
    title: LocalizedText
    status: str = Field(default="active", pattern="^(active|on_hold|completed|archived)$")


class ProjectPatch(BaseModel):
    title: LocalizedText | None = None
    status: str | None = Field(default=None, pattern="^(active|on_hold|completed|archived)$")


class ProjectOut(BaseModel):
    id: UUID
    title: LocalizedText
    status: str
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime | None
    task_count: int = 0


class ProjectPage(BaseModel):
    items: list[ProjectOut]
    next_cursor: str | None


# ---------------------------------------------------------------------------
# تسک‌ها
# ---------------------------------------------------------------------------


class TaskIn(BaseModel):
    title: LocalizedText
    description: LocalizedText | None = None
    assignee_id: UUID | None = None
    status: str = Field(default="backlog", pattern="^(backlog|todo|in_progress|review|done)$")
    due_date: datetime | None = None
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")
    related_entity_type: str | None = Field(default=None, max_length=64)
    related_entity_id: UUID | None = None


class TaskPatch(BaseModel):
    title: LocalizedText | None = None
    description: LocalizedText | None = None
    assignee_id: UUID | None = None
    due_date: datetime | None = None
    priority: str | None = Field(default=None, pattern="^(low|medium|high|urgent)$")
    related_entity_type: str | None = Field(default=None, max_length=64)
    related_entity_id: UUID | None = None


class TaskMove(BaseModel):
    status: str = Field(pattern="^(backlog|todo|in_progress|review|done)$")


class TaskOut(BaseModel):
    id: UUID
    project_id: UUID
    title: LocalizedText
    description: LocalizedText | None
    assignee_id: UUID | None
    status: str
    due_date: datetime | None
    priority: str
    related_entity_type: str | None
    related_entity_id: UUID | None
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime | None


class TaskPage(BaseModel):
    items: list[TaskOut]
    next_cursor: str | None


# ---------------------------------------------------------------------------
# نیروی انسانی
# ---------------------------------------------------------------------------


class StaffIn(BaseModel):
    user_id: UUID
    title: LocalizedText
    department: LocalizedText
    joined_date: date | None = None
    is_active: bool = True


class StaffPatch(BaseModel):
    title: LocalizedText | None = None
    department: LocalizedText | None = None
    joined_date: date | None = None
    is_active: bool | None = None


class StaffOut(BaseModel):
    id: UUID
    user_id: UUID
    title: LocalizedText
    department: LocalizedText
    joined_date: date | None
    is_active: bool
    created_at: datetime
    updated_at: datetime | None


class DueSoonCycleOut(BaseModel):
    scanned: int
    notified: int
