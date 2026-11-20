"""اسکیماهای Pydantic بخش ویدیوها.

ویدیو = آیتم کتابخانه با kind ∈ {video, video_360}. media_key خام هرگز
در پاسخ‌ها برنمی‌گردد — فقط signed URL کوتاه‌مدت از مسیر کتابخانه.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# LocalizedText: {"fa": ..., "ar": ..., "en": ...} — هرگز متن تک‌زبانهٔ هاردکد.
LocalizedText = dict[str, str]

VIDEO_KINDS: tuple[str, ...] = ("video", "video_360")


class PlaylistRef(BaseModel):
    """ارجاع سبک به لیست پخش منتشرشده (عضویت‌های یک ویدیو)."""

    id: uuid.UUID
    title: LocalizedText


class VideoItemOut(BaseModel):
    id: uuid.UUID
    kind: str
    title: LocalizedText
    description: LocalizedText | None
    cover_url: str | None = None
    duration_seconds: int | None
    scholar_id: uuid.UUID | None
    scholar_name: str | None = None
    topic_tags: list[str]
    visibility: str
    created_at: datetime
    playlists: list[PlaylistRef] = Field(default_factory=list)


class VideoListOut(BaseModel):
    items: list[VideoItemOut]
    next_cursor: str | None = None


class PlaylistOut(BaseModel):
    id: uuid.UUID
    title: LocalizedText
    description: LocalizedText | None
    cover_url: str | None = None
    scholar_id: uuid.UUID | None
    scholar_name: str | None = None
    is_published: bool
    sort_order: int
    item_count: int
    total_duration_seconds: int
    items: list[VideoItemOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PlaylistContextOut(BaseModel):
    """زمینهٔ لیست پخش در صفحهٔ تماشا: موقعیت فعلی + قبلی/بعدی + همهٔ آیتم‌ها."""

    playlist: PlaylistRef
    position: int  # ۱-based
    total: int
    prev_item_id: uuid.UUID | None
    next_item_id: uuid.UUID | None
    items: list[VideoItemOut] = Field(default_factory=list)


class WatchOut(BaseModel):
    item: VideoItemOut
    stream_url: str | None = None
    playlist: PlaylistContextOut | None = None
    related: list[VideoItemOut] = Field(default_factory=list)


class PlaylistCreateIn(BaseModel):
    title: LocalizedText
    description: LocalizedText | None = None
    cover_media_key: str | None = Field(default=None, max_length=1024)
    scholar_id: uuid.UUID | None = None
    is_published: bool = False
    sort_order: int = 0


class PlaylistUpdateIn(BaseModel):
    title: LocalizedText | None = None
    description: LocalizedText | None = None
    cover_media_key: str | None = Field(default=None, max_length=1024)
    scholar_id: uuid.UUID | None = None
    is_published: bool | None = None
    sort_order: int | None = None


class PlaylistItemAddIn(BaseModel):
    item_id: uuid.UUID
    position: int | None = Field(default=None, ge=0)


class PlaylistOrderIn(BaseModel):
    item_ids: list[uuid.UUID]


class AdminPlaylistItemOut(BaseModel):
    """عضو لیست در نمای مدیریت — وضعیت گردش‌کار آیتم هم دیده می‌شود."""

    item_id: uuid.UUID
    position: int
    kind: str
    title: LocalizedText
    workflow_status: str
    visibility: str
    duration_seconds: int | None
    created_at: datetime


class AdminPlaylistOut(BaseModel):
    id: uuid.UUID
    title: LocalizedText
    description: LocalizedText | None
    cover_media_key: str | None
    scholar_id: uuid.UUID | None
    scholar_name: str | None = None
    is_published: bool
    sort_order: int
    item_count: int
    items: list[AdminPlaylistItemOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class CandidateOut(BaseModel):
    """آیتم ویدیویی کتابخانه برای انتخاب‌گر CRM (همهٔ وضعیت‌های گردش‌کار)."""

    id: uuid.UUID
    kind: str
    title: LocalizedText
    workflow_status: str
    visibility: str
    duration_seconds: int | None
    created_at: datetime
