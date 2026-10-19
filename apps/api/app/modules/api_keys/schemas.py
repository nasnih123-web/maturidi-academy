"""اسکیماهای کلیدهای API — فاز ۱۱."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

WIDGET_SCOPES = ("prayer-times", "ayah-of-day", "latest-fatwa", "zakat-mini")


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    scopes: list[str] = Field(default_factory=list)
    rate_limit_per_min: int = Field(default=60, ge=1, le=10000)
    quota_monthly: int = Field(default=10000, ge=1, le=10000000)

    def model_post_init(self, __context) -> None:
        unknown = [s for s in self.scopes if s not in WIDGET_SCOPES and s != "*"]
        if unknown:
            raise ValueError(f"unknown scopes: {unknown}")


class ApiKeyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    scopes: list[str] | None = None
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=10000)
    quota_monthly: int | None = Field(default=None, ge=1, le=10000000)
    is_active: bool | None = None
    abuse_flag: bool | None = None

    def model_post_init(self, __context) -> None:
        if self.scopes is not None:
            unknown = [s for s in self.scopes if s not in WIDGET_SCOPES and s != "*"]
            if unknown:
                raise ValueError(f"unknown scopes: {unknown}")


class ApiKeyCreated(BaseModel):
    """پاسخ ساخت — `key` فقط همین یک‌بار دیده می‌شود (هش آن ذخیره شده)."""

    id: UUID
    name: str
    key: str
    key_prefix: str
    scopes: list[str]
    rate_limit_per_min: int
    quota_monthly: int


class ApiKeyOut(BaseModel):
    id: UUID
    name: str
    key_prefix: str
    scopes: list[str]
    rate_limit_per_min: int
    quota_monthly: int
    used_this_month: int
    quota_period: str
    is_active: bool
    abuse_flag: bool
    last_used_at: datetime | None
    created_at: datetime
    revoked_at: datetime | None

    model_config = {"from_attributes": True}


class ApiKeyUsage(BaseModel):
    id: UUID
    name: str
    key_prefix: str
    quota_period: str
    used_this_month: int
    quota_monthly: int
    quota_remaining: int
    rate_limit_per_min: int
    last_used_at: datetime | None
    is_active: bool
    abuse_flag: bool


class EmbedSnippet(BaseModel):
    widget: str
    html: str
    note: str
