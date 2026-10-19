"""اسکیماهای Pydantic فاز ۹ (کتابخانهٔ چندرسانه‌ای DMS).

قرارداد §۱۵.۷ (type/schema صریح) و §۱۵.۴ (LocalizedText).
media_key خام هرگز در پاسخ‌ها برنمی‌گردد — فقط signed URL کوتاه‌مدت.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# LocalizedText: {"fa": ..., "ar": ..., "en": ...} — هرگز متن تک‌زبانهٔ هاردکد.
LocalizedText = dict[str, str]

ItemKind = Literal["video", "video_360", "pdf", "audio", "mindmap"]
Visibility = Literal["public", "registered", "scholars_only"]
WorkflowStatus = Literal["draft", "in_review", "approved", "published", "rejected", "archived"]
SourceType = Literal["upload", "telegram_import"]

# ابعاد مجاز ai_scopes (§۹.۵) — مشترک با فاز ۶.
AI_SCOPES: tuple[str, ...] = ("fatwa", "assistant", "quiz", "verification", "semantic_search")


class LibraryItemOut(BaseModel):
    id: uuid.UUID
    kind: str
    title: LocalizedText
    description: LocalizedText | None
    scholar_id: uuid.UUID | None
    topic_tags: list[str]
    related_lesson_id: uuid.UUID | None
    religious_place_ref: str | None
    visibility: str
    workflow_status: str
    version: int
    ai_scopes: list[str]
    include_in_fatwa_rag: bool
    ai_indexed: bool
    download_policy: dict | None
    transcript_status: str
    ocr_status: str
    has_transcript: bool
    duration_seconds: int | None
    file_size_bytes: int | None
    mime_type: str | None
    source_type: str
    source_ref: dict | None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None
    # signed URLهای کوتاه‌مدت — فقط وقتی فراخواننده مجاز به دسترسی است
    media_url: str | None = None
    cover_url: str | None = None


class CursorPage(BaseModel):
    items: list[LibraryItemOut]
    next_cursor: str | None = None


class SearchHitOut(BaseModel):
    item: LibraryItemOut
    score: float
    matched_in: list[str]  # e.g. ["title", "transcript"]


class SearchOut(BaseModel):
    query: str
    hits: list[SearchHitOut]


class LibraryItemMetaIn(BaseModel):
    """متادیتای JSON همراه آپلود multipart."""

    kind: ItemKind
    title: LocalizedText
    description: LocalizedText | None = None
    scholar_id: uuid.UUID | None = None
    topic_tags: list[str] = Field(default_factory=list)
    related_lesson_id: uuid.UUID | None = None
    religious_place_ref: str | None = None
    visibility: Visibility = "registered"
    ai_scopes: list[str] = Field(default_factory=list)
    include_in_fatwa_rag: bool = False
    download_policy: dict | None = None
    duration_seconds: int | None = None


class LibraryItemUpdateIn(BaseModel):
    """ویرایش متادیتا — همهٔ فیلدها اختیاری؛ نسخهٔ قبلی بایگانی می‌شود."""

    title: LocalizedText | None = None
    description: LocalizedText | None = None
    scholar_id: uuid.UUID | None = None
    topic_tags: list[str] | None = None
    related_lesson_id: uuid.UUID | None = None
    religious_place_ref: str | None = None
    visibility: Visibility | None = None
    ai_scopes: list[str] | None = None
    include_in_fatwa_rag: bool | None = None
    download_policy: dict | None = None
    duration_seconds: int | None = None
    note: str | None = Field(default=None, description="یادداشت نسخه‌بندی")


class TransitionIn(BaseModel):
    to: str = Field(description="وضعیت مقصد در ماشین مشترک §۹")
    note: str | None = Field(default=None, description="یادداشت بازبینی — در audit ثبت می‌شود")


class ReprocessIn(BaseModel):
    job: str = Field(description="transcribe یا ocr — صف‌بندی مجدد پردازش رسانه")


class VersionOut(BaseModel):
    version: int
    snapshot: dict
    created_by: uuid.UUID | None
    created_at: datetime
    note: str | None


class RevertIn(BaseModel):
    note: str | None = None


class ImportIn(BaseModel):
    """ایجاد برنامه‌ریزی‌شده (آمادهٔ تلگرام — فاز ۱۱): همیشه در in_review می‌نشیند."""

    kind: ItemKind
    title: LocalizedText
    description: LocalizedText | None = None
    scholar_id: uuid.UUID | None = None
    topic_tags: list[str] = Field(default_factory=list)
    visibility: Visibility = "registered"
    ai_scopes: list[str] = Field(default_factory=list)
    include_in_fatwa_rag: bool = False
    download_policy: dict | None = None
    duration_seconds: int | None = None
    file_size_bytes: int | None = None
    mime_type: str | None = None
    source_ref: dict = Field(description="ارجاع منبع تلگرام: chat_id/message_id/file_unique_id/...")
    note: str | None = None


class IndexAiOut(BaseModel):
    item_id: uuid.UUID
    ai_indexed: bool
    chunks_created: int
    chunks_approved: int
    chunk_ids: list[str]
    scopes: list[str]
    detail: str


class LibraryItemAdminOut(LibraryItemOut):
    """نمای مدیریتی — شامل متن transcript/OCR و خطای پردازش برای بازبینی CRM."""

    transcript: str | None = None
    ocr_text: str | None = None
    processing_error: str | None = None
