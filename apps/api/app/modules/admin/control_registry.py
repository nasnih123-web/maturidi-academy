"""رجیستری adapterهای محتوای دامنه‌ها — فاز ۱۴ (ADR-0011، §۹.۵).

اصل ضد-جدول-غول‌پیکر: هیچ جدول generic content ساخته نمی‌شود. هر adapter یک
زوج (domain, content_type) را با چهار تابع typed می‌پوشاند:

- list:    فهرست آیتم‌ها با فیلترهای صندوق واحد
- get:     جزئیات یک آیتم
- transition: گذار گردش‌کار — همان تابع transition خودِ ماژول دامنه
  (هیچ منطق دامنه‌ای این‌جا تکرار نمی‌شود)
- native_distribution: نگاشت distribution بومی دامنه (ستون JSONB) اگر دارد

آیتم یکپارچه (UnifiedItem):
    domain, content_type, id, title, excerpt, status, author_id,
    visibility, ai_scopes, version, created_at, updated_at, published_at
"""
from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import Text, cast, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import (
    Announcement,
    Banner,
    Course,
    FatwaSubmission,
    FiqhKnowledgeChunk,
    IslamicEvent,
    LibraryItem,
    Page,
    ReligiousPlace,
    ScholarQuote,
    SocialPost,
    User,
)

# ---------------------------------------------------------------------------
# ابزارهای مشترک
# ---------------------------------------------------------------------------


def _lt_text(value: Any) -> str:
    """استخراج متن از LocalizedText {"fa","ar","en"} — بهترین تلاش."""
    if isinstance(value, dict):
        for loc in ("fa", "ar", "en"):
            v = value.get(loc)
            if v:
                return str(v)
        for v in value.values():
            if v:
                return str(v)
    return str(value or "")


def _like(column: Any, query: str) -> Any:
    """ILIKE امن روی ستون (از جمله JSONB با cast به Text).

    نکتهٔ دیالکتی: SQLAlchemy ستون JSON را در SQLite با ensure_ascii=True ذخیره
    می‌کند (نویسه‌های غیرASCII به‌صورت \\uXXXX) ولی در PostgreSQL یونیکد واقعی.
    پس هم فرم خام و هم فرم ASCII-escape جست‌وجو می‌شود تا روی هر دو جواب دهد.
    """
    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    raw = _esc(query)
    ascii_form = _esc(query.encode("unicode_escape").decode("ascii"))
    conds = [cast(column, Text).ilike(f"%{raw}%", escape="\\")]
    if ascii_form != raw:
        conds.append(cast(column, Text).ilike(f"%{ascii_form}%", escape="\\"))
    return or_(*conds)


