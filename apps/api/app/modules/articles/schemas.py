"""سکیماهای مقالات وردپرسی — آینهٔ سکیماهای فهرست فتوا + سئو و نامک."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# نامک: حروف یونیکد (از جمله فارسی) مجاز است؛ فاصله و «/» ممنوع است؛
# حداکثر ۲۰۰ نویسه. نرمال‌سازی (کوچک‌کردن + فاصله→خط‌تیره) سمت CRM
# موقع پر کردن خودکار انجام می‌شود؛ سرور فقط اعتبارسنجی می‌کند.
SLUG_PATTERN = r"^[^\s/]+$"


class ArticleCreateIn(BaseModel):
    title: dict
    body: dict
    slug: str = Field(min_length=1, max_length=200, pattern=SLUG_PATTERN)
    seo_title: str | None = Field(default=None, max_length=200)
    seo_description: str | None = Field(default=None, max_length=500)
    category_id: UUID | None = None
    author_name: str | None = Field(default=None, max_length=160)
    featured_image_url: str | None = Field(default=None, max_length=1024)


class ArticleUpdateIn(BaseModel):
    """ویرایش مقاله — دقیقاً همان فیلدهایی که CRM با PUT می‌فرستد."""

    title: dict
    body: dict
    slug: str = Field(min_length=1, max_length=200, pattern=SLUG_PATTERN)
    seo_title: str | None = Field(default=None, max_length=200)
    seo_description: str | None = Field(default=None, max_length=500)
    category_id: UUID | None = None
    author_name: str | None = Field(default=None, max_length=160)
    featured_image_url: str | None = Field(default=None, max_length=1024)


class ArticleOut(BaseModel):
    id: UUID
    title: dict
    body: dict
    slug: str
    seo_title: str | None = None
    seo_description: str | None = None
    workflow_status: str
    category_id: UUID | None = None
    author_name: str | None = None
    featured_image_url: str | None = None
    view_count: int = 0
    share_count: int = 0
    published_at: datetime | None = None


class ArticleStatusIn(BaseModel):
    status: Literal["draft", "in_review", "approved", "published", "rejected", "archived"]


class CategoryIn(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    title: dict


class ArticleCategoryOut(BaseModel):
    id: UUID
    slug: str
    title: dict
    created_at: datetime


class PublicCategoryWithCountOut(BaseModel):
    """ردیف دسته در فهرست عمومی؛ ردیف «بدون دسته» id ندارد."""

    id: UUID | None = None
    slug: str
    title: dict
    created_at: datetime | None = None
    published_count: int = 0


# --- public: فهرست وردپرسی مقالات (فقط منتشرشده‌ها) ---


class PublicArticleCategoryOut(BaseModel):
    slug: str
    title: dict


class PublicArticleOut(BaseModel):
    slug: str
    title: dict
    category: PublicArticleCategoryOut | None = None
    author_name: str | None = None
    featured_image_url: str | None = None
    published_at: datetime | None = None
    view_count: int = 0
    share_count: int = 0


class PublicArticleListOut(BaseModel):
    items: list[PublicArticleOut]
    total: int
    page: int
    per_page: int
    pages: int


class PublicArticleDetailOut(PublicArticleOut):
    body: dict


class ArticleMetaOut(BaseModel):
    """متای عمومی برای generateMetadata — هرگز بازدید نمی‌شمارد."""

    slug: str
    title: dict
    seo_title: str | None = None
    seo_description: str | None = None
    featured_image_url: str | None = None
    category: PublicArticleCategoryOut | None = None


class ShareOut(BaseModel):
    slug: str
    share_count: int
