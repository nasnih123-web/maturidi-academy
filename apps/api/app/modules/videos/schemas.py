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

# زبان‌های مجاز زیرنویس خودکار (فاز ۳) — هم‌مجموعهٔ اعتبارسنج
# videos.subtitle_langs در platform_settings.
SUBTITLE_LANGS: tuple[str, ...] = ("fa", "ar", "en", "ur", "dari")


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
    # ویدیوی خارجی: یوتیوب ← external_url کانونیک + embed آمادهٔ iframe؛
    # لینک مستقیم فایل ← external_url هست، embed null و پخش از
    # stream_url (خود URL فایل)؛ برای آیتم‌های آپلودی هر دو null
    external_url: str | None = None
    embed_url: str | None = None
    duration_seconds: int | None
    scholar_id: uuid.UUID | None
    scholar_name: str | None = None
    topic_tags: list[str]
    visibility: str
    created_at: datetime
    # لحظهٔ ورود آیتم به وضعیت published؛ برای آیتم‌های منتشرشده همیشه
    # پر است و وب از آن «تاریخ انتشار» (شمسی در fa) می‌سازد
    published_at: datetime | None = None
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


class SubtitleTrackOut(BaseModel):
    """ترک زیرنویس آمادهٔ یک ویدیو — url مسیر نسبی endpoint فایل VTT است
    (کلاینت وب آن را با base API کامل می‌کند)."""

    lang: str
    url: str


class WatchOut(BaseModel):
    item: VideoItemOut
    stream_url: str | None = None
    playlist: PlaylistContextOut | None = None
    related: list[VideoItemOut] = Field(default_factory=list)
    # فقط ترک‌های ready؛ وقتی videos.subtitles_enabled خاموش است خالی است
    subtitles: list[SubtitleTrackOut] = Field(default_factory=list)


class SubtitleGenerateOut(BaseModel):
    """نتیجهٔ درخواست تولید زیرنویس: وضعیت pending هر زبان هدف.

    enqueued=False یعنی صف/ورکر در دسترس نبود و ردیف‌ها pending می‌مانند
    (صادقانه — تولیدی ادعا نمی‌شود که اتفاق نیفتاده).
    """

    item_id: uuid.UUID
    statuses: dict[str, str]
    enqueued: bool


class AdminSubtitleItemOut(BaseModel):
    """وضعیت زیرنویس هر ویدیوی آپلودی/لینک مستقیم فایل برای کارت CRM —
    هر پنج زبان همیشه حاضرند؛ نبود ردیف یعنی وضعیت "missing"."""

    id: uuid.UUID
    kind: str
    title: LocalizedText
    workflow_status: str
    visibility: str
    created_at: datetime
    subtitles: dict[str, str]
    # lang → دلیل خطای ذخیره‌شده؛ فقط برای ردیف‌های failed با error غیرخالی.
    errors: dict[str, str] = Field(default_factory=dict)


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


class VideoProgressIn(BaseModel):
    """ذخیرهٔ موقعیت پخش — position منفی نامعتبر است (۴۲۲ خودکار)."""

    position_seconds: float = Field(ge=0)
    duration_seconds: float | None = Field(default=None, ge=0)


class VideoProgressOut(BaseModel):
    """موقعیت ذخیره‌شدهٔ کاربر جاری روی یک ویدیو.

    وقتی هنوز ردیفی نیست، position_seconds/duration_seconds/updated_at
    هر سه null برمی‌گردند (۲۰۰ — «پیشرفتی نیست» خطا نیست).
    """

    item_id: uuid.UUID
    position_seconds: float | None
    duration_seconds: float | None
    updated_at: datetime | None


class VideoSavedOut(BaseModel):
    """وضعیت نشانک «ذخیره» کاربر جاری روی یک ویدیو.

    برای مهمان (بدون توکن) همیشه saved=False برمی‌گردد (۲۰۰ — مهمان
    بودن خطا نیست؛ وب دکمه را به ورود هدایت می‌کند).
    """

    item_id: uuid.UUID
    saved: bool


class CandidateOut(BaseModel):
    """آیتم ویدیویی کتابخانه برای انتخاب‌گر CRM (همهٔ وضعیت‌های گردش‌کار)."""

    id: uuid.UUID
    kind: str
    title: LocalizedText
    workflow_status: str
    visibility: str
    duration_seconds: int | None
    created_at: datetime
