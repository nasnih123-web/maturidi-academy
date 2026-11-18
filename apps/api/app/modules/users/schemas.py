"""اسکیماهای ماژول کاربران — Pydantic v2."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class MeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    locale: str | None = Field(default=None, max_length=8)
    avatar_media_id: uuid.UUID | None = None
    # فاز B (تکمیل): اعتبارسنجی معنایی (بازهٔ تاریخ تولد، مجموعهٔ جنسیت،
    # اعتبار/سازگاری کشور با شمارهٔ تأییدشده) در لایهٔ سرویس است — مثل
    # چک FK عکس پروفایل — تا خطاها 422 یک‌دست با کد validation_error باشند.
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=16)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    # شمارهٔ تلفن از پروفایل قابل ثبت/ویرایش است (قبلاً فقط‌خواندنی بود و
    # حسابی که از مسیر ایمیل ساخته شده بود هیچ راهی برای ثبت شماره
    # نداشت). نرمال‌سازی E.164، یکتایی و سازگاری با کشور در لایهٔ سرویس.
    phone: str | None = Field(default=None, max_length=32)


class UserOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    locale: str
    is_active: bool
    is_verified: bool
    created_at: datetime
    # نقش‌ها و مجوزهای واقعی از جدول‌های RBAC (قرارداد §۲ — فاز ۲):
    # لایهٔ سرویس آن‌ها را پر می‌کند تا گیتینگ UI روی دادهٔ واقعی باشد،
    # نه stub permissive. اعتبارسنجی مستقیم از ORM (بدون سرویس) خالی می‌ماند.
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    # --- فاز B: تکمیل پروفایل + گیتینگ بخش‌ها. avatar_media_id و سه
    # فیلد هویتی از خود ORM می‌آیند (ستون‌های users)؛ سه فیلد بعدی را
    # لایهٔ سرویس پر می‌کند (محاسبه از روی فیلدهای کاربر + پرچم‌های
    # platform_settings).
    avatar_media_id: uuid.UUID | None = None
    date_of_birth: date | None = None
    gender: str | None = None
    country_code: str | None = None
    profile_complete: bool = False
    missing_profile_fields: list[str] = Field(default_factory=list)
    # بخش‌هایی که همین حالا برای این کاربر نیازمند پروفایل کامل‌اند
    # (زیرمجموعه‌ای از {"fatwa_question", "hifz_advanced"}).
    profile_required_sections: list[str] = Field(default_factory=list)

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