def _uuid_or_none(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return None


@dataclass
class ListFilters:
    q: str | None = None
    status: str | None = None
    author_id: str | None = None
    visibility: str | None = None
    ai_scope: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    cursor_ts: datetime | None = None  # فقط آیتم‌های با created_at <= این (صفحه‌بندی)
    limit: int = 50


@dataclass
class ContentAdapter:
    domain: str
    content_type: str
    label: str  # برچسب فارسی برای CRM
    audit_entity_type: str
    list_fn: Callable[[AsyncSession, ListFilters], Any]
    get_fn: Callable[[AsyncSession, str], Any]
    transition_fn: Callable[..., Any] | None = None
    native_distribution_fn: Callable[[Any], dict | None] | None = None
    extra: dict = field(default_factory=dict)


_REGISTRY: dict[tuple[str, str], ContentAdapter] = {}


def register(adapter: ContentAdapter) -> ContentAdapter:
    _REGISTRY[(adapter.domain, adapter.content_type)] = adapter
    return adapter


def get_adapter(domain: str, content_type: str) -> ContentAdapter:
    try:
        return _REGISTRY[(domain, content_type)]
    except KeyError:
        raise APIError(404, "adapter_not_found",
                       f"آداپتر محتوا یافت نشد: {domain}/{content_type}")


def list_adapters(
    *, domain: str | None = None, content_type: str | None = None
) -> list[ContentAdapter]:
    out = [
        a for (d, ct), a in sorted(_REGISTRY.items())
        if (domain is None or d == domain)
        and (content_type is None or ct == content_type)
    ]
    return out


# ---------------------------------------------------------------------------
# آداپترهای دامنهٔ content (منابع CMS فاز ۴)
# ---------------------------------------------------------------------------


def _cms_item(domain: str, content_type: str, obj: Any, title: str, excerpt: str = "") -> dict:
    return {
        "domain": domain,
        "content_type": content_type,
        "id": str(obj.id),
        "title": title,
        "excerpt": excerpt,
        "status": obj.workflow_status,
        "author_id": str(obj.created_by) if obj.created_by else None,
        "visibility": None,
        "ai_scopes": [],
        "version": obj.version,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
        "published_at": getattr(obj, "published_at", None),
    }


def _cms_filters(stmt: Any, model: Any, f: ListFilters, title_col: Any) -> Any:
    if f.q:
        stmt = stmt.where(_like(title_col, f.q))
    if f.status:
        stmt = stmt.where(model.workflow_status == f.status)
    if f.author_id:
        au = _uuid_or_none(f.author_id)
        stmt = stmt.where(model.created_by == au) if au else stmt.where(false())
    if f.date_from:
        stmt = stmt.where(model.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(model.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(model.created_at <= f.cursor_ts)
    return stmt


async def _list_cms(db: AsyncSession, model: Any, f: ListFilters,
                    title_col: Any, content_type: str) -> list[dict]:
    stmt = _cms_filters(select(model), model, f, title_col)
    stmt = stmt.order_by(model.created_at.desc(), model.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        _cms_item("content", content_type, o, _lt_text(getattr(o, _title_attr(content_type))))
        for o in rows
    ]


def _title_attr(content_type: str) -> str:
    return {
        "islamic_event": "name",
        "scholar_quote": "text",
        "page": "title",
        "banner": "title",
        "announcement": "message",
    }[content_type]


async def _cms_list_events(db: AsyncSession, f: ListFilters) -> list[dict]:
    return await _list_cms(db, IslamicEvent, f, IslamicEvent.name, "islamic_event")


async def _cms_list_quotes(db: AsyncSession, f: ListFilters) -> list[dict]:
    return await _list_cms(db, ScholarQuote, f, ScholarQuote.text, "scholar_quote")


async def _cms_list_pages(db: AsyncSession, f: ListFilters) -> list[dict]:
    return await _list_cms(db, Page, f, Page.title, "page")


async def _cms_list_banners(db: AsyncSession, f: ListFilters) -> list[dict]:
    return await _list_cms(db, Banner, f, Banner.title, "banner")


async def _cms_list_announcements(db: AsyncSession, f: ListFilters) -> list[dict]:
    return await _list_cms(db, Announcement, f, Announcement.message, "announcement")


async def _cms_get(db: AsyncSession, model: Any, item_id: str) -> Any | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    return await db.get(model, uid)


def _cms_native_distribution(obj: Any) -> dict | None:
    return obj.distribution if isinstance(getattr(obj, "distribution", None), dict) else None


def _make_cms_adapter(content_type: str, model: Any, label: str,
                      audit_entity_type: str,
                      list_fn: Callable, resource: str) -> ContentAdapter:
    async def _get(db: AsyncSession, item_id: str) -> dict | None:
        obj = await _cms_get(db, model, item_id)
        if obj is None:
            return None
        item = _cms_item("content", content_type, obj,
                         _lt_text(getattr(obj, _title_attr(content_type))))
        item["raw"] = obj
        return item

    async def _transition(db: AsyncSession, item_id: str, to: str, actor: User) -> dict:
        from app.modules.content import cms_service

        return await cms_service.transition_item(
            db, resource, item_id, to, actor_id=actor.id
        )

    return ContentAdapter(
        domain="content",
        content_type=content_type,
        label=label,
        audit_entity_type=audit_entity_type,
        list_fn=list_fn,
        get_fn=_get,
        transition_fn=_transition,
        native_distribution_fn=_cms_native_distribution,
    )


register(_make_cms_adapter("islamic_event", IslamicEvent, "رویداد اسلامی",
                           "islamic_event", _cms_list_events, "events"))
register(_make_cms_adapter("scholar_quote", ScholarQuote, "نقل‌قول علما",
                           "scholar_quote", _cms_list_quotes, "quotes"))
register(_make_cms_adapter("page", Page, "صفحه", "page", _cms_list_pages, "pages"))
register(_make_cms_adapter("banner", Banner, "بنر", "banner", _cms_list_banners, "banners"))
register(_make_cms_adapter("announcement", Announcement, "اعلان",
                           "announcement", _cms_list_announcements, "announcements"))


# ---------------------------------------------------------------------------
# آداپتر fatwa — submissions + knowledge chunks
# ---------------------------------------------------------------------------


async def _list_fatwa_submissions(db: AsyncSession, f: ListFilters) -> list[dict]:
    stmt = select(FatwaSubmission)
    if f.q:
        stmt = stmt.where(or_(_like(FatwaSubmission.title, f.q),
                              _like(FatwaSubmission.body, f.q)))
    if f.status:
        stmt = stmt.where(FatwaSubmission.workflow_status == f.status)
    if f.author_id:
        au = _uuid_or_none(f.author_id)
        stmt = stmt.where(FatwaSubmission.author_id == au) if au else stmt.where(false())
    if f.date_from:
        stmt = stmt.where(FatwaSubmission.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(FatwaSubmission.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(FatwaSubmission.created_at <= f.cursor_ts)
    stmt = stmt.order_by(FatwaSubmission.created_at.desc(),
                         FatwaSubmission.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "domain": "fatwa", "content_type": "fatwa_submission", "id": str(o.id),
        "title": _lt_text(o.title), "excerpt": (o.body or "")[:300],
        "status": o.workflow_status, "author_id": str(o.author_id),
        "visibility": None, "ai_scopes": [], "version": o.version,
        "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": o.published_at,
    } for o in rows]


async def _get_fatwa_submission(db: AsyncSession, item_id: str) -> dict | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    o = await db.get(FatwaSubmission, uid)
    if o is None:
        return None
    return {
        "domain": "fatwa", "content_type": "fatwa_submission", "id": str(o.id),
        "title": _lt_text(o.title), "excerpt": (o.body or "")[:500],
        "status": o.workflow_status, "author_id": str(o.author_id),
        "visibility": None, "ai_scopes": [], "version": o.version,
        "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": o.published_at, "raw": o,
    }


async def _transition_fatwa_submission(db: AsyncSession, item_id: str,
                                       to: str, actor: User) -> dict:
    from app.modules.fatwa import submissions_service

    uid = _uuid_or_none(item_id)
    if uid is None:
        raise APIError(404, "not_found", "فتوا یافت نشد")
    sub = await submissions_service.get_submission(db, uid)
    updated = await submissions_service.transition(db, submission=sub, target=to, actor=actor)
    return {"id": str(updated.id), "workflow_status": updated.workflow_status,
            "version": updated.version}


async def _list_knowledge_chunks(db: AsyncSession, f: ListFilters) -> list[dict]:
    stmt = select(FiqhKnowledgeChunk)
    if f.q:
        stmt = stmt.where(_like(FiqhKnowledgeChunk.chunk_text, f.q))
    if f.status:
        stmt = stmt.where(FiqhKnowledgeChunk.workflow_status == f.status)
    if f.author_id:
        au = _uuid_or_none(f.author_id)
        stmt = stmt.where(FiqhKnowledgeChunk.approved_by == au) if au else stmt.where(false())
    if f.ai_scope and f.ai_scope != "none":
        # ai_scopes لیست JSON است — فیلتر در حافظه برای سازگاری SQLite/Postgres
        pass
    if f.date_from:
        stmt = stmt.where(FiqhKnowledgeChunk.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(FiqhKnowledgeChunk.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(FiqhKnowledgeChunk.created_at <= f.cursor_ts)
    stmt = stmt.order_by(FiqhKnowledgeChunk.created_at.desc(),
                         FiqhKnowledgeChunk.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    out = []
    for o in rows:
        scopes = o.ai_scopes or []
        if f.ai_scope and f.ai_scope != "none" and f.ai_scope not in scopes:
            continue
        out.append({
            "domain": "fatwa", "content_type": "knowledge_chunk", "id": str(o.id),
            "title": (o.chunk_text or "")[:120], "excerpt": (o.chunk_text or "")[:300],
            "status": o.workflow_status,
            "author_id": str(o.approved_by) if o.approved_by else None,
            "visibility": None, "ai_scopes": scopes, "version": None,
            "created_at": o.created_at, "updated_at": o.updated_at,
            "published_at": None,
        })
    return out


async def _get_knowledge_chunk(db: AsyncSession, item_id: str) -> dict | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    o = await db.get(FiqhKnowledgeChunk, uid)
    if o is None:
        return None
    return {
        "domain": "fatwa", "content_type": "knowledge_chunk", "id": str(o.id),
        "title": (o.chunk_text or "")[:120], "excerpt": (o.chunk_text or "")[:500],
        "status": o.workflow_status,
        "author_id": str(o.approved_by) if o.approved_by else None,
        "visibility": None, "ai_scopes": o.ai_scopes or [], "version": None,
        "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": None, "raw": o,
    }


register(ContentAdapter(
    domain="fatwa", content_type="fatwa_submission", label="فتوای رسمی",
    audit_entity_type="fatwa_submission",
    list_fn=_list_fatwa_submissions, get_fn=_get_fatwa_submission,
    transition_fn=_transition_fatwa_submission,
))
register(ContentAdapter(
    domain="fatwa", content_type="knowledge_chunk", label="chunk دانش فقهی",
    audit_entity_type="fiqh_knowledge_chunk",
    list_fn=_list_knowledge_chunks, get_fn=_get_knowledge_chunk,
    transition_fn=None,  # گذار chunk از مسیر ingestion خودش است
))


# ---------------------------------------------------------------------------
# آداپتر library
# ---------------------------------------------------------------------------


async def _list_library_items(db: AsyncSession, f: ListFilters) -> list[dict]:
    stmt = select(LibraryItem)
    if f.q:
        stmt = stmt.where(or_(_like(LibraryItem.title, f.q),
                              _like(LibraryItem.transcript, f.q)))
    if f.status:
        stmt = stmt.where(LibraryItem.workflow_status == f.status)
    if f.author_id:
        au = _uuid_or_none(f.author_id)
        stmt = stmt.where(LibraryItem.created_by == au) if au else stmt.where(false())
    if f.visibility:
        stmt = stmt.where(LibraryItem.visibility == f.visibility)
    if f.date_from:
        stmt = stmt.where(LibraryItem.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(LibraryItem.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(LibraryItem.created_at <= f.cursor_ts)
    stmt = stmt.order_by(LibraryItem.created_at.desc(),
                         LibraryItem.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    out = []
    for o in rows:
        scopes = o.ai_scopes or []
        if f.ai_scope and f.ai_scope != "none" and f.ai_scope not in scopes:
            continue
        out.append({
            "domain": "library", "content_type": "library_item", "id": str(o.id),
            "title": _lt_text(o.title), "excerpt": _lt_text(o.description)[:300],
            "status": o.workflow_status,
            "author_id": str(o.created_by) if o.created_by else None,
            "visibility": o.visibility, "ai_scopes": scopes, "version": o.version,
            "created_at": o.created_at, "updated_at": o.updated_at,
            "published_at": o.published_at,
        })
    return out


async def _get_library_item(db: AsyncSession, item_id: str) -> dict | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    o = await db.get(LibraryItem, uid)
    if o is None:
        return None
    return {
        "domain": "library", "content_type": "library_item", "id": str(o.id),
        "title": _lt_text(o.title), "excerpt": _lt_text(o.description)[:500],
        "status": o.workflow_status,
        "author_id": str(o.created_by) if o.created_by else None,
        "visibility": o.visibility, "ai_scopes": o.ai_scopes or [],
        "version": o.version, "created_at": o.created_at,
        "updated_at": o.updated_at, "published_at": o.published_at, "raw": o,
    }


async def _transition_library_item(db: AsyncSession, item_id: str,
                                   to: str, actor: User) -> dict:
    from app.modules.library import service as library_service

    uid = _uuid_or_none(item_id)
    if uid is None:
        raise APIError(404, "not_found", "آیتم کتابخانه یافت نشد")
    out = await library_service.transition_item(db, uid, to, actor=actor)
    return {"id": str(uid), "workflow_status": out.get("workflow_status")}


register(ContentAdapter(
    domain="library", content_type="library_item", label="آیتم کتابخانه",
    audit_entity_type="library_item",
    list_fn=_list_library_items, get_fn=_get_library_item,
    transition_fn=_transition_library_item,
))


# ---------------------------------------------------------------------------
# آداپتر lms — دوره‌ها (بدون ماشین گردش‌کار؛ is_active نگاشت می‌شود)
# ---------------------------------------------------------------------------


async def _list_courses(db: AsyncSession, f: ListFilters) -> list[dict]:
    stmt = select(Course)
    if f.q:
        stmt = stmt.where(_like(Course.title, f.q))
    if f.author_id:
        # دوره‌ها نویسنده ندارند — فیلتر نویسنده یعنی نتیجهٔ خالی
        stmt = stmt.where(false())
    if f.status:
        # نگاشت یکپارچه: published ↔ فعال، archived ↔ غیرفعال
        if f.status == "published":
            stmt = stmt.where(Course.is_active.is_(True))
        elif f.status == "archived":
            stmt = stmt.where(Course.is_active.is_(False))
        else:
            stmt = stmt.where(false())
    if f.visibility:
        stmt = stmt.where(Course.visibility == f.visibility)
    if f.date_from:
        stmt = stmt.where(Course.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(Course.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(Course.created_at <= f.cursor_ts)
    stmt = stmt.order_by(Course.created_at.desc(), Course.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "domain": "lms", "content_type": "course", "id": str(o.id),
        "title": _lt_text(o.title), "excerpt": _lt_text(o.description)[:300],
        "status": "published" if o.is_active else "archived",
        "author_id": None, "visibility": o.visibility, "ai_scopes": [],
        "version": None, "created_at": o.created_at, "updated_at": None,
        "published_at": None,
    } for o in rows]


async def _get_course(db: AsyncSession, item_id: str) -> dict | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    o = await db.get(Course, uid)
    if o is None:
        return None
    return {
        "domain": "lms", "content_type": "course", "id": str(o.id),
        "title": _lt_text(o.title), "excerpt": _lt_text(o.description)[:500],
        "status": "published" if o.is_active else "archived",
        "author_id": None, "visibility": o.visibility, "ai_scopes": [],
        "version": None, "created_at": o.created_at, "updated_at": None,
        "published_at": None, "raw": o,
    }


register(ContentAdapter(
    domain="lms", content_type="course", label="دورهٔ آموزشی",
    audit_entity_type="course",
    list_fn=_list_courses, get_fn=_get_course,
    transition_fn=None,  # دوره‌ها ماشین گردش‌کار ندارند
))


# ---------------------------------------------------------------------------
# آداپتر social — پست‌ها
# ---------------------------------------------------------------------------


async def _list_social_posts(db: AsyncSession, f: ListFilters) -> list[dict]:
    stmt = select(SocialPost)
    if f.q:
        stmt = stmt.where(_like(SocialPost.body, f.q))
    if f.status:
        mapped = {"published": "published", "archived": "removed"}.get(f.status)
        stmt = stmt.where(SocialPost.status == mapped) if mapped else stmt.where(false())
    if f.author_id:
        au = _uuid_or_none(f.author_id)
        stmt = stmt.where(SocialPost.author_id == au) if au else stmt.where(false())
    if f.date_from:
        stmt = stmt.where(SocialPost.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(SocialPost.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(SocialPost.created_at <= f.cursor_ts)
    stmt = stmt.order_by(SocialPost.created_at.desc(),
                         SocialPost.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "domain": "social", "content_type": "social_post", "id": str(o.id),
        "title": (o.body or "")[:120], "excerpt": (o.body or "")[:300],
        "status": "published" if o.status == "published" else "archived",
        "author_id": str(o.author_id), "visibility": None, "ai_scopes": [],
        "version": None, "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": None,
    } for o in rows]


async def _get_social_post(db: AsyncSession, item_id: str) -> dict | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    o = await db.get(SocialPost, uid)
    if o is None:
        return None
    return {
        "domain": "social", "content_type": "social_post", "id": str(o.id),
        "title": (o.body or "")[:120], "excerpt": (o.body or "")[:500],
        "status": "published" if o.status == "published" else "archived",
        "author_id": str(o.author_id), "visibility": None, "ai_scopes": [],
        "version": None, "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": None, "raw": o,
    }


register(ContentAdapter(
    domain="social", content_type="social_post", label="پست اجتماعی",
    audit_entity_type="social_post",
    list_fn=_list_social_posts, get_fn=_get_social_post,
    transition_fn=None,  # پست‌ها چرخهٔ §۹ ندارند؛ نظارت از مسیر moderation است
))


# ---------------------------------------------------------------------------
# آداپتر places
# ---------------------------------------------------------------------------


async def _list_places(db: AsyncSession, f: ListFilters) -> list[dict]:
    stmt = select(ReligiousPlace)
    if f.q:
        stmt = stmt.where(_like(ReligiousPlace.name, f.q))
    if f.status:
        stmt = stmt.where(ReligiousPlace.workflow_status == f.status)
    if f.author_id:
        au = _uuid_or_none(f.author_id)
        stmt = stmt.where(ReligiousPlace.created_by == au) if au else stmt.where(false())
    if f.date_from:
        stmt = stmt.where(ReligiousPlace.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(ReligiousPlace.created_at <= f.date_to)
    if f.cursor_ts:
        stmt = stmt.where(ReligiousPlace.created_at <= f.cursor_ts)
    stmt = stmt.order_by(ReligiousPlace.created_at.desc(),
                         ReligiousPlace.id.asc()).limit(f.limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "domain": "places", "content_type": "religious_place", "id": str(o.id),
        "title": _lt_text(o.name), "excerpt": _lt_text(o.description)[:300],
        "status": o.workflow_status,
        "author_id": str(o.created_by) if o.created_by else None,
        "visibility": None, "ai_scopes": [], "version": o.version,
        "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": None,
    } for o in rows]


async def _get_place(db: AsyncSession, item_id: str) -> dict | None:
    uid = _uuid_or_none(item_id)
    if uid is None:
        return None
    o = await db.get(ReligiousPlace, uid)
    if o is None:
        return None
    return {
        "domain": "places", "content_type": "religious_place", "id": str(o.id),
        "title": _lt_text(o.name), "excerpt": _lt_text(o.description)[:500],
        "status": o.workflow_status,
        "author_id": str(o.created_by) if o.created_by else None,
        "visibility": None, "ai_scopes": [], "version": o.version,
        "created_at": o.created_at, "updated_at": o.updated_at,
        "published_at": None, "raw": o,
    }


async def _transition_place(db: AsyncSession, item_id: str, to: str, actor: User) -> dict:
    from app.modules.places import service as places_service

    uid = _uuid_or_none(item_id)
    if uid is None:
        raise APIError(404, "not_found", "مکان یافت نشد")
    out = await places_service.transition_place(db, uid, to, actor=actor)
    return {"id": str(uid), "workflow_status": out.get("workflow_status")}


register(ContentAdapter(
    domain="places", content_type="religious_place", label="مکان مذهبی",
    audit_entity_type="religious_place",
    list_fn=_list_places, get_fn=_get_place,
    transition_fn=_transition_place,
))


# ---------------------------------------------------------------------------
# حل نام نویسنده — یک کوئری دسته‌ای برای همهٔ آیتم‌ها
# ---------------------------------------------------------------------------


async def resolve_author_names(db: AsyncSession, author_ids: list[str | None]) -> dict[str, str]:
    ids = {_uuid_or_none(a) for a in author_ids if a}
    ids.discard(None)
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {str(u.id): u.full_name for u in rows}


async def resolve_author_name(db: AsyncSession, author_id: str | None) -> str | None:
    if not author_id:
        return None
    return (await resolve_author_names(db, [author_id])).get(author_id)


# راحتی برای distribute_service: نگاشت content_type تلگرام → دامنه
TELEGRAM_CONTENT_DOMAINS: dict[str, str] = {
    "fatwa_submission": "fatwa",
    "library_item": "library",
    "religious_place": "places",
}
