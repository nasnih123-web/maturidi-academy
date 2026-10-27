"""روتر مقالات وردپرسی — آینهٔ روتر فهرست فتوا (فقط سیم‌کشی؛ منطق در service.py).

- عمومی: فهرست، دسته‌ها (قبل از /{slug} ثبت می‌شود)، متا (بدون شمارش
  بازدید)، جزئیات با slug (هر فراخوانی یک بازدید)، share.
- ادمین: فهرست، ساخت، ویرایش، تغییر وضعیت، CRUD دسته‌ها — با همان
  گیت‌های مجوز فتوا (knowledge.manage برای خواندن/نوشتن، fatwa.approve
  برای تغییر وضعیت).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import require_permission

from . import service
from .schemas import (
    ArticleCategoryOut,
    ArticleCreateIn,
    ArticleMetaOut,
    ArticleOut,
    ArticleStatusIn,
    ArticleUpdateIn,
    CategoryIn,
    PublicArticleCategoryOut,
    PublicArticleDetailOut,
    PublicArticleListOut,
    PublicArticleOut,
    PublicCategoryWithCountOut,
    ShareOut,
)

articles_router = APIRouter(prefix="/api/v1/articles", tags=["articles"])
admin_articles_router = APIRouter(prefix="/api/v1/admin/articles", tags=["admin-articles"])

_can_approve = require_permission("fatwa.approve")
_can_knowledge = require_permission("knowledge.manage")


def _public_article_out(d: dict) -> PublicArticleOut:
    cat = d.get("category")
    return PublicArticleOut(
        slug=d["slug"],
        title=d["title"],
        category=PublicArticleCategoryOut(**cat) if cat else None,
        author_name=d.get("author_name"),
        featured_image_url=d.get("featured_image_url"),
        published_at=d.get("published_at"),
        view_count=d.get("view_count") or 0,
        share_count=d.get("share_count") or 0,
    )


# --- عمومی ---


@articles_router.get("", response_model=PublicArticleListOut)
async def public_article_list(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=10, ge=1, le=100),
    q: str | None = Query(default=None),
    category: str | None = Query(default=None, description="slug دسته"),
    sort: str = Query(default="newest", pattern="^(newest|views)$"),
    exclude: str | None = Query(default=None, description="slug برای حذف از فهرست"),
    db: AsyncSession = Depends(get_db),
):
    """فهرست منتشرشده‌ها — بدون سقف کلی، همه با صفحه‌بندی در دسترس‌اند."""
    data = await service.article_public_list(
        db, page=page, per_page=per_page, q=q, category=category,
        sort=sort, exclude=exclude,
    )
    return PublicArticleListOut(
        items=[_public_article_out(d) for d in data["items"]],
        total=data["total"],
        page=data["page"],
        per_page=data["per_page"],
        pages=data["pages"],
    )


@articles_router.get("/categories", response_model=list[PublicCategoryWithCountOut])
async def public_article_categories(db: AsyncSession = Depends(get_db)):
    """دسته‌های مقاله + تعداد مقالات منتشرشدهٔ هر دسته.

    اگر مقالهٔ منتشرشدهٔ بدون دسته باشد، یک ردیف «بدون دسته» هم با
    همان تعداد در انتها می‌آید تا جمع تعدادها با total فهرست برابر شود.
    این روت قبل از /{slug} ثبت شده است تا «categories» به‌عنوان نامک
    مقاله خوانده نشود.
    """
    rows = await service.category_list_with_published_counts(db)
    out = [
        PublicCategoryWithCountOut(
            id=r["category"].id,
            slug=r["category"].slug,
            title=r["category"].title,
            created_at=r["category"].created_at,
            published_count=r["published_count"],
        )
        for r in rows
    ]
    uncategorized = await service.count_published_without_category(db)
    if uncategorized > 0:
        out.append(
            PublicCategoryWithCountOut(
                id=None,
                slug=service.UNCATEGORIZED_SLUG,
                title={
                    "fa": "بدون دسته",
                    "ar": "غير مصنّف",
                    "en": "Uncategorized",
                },
                created_at=None,
                published_count=uncategorized,
            )
        )
    return out


@articles_router.get("/{slug}/meta", response_model=ArticleMetaOut)
async def public_article_meta(slug: str, db: AsyncSession = Depends(get_db)):
    """متای یک مقالهٔ منتشرشده — بازدید نمی‌شمارد (فقط generateMetadata)."""
    data = await service.article_public_meta(db, slug)
    cat = data.get("category")
    return ArticleMetaOut(
        slug=data["slug"],
        title=data["title"],
        seo_title=data.get("seo_title"),
        seo_description=data.get("seo_description"),
        featured_image_url=data.get("featured_image_url"),
        category=PublicArticleCategoryOut(**cat) if cat else None,
    )


@articles_router.get("/{slug}", response_model=PublicArticleDetailOut)
async def public_article_detail(slug: str, db: AsyncSession = Depends(get_db)):
    """جزئیات یک مقالهٔ منتشرشده — هر فراخوانی یک بازدید می‌شمارد."""
    data = await service.article_public_get(db, slug)
    out = _public_article_out(data)
    return PublicArticleDetailOut(**out.model_dump(), body=data["body"])


@articles_router.post("/{slug}/share", response_model=ShareOut)
async def public_article_share(slug: str, db: AsyncSession = Depends(get_db)):
    """ثبت یک اشتراک‌گذاری — فقط منتشرشده؛ شمارندهٔ تازه برمی‌گردد."""
    a = await service.article_share(db, slug)
    return ShareOut(slug=a.slug, share_count=a.share_count or 0)


# --- ادمین ---


def _article_out(a) -> ArticleOut:
    return ArticleOut(
        id=a.id, title=a.title, body=a.body, slug=a.slug,
        seo_title=a.seo_title, seo_description=a.seo_description,
        workflow_status=a.workflow_status,
        category_id=a.category_id,
        author_name=a.author_name,
        featured_image_url=a.featured_image_url,
        view_count=a.view_count or 0,
        share_count=a.share_count or 0,
        published_at=a.published_at,
    )


@admin_articles_router.get("", response_model=dict)
async def article_admin_list(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
    q: str | None = Query(default=None),
    category: str | None = Query(default=None, description="slug دسته"),
    status: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    """فهرست ادمین — همهٔ وضعیت‌ها، با صفحه‌بندی و فیلترها."""
    data = await service.article_admin_list(
        db, page=page, per_page=per_page, q=q, category=category,
        status=status,
    )
    items = []
    for d in data["items"]:
        cat = d.get("category")
        items.append({
            **d,
            "category": PublicArticleCategoryOut(**cat).model_dump(mode="json") if cat else None,
        })
    return {
        "items": items,
        "total": data["total"],
        "page": data["page"],
        "per_page": data["per_page"],
        "pages": data["pages"],
    }


@admin_articles_router.post("", response_model=ArticleOut, status_code=201)
async def article_create(
    body: ArticleCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    a = await service.article_create(
        db, user, title=body.title, body=body.body, slug=body.slug,
        seo_title=body.seo_title, seo_description=body.seo_description,
        category_id=body.category_id, author_name=body.author_name,
        featured_image_url=body.featured_image_url,
    )
    return _article_out(a)


@admin_articles_router.put("/{article_id}", response_model=ArticleOut)
async def article_update(
    article_id: UUID,
    body: ArticleUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    """ویرایش مقاله — دقیقاً PUT، چون CRM از قبل PUT صدا می‌زند."""
    a = await service.article_update(
        db, user, article_id, title=body.title, body=body.body, slug=body.slug,
        seo_title=body.seo_title, seo_description=body.seo_description,
        category_id=body.category_id, author_name=body.author_name,
        featured_image_url=body.featured_image_url,
    )
    return _article_out(a)


@admin_articles_router.patch("/{article_id}/status", response_model=ArticleOut)
async def article_set_status(
    article_id: UUID,
    body: ArticleStatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_approve),
):
    a = await service.article_set_status(db, user, article_id, body.status)
    return _article_out(a)


# --- ادمین: دسته‌ها ---


def _category_out(c) -> ArticleCategoryOut:
    return ArticleCategoryOut(
        id=c.id, slug=c.slug, title=c.title, created_at=c.created_at
    )


@admin_articles_router.get("/categories", response_model=list[ArticleCategoryOut])
async def admin_category_list(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    return [_category_out(c) for c in await service.category_list(db)]


@admin_articles_router.post("/categories", response_model=ArticleCategoryOut, status_code=201)
async def admin_category_create(
    body: CategoryIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    c = await service.category_create(db, user, slug=body.slug, title=body.title)
    return _category_out(c)


@admin_articles_router.put("/categories/{category_id}", response_model=ArticleCategoryOut)
async def admin_category_update(
    category_id: UUID,
    body: CategoryIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    c = await service.category_update(
        db, user, category_id, slug=body.slug, title=body.title
    )
    return _category_out(c)


@admin_articles_router.delete("/categories/{category_id}", status_code=204)
async def admin_category_delete(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    await service.category_delete(db, user, category_id)
