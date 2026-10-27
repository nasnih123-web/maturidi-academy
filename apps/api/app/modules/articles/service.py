"""سرویس مقالات وردپرسی — آینهٔ سرویس فهرست فتوا (موضوع‌ها).

همهٔ منطق کسب‌وکار اینجاست؛ روترها فقط سیم‌کشی‌اند. گردش‌کار
وضعیت از ماشین مشترک app.core.workflow می‌آید (بدون جهش؛ گذار
نامعتبر ۴۲۲ می‌دهد).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import String as sa_String
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow as _workflow
from app.core.errors import APIError
from app.models.models import Article, ArticleCategory, User

# ---------------------------------------------------------------------------
# admin: مقاله‌ها
# ---------------------------------------------------------------------------


async def _get_category_or_404(db: AsyncSession, category_id: UUID) -> ArticleCategory:
    cat = await db.get(ArticleCategory, category_id)
    if cat is None:
        raise APIError(404, "category_not_found", "دسته یافت نشد")
    return cat


async def _get_article_or_404(db: AsyncSession, article_id: UUID) -> Article:
    art = await db.get(Article, article_id)
    if art is None:
        raise APIError(404, "article_not_found", "مقاله یافت نشد")
    return art


async def _get_article_by_slug_or_404(db: AsyncSession, slug: str) -> Article:
    art = (
        await db.execute(select(Article).where(Article.slug == slug))
    ).scalar_one_or_none()
    if art is None:
        raise APIError(404, "article_not_found", "مقاله یافت نشد")
    return art


async def _check_slug_free(
    db: AsyncSession, slug: str, exclude_id: UUID | None = None
) -> None:
    stmt = select(Article).where(Article.slug == slug)
    if exclude_id is not None:
        stmt = stmt.where(Article.id != exclude_id)
    dup = (await db.execute(stmt)).scalar_one_or_none()
    if dup is not None:
        raise APIError(409, "article_slug_exists", "مقاله‌ای با این نامک هست")


async def article_create(
    db: AsyncSession, user: User, *, title: dict, body: dict, slug: str,
    seo_title: str | None = None, seo_description: str | None = None,
    category_id: UUID | None = None,
    author_name: str | None = None,
    featured_image_url: str | None = None,
) -> Article:
    if category_id is not None:
        await _get_category_or_404(db, category_id)
    await _check_slug_free(db, slug)
    art = Article(
        title=title, body=body, slug=slug, seo_title=seo_title,
        seo_description=seo_description, workflow_status="draft",
        category_id=category_id, author_name=author_name,
        featured_image_url=featured_image_url,
    )
    db.add(art)
    await db.flush()
    await db.commit()
    return art


async def article_update(
    db: AsyncSession, user: User, article_id: UUID, *, title: dict, body: dict,
    slug: str, seo_title: str | None, seo_description: str | None,
    category_id: UUID | None, author_name: str | None,
    featured_image_url: str | None,
) -> Article:
    art = await _get_article_or_404(db, article_id)
    if category_id is not None:
        await _get_category_or_404(db, category_id)
    await _check_slug_free(db, slug, exclude_id=art.id)
    art.title = title
    art.body = body
    art.slug = slug
    art.seo_title = seo_title
    art.seo_description = seo_description
    art.category_id = category_id
    art.author_name = author_name
    art.featured_image_url = featured_image_url
    await db.flush()
    await db.commit()
    return art


async def article_set_status(
    db: AsyncSession, user: User, article_id: UUID, target: str
) -> Article:
    art = await _get_article_or_404(db, article_id)
    _workflow.validate_transition(art.workflow_status, target)
    art.workflow_status = target
    if target == "published":
        # تاریخ انتشار موقع ورود به published ثبت می‌شود و با بایگانی
        # پاک نمی‌شود (نمایش دو تقویمی شمسی/قمری روی سایت از همین زمان است).
        art.published_at = datetime.now(UTC)
    await db.flush()
    await db.commit()
    return art


# ---------------------------------------------------------------------------
# admin: دسته‌ها
# ---------------------------------------------------------------------------


async def category_create(
    db: AsyncSession, user: User, *, slug: str, title: dict
) -> ArticleCategory:
    dup = (
        await db.execute(
            select(ArticleCategory).where(ArticleCategory.slug == slug)
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise APIError(409, "category_slug_exists", "دسته‌ای با این slug هست")
    cat = ArticleCategory(slug=slug, title=title)
    db.add(cat)
    await db.flush()
    await db.commit()
    return cat


async def category_update(
    db: AsyncSession, user: User, category_id: UUID, *, slug: str, title: dict
) -> ArticleCategory:
    cat = await _get_category_or_404(db, category_id)
    if slug != cat.slug:
        dup = (
            await db.execute(
                select(ArticleCategory).where(ArticleCategory.slug == slug)
            )
        ).scalar_one_or_none()
        if dup is not None:
            raise APIError(409, "category_slug_exists", "دسته‌ای با این slug هست")
    cat.slug = slug
    cat.title = title
    await db.flush()
    await db.commit()
    return cat


async def category_delete(db: AsyncSession, user: User, category_id: UUID) -> None:
    cat = await _get_category_or_404(db, category_id)
    used = (
        await db.execute(
            select(func.count())
            .select_from(Article)
            .where(Article.category_id == category_id)
        )
    ).scalar_one()
    if used:
        raise APIError(
            409, "category_in_use",
            "این دسته روی مقاله‌هایی استفاده شده است؛ اول دستهٔ آن‌ها را عوض کنید",
        )
    await db.delete(cat)
    await db.commit()


async def category_list(db: AsyncSession) -> list[ArticleCategory]:
    rows = (
        await db.execute(
            select(ArticleCategory).order_by(ArticleCategory.slug)
        )
    ).scalars().all()
    return list(rows)


# مقدار ویژهٔ فیلتر دسته برای مقالات منتشرشدهٔ بدون دسته. با slug
# واقعی برخورد ندارد: الگوی CategoryIn حرف اول را [a-z0-9] می‌خواهد
# و «__none» با underscore شروع می‌شود، پس هرگز نمی‌تواند ساخته شود.
UNCATEGORIZED_SLUG = "__none"


async def category_list_with_published_counts(
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """هر دسته + تعداد مقالات منتشرشدهٔ آن دسته (دستهٔ خالی هم با ۰ می‌آید)."""
    counts = dict(
        (
            await db.execute(
                select(Article.category_id, func.count())
                .where(
                    Article.workflow_status == "published",
                    Article.category_id.is_not(None),
                )
                .group_by(Article.category_id)
            )
        ).all()
    )
    cats = await category_list(db)
    return [
        {"category": c, "published_count": counts.get(c.id, 0)} for c in cats
    ]


async def count_published_without_category(db: AsyncSession) -> int:
    """تعداد مقالات منتشرشدهٔ بدون دسته (category_id خالی)."""
    return (
        await db.execute(
            select(func.count())
            .select_from(Article)
            .where(
                Article.workflow_status == "published",
                Article.category_id.is_(None),
            )
        )
    ).scalar_one()


def _category_dict(cat: ArticleCategory | None) -> dict | None:
    if cat is None:
        return None
    return {"slug": cat.slug, "title": cat.title}


async def _load_categories(
    db: AsyncSession, articles: list[Article]
) -> dict[UUID, ArticleCategory]:
    ids = {a.category_id for a in articles if a.category_id is not None}
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(ArticleCategory).where(ArticleCategory.id.in_(ids))
        )
    ).scalars().all()
    return {c.id: c for c in rows}


def _public_article_dict(
    article: Article, cats: dict[UUID, ArticleCategory]
) -> dict[str, Any]:
    cat = cats.get(article.category_id) if article.category_id else None
    return {
        "slug": article.slug,
        "title": article.title,
        "category": _category_dict(cat),
        "author_name": article.author_name,
        "featured_image_url": article.featured_image_url,
        "published_at": article.published_at,
        "view_count": article.view_count or 0,
        "share_count": article.share_count or 0,
    }


def _apply_article_filters(
    stmt, *, q: str | None, category_slug: str | None,
    status: str | None, exclude: str | None,
):
    """فیلترهای مشترک فهرست عمومی و ادمین (روی متن JSON عنوان/بدنه)."""
    if q:
        needle = f"%{q}%"
        stmt = stmt.where(
            (func.cast(Article.title, sa_String).ilike(needle))
            | (func.cast(Article.body, sa_String).ilike(needle))
        )
    if category_slug:
        if category_slug == UNCATEGORIZED_SLUG:
            # فقط منتشرشده‌های بدون دسته؛ در فهرست عمومی و ادمین یکسان است.
            stmt = stmt.where(Article.category_id.is_(None))
        else:
            stmt = stmt.where(
                Article.category_id.in_(
                    select(ArticleCategory.id).where(ArticleCategory.slug == category_slug)
                )
            )
    if status:
        stmt = stmt.where(Article.workflow_status == status)
    if exclude is not None:
        stmt = stmt.where(Article.slug != exclude)
    return stmt


async def article_public_list(
    db: AsyncSession, *, page: int, per_page: int, q: str | None,
    category: str | None, sort: str, exclude: str | None,
) -> dict[str, Any]:
    """فهرست عمومی — فقط منتشرشده‌ها؛ بدون سقف کلی، با صفحه‌بندی."""
    stmt = select(Article).where(Article.workflow_status == "published")
    stmt = _apply_article_filters(
        stmt, q=q, category_slug=category, status=None, exclude=exclude
    )
    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    if sort == "views":
        stmt = stmt.order_by(
            Article.view_count.desc(),
            Article.published_at.desc().nulls_last(),
        )
    else:
        stmt = stmt.order_by(
            Article.published_at.desc().nulls_last(),
            Article.created_at.desc(),
        )
    stmt = stmt.offset((page - 1) * per_page).limit(per_page)
    articles = (await db.execute(stmt)).scalars().all()
    cats = await _load_categories(db, list(articles))
    pages = (total + per_page - 1) // per_page if total else 0
    return {
        "items": [_public_article_dict(a, cats) for a in articles],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


async def article_public_get(db: AsyncSession, slug: str) -> dict[str, Any]:
    """جزئیات عمومی — فقط منتشرشده؛ هر فراخوانی یک بازدید می‌شمارد."""
    art = await _get_article_by_slug_or_404(db, slug)
    if art.workflow_status != "published":
        raise APIError(404, "article_not_found", "مقاله یافت نشد")
    art.view_count = (art.view_count or 0) + 1
    await db.flush()
    await db.commit()
    cats = await _load_categories(db, [art])
    out = _public_article_dict(art, cats)
    out["body"] = art.body
    return out


async def article_public_meta(db: AsyncSession, slug: str) -> dict[str, Any]:
    """متای عمومی — فقط منتشرشده؛ بازدید نمی‌شمارد.

    فقط برای generateMetadata وب است تا فراخوانی متا بازدید را
    دو برابر نکند؛ جزئیات کامل را article_public_get می‌دهد.
    """
    art = await _get_article_by_slug_or_404(db, slug)
    if art.workflow_status != "published":
        raise APIError(404, "article_not_found", "مقاله یافت نشد")
    cats = await _load_categories(db, [art])
    return {
        "slug": art.slug,
        "title": art.title,
        "seo_title": art.seo_title,
        "seo_description": art.seo_description,
        "featured_image_url": art.featured_image_url,
        "category": _category_dict(cats.get(art.category_id) if art.category_id else None),
    }


async def article_share(db: AsyncSession, slug: str) -> Article:
    """ثبت یک اشتراک‌گذاری — فقط منتشرشده؛ شمارندهٔ تازه برمی‌گردد."""
    art = await _get_article_by_slug_or_404(db, slug)
    if art.workflow_status != "published":
        raise APIError(404, "article_not_found", "مقاله یافت نشد")
    art.share_count = (art.share_count or 0) + 1
    await db.flush()
    await db.commit()
    return art


async def article_admin_list(
    db: AsyncSession, *, page: int, per_page: int, q: str | None,
    category: str | None, status: str | None,
) -> dict[str, Any]:
    """فهرست ادمین — همهٔ وضعیت‌ها، با صفحه‌بندی و فیلترها."""
    stmt = select(Article)
    stmt = _apply_article_filters(
        stmt, q=q, category_slug=category, status=status, exclude=None
    )
    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    stmt = stmt.order_by(Article.created_at.desc())
    stmt = stmt.offset((page - 1) * per_page).limit(per_page)
    articles = (await db.execute(stmt)).scalars().all()
    cats = await _load_categories(db, list(articles))
    pages = (total + per_page - 1) // per_page if total else 0
    return {
        "items": [
            {**_public_article_dict(a, cats), "id": str(a.id),
             "body": a.body, "seo_title": a.seo_title,
             "seo_description": a.seo_description,
             "workflow_status": a.workflow_status}
            for a in articles
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }
