"""اسکیماهای ماژول تلگرام — فاز ۱۱."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ConnectRequest(BaseModel):
    phone: str = Field(..., min_length=5, max_length=20)


class ConfirmCodeRequest(BaseModel):
    phone: str = Field(..., min_length=5, max_length=20)
    code: str = Field(..., min_length=1, max_length=32)
    password: str | None = Field(default=None, max_length=256)


class ConnectStatus(BaseModel):
    connected: bool
    phone_masked: str | None = None


class ImportRequest(BaseModel):
    channel: str = Field(..., min_length=1, max_length=128)
    limit: int = Field(default=100, ge=1, le=5000)


class PolicyUpsert(BaseModel):
    policy: str = Field(default="never")
    message_template: dict | None = None
    target_channels: list[str] | None = None
    spacing_seconds: int | None = Field(default=None, ge=0)
    require_approval: bool | None = None
    schedule_config: dict | None = None
    is_enabled: bool | None = None


class PolicyOut(BaseModel):
    id: UUID
    content_type: str
    policy: str
    message_template: dict | None
    target_channels: list[str]
    spacing_seconds: int
    require_approval: bool
    schedule_config: dict | None
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PublishRequest(BaseModel):
    content_type: str = Field(..., min_length=1, max_length=64)
    content_id: str = Field(..., min_length=1, max_length=64)
    targets: list[str] | None = None
    idempotency_key: str | None = Field(default=None, max_length=128)


class PublishedOut(BaseModel):
    id: UUID
    source_content_type: str
    source_content_id: str
    distribution_target: str
    published_message_id: int | None
    idempotency_key: str
    status: str
    retry_count: int
    error: str | None
    created_at: datetime
    sent_at: datetime | None

    model_config = {"from_attributes": True}


class PublishedList(BaseModel):
    items: list[PublishedOut]
    total: int


class CallbackResult(BaseModel):
    content_type: str
    content_id: str
    op: str
    to: str
