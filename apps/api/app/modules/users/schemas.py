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


class DeviceRegisterIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    platform: str | None = Field(default=None, max_length=16)
    push_token: str | None = Field(default=None, max_length=512)


class DeviceRegisterOut(BaseModel):
    device_id: str
    platform: str | None = None
    registered: bool


class WebPushSubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1024)
    p256dh: str = Field(min_length=10, max_length=256)
    auth: str = Field(min_length=5, max_length=128)


class WebPushSubscribeOut(BaseModel):
    subscribed: bool


class WebPushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1024)


class VapidKeyOut(BaseModel):
    vapid_public_key: str | None = None
    configured: bool


class MyNotificationOut(BaseModel):
    id: uuid.UUID
    notif_type: str
    title: dict
    body: str | None = None
    data: dict | None = None
    read_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MyNotificationsPage(BaseModel):
    items: list[MyNotificationOut]
    unread_count: int
    next_cursor: str | None = None
