"""اسکیماهای ادمین — تنظیمات پلتفرم و dead-letter رویدادها (فاز ۲)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SettingItem(BaseModel):
    key: str
    value: Any | None = None  # کلیدهای حساس همیشه "***" برمی‌گردند (masked=True)
    masked: bool = False
    type: str = "string"  # secret | string | localized | uuid
    updated_at: datetime | None = None


class SettingsOut(BaseModel):
    settings: list[SettingItem]
    version: int = Field(description="شمارندهٔ نسخهٔ hot-reload — با هر به‌روزرسانی بالا می‌رود")


class SettingsUpdate(BaseModel):
    settings: dict[str, Any] = Field(
        description="کلید → مقدار جدید؛ برای کلید حساس، مقدار \"***\" یعنی بدون تغییر"
    )


class SettingsUpdateOut(BaseModel):
    updated: list[str]
    version: int


class DeadLetterEventOut(BaseModel):
    event_id: str
    event_type: str
    aggregate_type: str
    aggregate_id: str
    payload: dict
    schema_version: int
    created_at: datetime
    retry_count: int
    failed_at: datetime | None


class DeadLetterPage(BaseModel):
    events: list[DeadLetterEventOut]
    total: int


class FontOut(BaseModel):
    """نتیجهٔ آپلود/حذف فونت — url مسیر static سرو‌شده است (null = فونت داخلی)."""

    locale: str
    family: str | None = None
    url: str | None = None
    version: int = Field(description="نسخهٔ hot-reload تنظیمات بعد از این عملیات")


class MessageOut(BaseModel):
    message: str
