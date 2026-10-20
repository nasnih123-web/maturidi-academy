"""اسکیماهای API شبکهٔ اجتماعی و نظارت — فاز ۱۰.

LocalizedText از اسکیمای خانه بازاستفاده می‌شود — تعریف تکراری ممنوع (§۱۵.۲).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.home.schemas import LocalizedText

# ---------------------------------------------------------------------------
# گروه‌ها
# ---------------------------------------------------------------------------


class GroupCreate(BaseModel):
    name: LocalizedText
    description: LocalizedText | None = None
    slug: str | None = Field(default=None, max_length=128)
    is_public: bool = True


class GroupOut(BaseModel):
    id: UUID
    name: LocalizedText
    description: LocalizedText | None
    slug: str
    is_public: bool
    member_count: int
    is_member: bool = False
    created_at: datetime


class GroupPage(BaseModel):
    items: list[GroupOut]
    next_cursor: str | None = None


# ---------------------------------------------------------------------------
# پست و فید
# ---------------------------------------------------------------------------


class PostCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    group_id: UUID | None = None


class PostOut(BaseModel):
    id: UUID
    group_id: UUID | None
    author_id: UUID
    body: str
    status: str
    comment_count: int
    likes_count: int = 0
    liked: bool = False
    created_at: datetime


class LikeOut(BaseModel):
    liked: bool
    likes_count: int


class FeedPage(BaseModel):
    items: list[PostOut]
    next_cursor: str | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class CommentOut(BaseModel):
    id: UUID
    post_id: UUID
    author_id: UUID
    body: str
    status: str
    created_at: datetime


class CommentPage(BaseModel):
    items: list[CommentOut]
    next_cursor: str | None = None


class FollowCreate(BaseModel):
    followed_id: UUID


class FollowOut(BaseModel):
    id: UUID
    follower_id: UUID
    followed_id: UUID
    created_at: datetime


# ---------------------------------------------------------------------------
# گزارش و نظارت
# ---------------------------------------------------------------------------


class ReportCreate(BaseModel):
    target_type: Literal["post", "comment", "user"]
    target_id: UUID
    reason: str = Field(min_length=1, max_length=2000)


class ReportOut(BaseModel):
    id: UUID
    target_type: str
    target_id: UUID
    reason: str
    reported_by: UUID
    status: str
    reported_at: datetime
    triaged_at: datetime | None
    actioned_at: datetime | None
    sla_due_at: datetime
    action: str | None
    note: str | None


class ReportQueuePage(BaseModel):
    items: list[ReportOut]
    next_cursor: str | None = None


class ReportAction(BaseModel):
    action: Literal["triage", "dismiss", "remove_content", "warn_user", "ban_user"]
    note: str | None = Field(default=None, max_length=2000)


class BannedWordCreate(BaseModel):
    word: str = Field(min_length=1, max_length=128)


class BannedWordOut(BaseModel):
    id: UUID
    word: str
    created_at: datetime


# ---------------------------------------------------------------------------
# اعلان‌ها
# ---------------------------------------------------------------------------


class NotificationOut(BaseModel):
    id: UUID
    notif_type: str
    title: LocalizedText
    body: str | None
    data: dict | None
    read_at: datetime | None
    created_at: datetime


class NotificationPage(BaseModel):
    items: list[NotificationOut]
    next_cursor: str | None = None
