"""اسکیماهای ماژول کاربران — Pydantic v2."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class MeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    locale: str | None = Field(default=None, max_length=8)
    avatar_media_id: uuid.UUID | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    locale: str
    is_active: bool
    is_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: uuid.UUID
    device_info: str | None
    ip: str | None
    last_active_at: datetime
    revoked: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ConsentOut(BaseModel):
    consent_type: str
    text_version: str
    accepted_at: datetime
    ip: str | None

    model_config = {"from_attributes": True}


class UsersPage(BaseModel):
    items: list[UserOut]
    next_cursor: str | None = None


class MessageOut(BaseModel):
    message: str
