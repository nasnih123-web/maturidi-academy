"""اسکیماهای Pydantic v2 ماژول CMS — فاز ۴.

شکل پاسخ‌ها frozen است و فرانت‌اندها (web / CRM) دقیقاً روی همین شکل کد می‌زنند.
LocalizedText از اسکیمای خانه بازاستفاده می‌شود — تعریف تکراری ممنوع (§۱۵.۲).

قرارداد JSON هر منبع در انتهای گزارش فاز ثبت شده است (track siblingها همان را می‌بینند).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.home.schemas import LocalizedText


class ItemsOut(BaseModel):
    """الگوی صفحه‌بندی موجود روتر content (§۱۵.۲: تکرار نکن)."""

    items: list[dict[str, Any]]
    total: int


class DistributionIn(BaseModel):
    """تاگل‌های مستقل هر surface (§۹.۵). پیش‌فرض هنگام انتشار: فقط web=true."""

    web: bool = False
    mobile: bool = False
    desktop: bool = False
    telegram: bool = False
    ai_knowledge: bool = False


class TransitionIn(BaseModel):
    to: str = Field(description="وضعیت مقصد طبق ماشین §۹")


# ---------------------------------------------------------------------------
# islamic_events
# ---------------------------------------------------------------------------


class IslamicEventCreate(BaseModel):
    name: LocalizedText
    hijri_month: int = Field(ge=1, le=12)
    hijri_day: int = Field(ge=1, le=30)
    recurring: bool = True
    theme_id: uuid.UUID | None = None
    auto_publish: bool = False
    needs_admin_confirmation: bool = True
    image_url: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    distribution: DistributionIn | None = None


class IslamicEventUpdate(BaseModel):
    name: LocalizedText | None = None
    hijri_month: int | None = Field(default=None, ge=1, le=12)
    hijri_day: int | None = Field(default=None, ge=1, le=30)
    recurring: bool | None = None
    theme_id: uuid.UUID | None = None
    auto_publish: bool | None = None
    needs_admin_confirmation: bool | None = None
    image_url: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    distribution: DistributionIn | None = None


# ---------------------------------------------------------------------------
# scholar_quotes
# ---------------------------------------------------------------------------


class ScholarQuoteCreate(BaseModel):
    text: LocalizedText
    scholar: LocalizedText
    source: str | None = None
    quote_date: date | None = None
    avatar_url: str | None = None
    placements: list[str] = Field(default_factory=list)
    distribution: DistributionIn | None = None


class ScholarQuoteUpdate(BaseModel):
    text: LocalizedText | None = None
    scholar: LocalizedText | None = None
    source: str | None = None
    quote_date: date | None = None
    avatar_url: str | None = None
    placements: list[str] | None = None
    distribution: DistributionIn | None = None


# ---------------------------------------------------------------------------
# pages
# ---------------------------------------------------------------------------

PAGE_TYPES = ("page", "article", "faq")


class PageCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: LocalizedText
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    seo_meta: dict[str, Any] = Field(default_factory=dict)
    content_type: Literal["page", "article", "faq"] = "page"
    distribution: DistributionIn | None = None


class PageUpdate(BaseModel):
    title: LocalizedText | None = None
    blocks: list[dict[str, Any]] | None = None
    seo_meta: dict[str, Any] | None = None
    content_type: Literal["page", "article", "faq"] | None = None
    distribution: DistributionIn | None = None


# ---------------------------------------------------------------------------
# nav_items
# ---------------------------------------------------------------------------


class NavItemCreate(BaseModel):
    label: LocalizedText
    parent_id: uuid.UUID | None = None
    sort_order: int = 0
    visible: bool = True
    locale: Literal["fa", "ar", "en"] | None = None
    link_type: Literal["internal", "external"] = "internal"
    url: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class NavItemUpdate(BaseModel):
    label: LocalizedText | None = None
    parent_id: uuid.UUID | None = None
    sort_order: int | None = None
    visible: bool | None = None
    locale: Literal["fa", "ar", "en"] | None = None
    link_type: Literal["internal", "external"] | None = None
    url: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class NavItemOut(BaseModel):
    id: uuid.UUID
    label: LocalizedText
    parent_id: uuid.UUID | None
    sort_order: int
    visible: bool
    locale: str | None
    link_type: str
    url: str
    starts_at: datetime | None
    ends_at: datetime | None
    created_at: datetime
    updated_at: datetime
    children: list[NavItemOut] = Field(default_factory=list)


NavItemOut.model_rebuild()


# ---------------------------------------------------------------------------
# banners
# ---------------------------------------------------------------------------


class BannerCreate(BaseModel):
    title: LocalizedText
    subtitle: LocalizedText | None = None
    media: dict[str, Any] = Field(default_factory=dict)
    cta: dict[str, Any] | None = None
    placement: str = "homepage"
    priority: int = 0
    audience: dict[str, Any] = Field(default_factory=dict)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    distribution: DistributionIn | None = None


class BannerUpdate(BaseModel):
    title: LocalizedText | None = None
    subtitle: LocalizedText | None = None
    media: dict[str, Any] | None = None
    cta: dict[str, Any] | None = None
    placement: str | None = None
    priority: int | None = None
    audience: dict[str, Any] | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    distribution: DistributionIn | None = None


# ---------------------------------------------------------------------------
# announcements
# ---------------------------------------------------------------------------


class AnnouncementCreate(BaseModel):
    message: LocalizedText
    dismissible: bool = True
    audience: dict[str, Any] = Field(default_factory=dict)
    placement: str = "global"
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    distribution: DistributionIn | None = None


class AnnouncementUpdate(BaseModel):
    message: LocalizedText | None = None
    dismissible: bool | None = None
    audience: dict[str, Any] | None = None
    placement: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    distribution: DistributionIn | None = None
