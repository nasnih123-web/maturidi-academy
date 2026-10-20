"""اسکیماهای sync — فاز ۱۳ (ADR-0010).

همهٔ endpointها مدل صریح دارند (§۱۵.۷). reasonهای offline-pack «کد» هستند،
نه متن نمایشی (§۱۵.۴ — محلی‌سازی سمت کلاینت).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

EntityType = Literal["user_ayah_note", "user_progress", "dhikr_daily_count"]
OpType = Literal["upsert", "delete"]
OpStatus = Literal["pending", "applied", "conflicted", "rejected"]
Resolution = Literal["keep_local", "keep_remote", "merged"]
PackReason = Literal["started", "followed", "popular"]


class SyncOpIn(BaseModel):
    client_op_id: str = Field(min_length=1, max_length=128)
    entity_type: EntityType
    entity_id: str = Field(min_length=1, max_length=128)
    op_type: OpType
    payload: dict = Field(default_factory=dict)
    base_version: int = Field(default=0, ge=0)


class PushBatchIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    ops: list[SyncOpIn] = Field(min_length=1, max_length=100)


class OpResultOut(BaseModel):
    client_op_id: str
    status: OpStatus
    entity_type: str
    entity_id: str
    version: int | None = None
    conflict_id: UUID | None = None
    detail: str | None = None


class PushBatchOut(BaseModel):
    device_id: str
    results: list[OpResultOut]


class ChangeOut(BaseModel):
    seq: int
    entity_type: str
    entity_id: str
    op_type: str
    payload: dict | None = None
    version: int
    device_id: str | None = None
    created_at: datetime


class PullOut(BaseModel):
    device_id: str
    changes: list[ChangeOut]
    new_cursor: int


class CursorOut(BaseModel):
    device_id: str
    cursor_seq: int


class DeviceOut(BaseModel):
    user_id: UUID
    device_id: str
    cursor_seq: int
    updated_at: datetime | None = None
    platform: str | None = None


class DeviceListOut(BaseModel):
    items: list[DeviceOut]
    total: int


class ConflictOut(BaseModel):
    id: UUID
    entity_type: str
    entity_id: str
    local_payload: dict | None = None
    remote_payload: dict | None = None
    local_version: int | None = None
    remote_version: int | None = None
    resolution: str
    created_at: datetime
    resolved_at: datetime | None = None
    resolution_note: str | None = None


class ConflictListOut(BaseModel):
    items: list[ConflictOut]
    total: int


class ResolveConflictIn(BaseModel):
    resolution: Resolution
    merged_payload: dict | None = None
    note: str | None = Field(default=None, max_length=500)


class ResolveConflictOut(BaseModel):
    id: UUID
    resolution: str
    applied_version: int | None = None


class OfflinePackItem(BaseModel):
    kind: str  # lesson | library_item
    ref_id: str
    title: dict  # LocalizedText
    score: int
    reason: PackReason


class OfflinePackOut(BaseModel):
    items: list[OfflinePackItem]
    generated_at: datetime
