"""سرویس خانه و جست‌وجو — فاز ۳.

- GET /api/v1/home/sections: فقط بخش‌های visible به‌ترتیب sort_order + رونویسی‌های
  تم از platform_settings (قرارداد کلیدها: `theme.palette.<token>` و `theme.fonts.<slot>`؛
  مثلاً کلید `theme.palette.color-primary-700` با مقدار `#0a5c44` می‌شود
  `"palette": {"color-primary-700": "#0a5c44"}`. اگر هیچ کلید `theme.*` نباشد → theme=null
  و فرانت‌اند به CSS پیش‌فرض برمی‌گردد).
- GET /api/v1/search: جست‌وجوی سراسری واقعی (M-01 — ADR-0033) روی
  home_sections و themes (فاز ۳) + فتواهای منتشرشده، آیتم‌های عمومیِ
  کتابخانه، دوره‌های فعال عمومی و صفحه‌های CMS منتشرشده. امتیاز
  ترکیبی: واژگانی (پیشوند > درون‌رشته؛ عنوان > متن) + تازگی +
  محبوبیت (فقط سیگنال واقعی: ثبت‌نام دوره) + تقویت معنایی فتوا
  وقتی provider واقعی embedding فعال است (§۸).
"""
from __future__ import annotations

import logging
import math
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.platform_settings import get_setting
from app.models.models import (
    CohortEnrollment,
    Course,
    CourseCohort,
    FatwaSubmission,
    HomeSection,
    LibraryItem,
    Page,
    PlatformSetting,
    Theme,
)

logger = logging.getLogger("app.home")

from .schemas import (
    HomeOut,
    HomeSectionOut,
    LocalizedText,
    SearchOut,
    SearchResultOut,
    SectionEmpty,
    ThemeOverrides,
)

_LOCALES = ("fa", "ar", "en")

# --- امتیازدهی جست‌وجو: پیشوند > درون‌رشته؛ عنوان > زیرعنوان ---
_SCORE_PREFIX_TITLE = 2.0
_SCORE_SUBSTR_TITLE = 1.0
_SCORE_PREFIX_SUBTITLE = 1.5
_SCORE_SUBSTR_SUBTITLE = 0.5


def _as_localized(raw: dict | None) -> LocalizedText | None:
    """تبدیل امن LocalizedText ذخیره‌شده — رکوردهای ناقص نادیده گرفته می‌شوند."""
    if not isinstance(raw, dict):
        return None
    try:
        return LocalizedText(fa=str(raw["fa"]), ar=str(raw["ar"]), en=str(raw["en"]))
    except (KeyError, TypeError):
        return None


def _match_score(texts: list[str], needle: str, prefix_w: float, substr_w: float) -> float:
    best = 0.0
    for text in texts:
        t = text.lower()
        if t.startswith(needle):
            best = max(best, prefix_w)
        elif needle in t:
            best = max(best, substr_w)
    return best


async def get_home_sections(db: AsyncSession) -> HomeOut:
    """بخش‌های visible خانه به‌ترتیب sort_order + رونویسی تم (یا null)."""
    rows = (
        await db.execute(
            select(HomeSection)
            .where(HomeSection.visible.is_(True))
            .order_by(HomeSection.sort_order.asc())
        )
    ).scalars().all()

    sections: list[HomeSectionOut] = []
    for row in rows:
        title = _as_localized(row.title)
        if title is None:  # دادهٔ خراب هرگز نباید پاسخ را بشکند
            continue
        empty = None
        empty_title = _as_localized(row.empty_title)
        empty_hint = _as_localized(row.empty_hint)
        if empty_title is not None and empty_hint is not None:
            empty = SectionEmpty(title=empty_title, hint=empty_hint)
        sections.append(
            HomeSectionOut(
                key=row.key,
                order=row.sort_order,
                visible=row.visible,
                title=title,
                subtitle=_as_localized(row.subtitle),
                data=row.data,
                empty=empty,
            )
        )

    return HomeOut(theme=await _load_theme_overrides(db), sections=sections)


async def set_section_data(
    db: AsyncSession, key: str, items: list[dict], layout: str | None
) -> dict:
    """Replace a HomeSection's data payload (admin-only, via admin_router).

    Only the `data` column is written; key/sort_order/visible/title/subtitle
    are untouched. Unknown key → 404. The payload shape mirrors the web's
    section-data contract: {"items": [...], "layout"?: <known layout>}.
    """
    row = (
        await db.execute(select(HomeSection).where(HomeSection.key == key))
    ).scalar_one_or_none()
    if row is None:
        raise APIError(404, "section_not_found", "بخش خانه یافت نشد")
    data: dict = {"items": items}
    if layout is not None:
        data["layout"] = layout
    row.data = data
    db.add(row)
    await db.commit()
    return {"key": row.key, "data": row.data}


async def _load_theme_overrides(db: AsyncSession) -> ThemeOverrides | None:
    """خواندن کلیدهای theme.* از platform_settings (مقادیر رمزگشایی‌شده via get_setting).

    قرارداد کلید (ثبت در schema + مستند):
      theme.palette.<token> → palette["<token>"]
      theme.fonts.<slot>    → fonts["<slot>"]
    کلیدهای ناشناخته زیر theme.* نادیده گرفته می‌شوند (forward-compatible).
    """
    keys = (
        await db.execute(
            select(PlatformSetting.key).where(PlatformSetting.key.like("theme.%"))
        )
    ).scalars().all()
    palette: dict[str, str] = {}
    fonts: dict[str, str] = {}
    for key in keys:
        value = await get_setting(db, key)
        if value is None:
            continue
        rest = key[len("theme."):]
        if rest.startswith("palette.") and len(rest) > len("palette."):
            palette[rest[len("palette."):]] = value
        elif rest.startswith("fonts.") and len(rest) > len("fonts."):
            fonts[rest[len("fonts."):]] = value
    if not palette and not fonts:
        return None
    return ThemeOverrides(palette=palette, fonts=fonts)


# ---------------------------------------------------------------------------
# M-01 — تجمیع سراسری: فتوا + کتابخانه + دوره + صفحهٔ CMS
# ---------------------------------------------------------------------------
# امتیاز ترکیبی هر hit: lexical (وزن‌های بالا) + تازگی (≤۰٫۱۵، افت
# ۱۸۰روزه) + محبوبیت (≤۰٫۱۵ — فقط جایی که سیگنال واقعیِ مشارکت هست:
# فعلاً ثبت‌نام دوره‌ها؛ برای بقیهٔ منابع سیگنال صادقانه‌ای در داده
# نیست و مؤلفه صفر است، ADR-0033) + معنایی (فقط فتوا، فقط وقتی
# provider واقعیِ embedding فعال است — با hash فعال نمی‌شود).

_TYPE_ORDER = {"section": 0, "fatwa": 1, "library": 2, "course": 3, "page": 4, "theme": 5}
# سقف اسکن واژگانی به‌ازای هر منبع (تازه‌ترین‌های منتشرشده) — همان
# الگوی جست‌وجوی خود کتابخانه؛ ستون‌های JSONB روی SQLite به‌صورت
# unicode-escaped ذخیره می‌شوند و پیش‌فیلتر SQL روی آن‌ها قابل‌اتکا
# نیست، پس امتیازدهی در پایتون است و روی هر دو دیالکت یکسان کار
# می‌کند. مسیر ارتقا به PG FTS برای کاتالوگ‌های بسیار بزرگ در
# ADR-0033 ثبت شده است.
_SCAN_CAP = 500
_RECENCY_MAX = 0.15
_POPULARITY_MAX = 0.15
_SEMANTIC_MAX = 0.3


def _recency_boost(ts: datetime | None) -> float:
    if ts is None:
        return 0.0
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    age_days = max(0.0, (datetime.now(UTC) - ts).total_seconds() / 86400.0)
    return _RECENCY_MAX * max(0.0, 1.0 - age_days / 180.0)


def _popularity_boost(count: int, max_count: int) -> float:
    if count <= 0 or max_count <= 0:
        return 0.0
    return _POPULARITY_MAX * (math.log1p(count) / math.log1p(max_count))


def _locale_texts(raw: dict | None) -> list[str]:
    if not isinstance(raw, dict):
        return []
    return [str(raw[loc]) for loc in _LOCALES if raw.get(loc)]


def _score_hit(
    title_texts: list[str],
    body_texts: list[str],
    needle: str,
    *,
    recency_ts: datetime | None = None,
    popularity: float = 0.0,
) -> tuple[float, str | None]:
    """-> (امتیاز ترکیبی، متن تطابق‌یافته برای snippet)."""
    score = _match_score(title_texts, needle, _SCORE_PREFIX_TITLE, _SCORE_SUBSTR_TITLE)
    matched: str | None = next((t for t in title_texts if needle in t.lower()), None)
    if body_texts:
        body_score = _match_score(
            body_texts, needle, _SCORE_PREFIX_SUBTITLE, _SCORE_SUBSTR_SUBTITLE
        )
        if body_score > score:
            score = body_score
            matched = next((t for t in body_texts if needle in t.lower()), matched)
    if score <= 0:
        return 0.0, None
    return round(score + _recency_boost(recency_ts) + popularity, 4), matched


async def _fatwa_hits(db: AsyncSession, needle: str) -> list[SearchResultOut]:
    rows = (
        await db.execute(
            select(FatwaSubmission)
            .where(FatwaSubmission.workflow_status == "published")
            .order_by(FatwaSubmission.published_at.desc())
            .limit(_SCAN_CAP)
        )
    ).scalars().all()
    hits: list[SearchResultOut] = []
    for row in rows:
        title = _as_localized(row.title)
        if title is None:
            continue
        score, matched = _score_hit(
            _locale_texts(row.title),
            [row.body or ""],
            needle,
            recency_ts=row.published_at or row.created_at,
        )
        if score <= 0:
            continue
        hits.append(
            SearchResultOut(
                type="fatwa",
                id=str(row.id),
                title=title,
                snippet=_snippet(matched or row.body or ""),
                url="/fatwa",
                score=score,
            )
        )
    return hits


async def _library_hits(db: AsyncSession, needle: str) -> list[SearchResultOut]:
    rows = (
        await db.execute(
            select(LibraryItem)
            .where(
                LibraryItem.workflow_status == "published",
                LibraryItem.visibility == "public",
            )
            .order_by(LibraryItem.created_at.desc())
            .limit(_SCAN_CAP)
        )
    ).scalars().all()
    hits: list[SearchResultOut] = []
    for row in rows:
        title = _as_localized(row.title)
        if title is None:
            continue
        body_texts = _locale_texts(row.description) + (
            [row.transcript] if row.transcript else []
        )
        score, matched = _score_hit(
            _locale_texts(row.title),
            body_texts,
            needle,
            recency_ts=row.created_at,
        )
        if score <= 0:
            continue
        hits.append(
            SearchResultOut(
                type="library",
                id=str(row.id),
                title=title,
                snippet=_snippet(matched or ""),
                url=f"/library/{row.id}",
                score=score,
            )
        )
    return hits


async def _course_hits(db: AsyncSession, needle: str) -> list[SearchResultOut]:
    rows = (
        await db.execute(
            select(Course)
            .where(Course.is_active.is_(True), Course.visibility == "public")
            .order_by(Course.created_at.desc())
            .limit(_SCAN_CAP)
        )
    ).scalars().all()
    if not rows:
        return []
    enrollments: dict[str, int] = {}
    counts = (
        await db.execute(
            select(CourseCohort.course_id, func.count(CohortEnrollment.id))
            .join(CohortEnrollment, CohortEnrollment.cohort_id == CourseCohort.id)
            .where(CohortEnrollment.status == "active")
            .group_by(CourseCohort.course_id)
        )
    ).all()
    for course_id, n in counts:
        enrollments[str(course_id)] = int(n)
    max_enroll = max(enrollments.values(), default=0)
    hits: list[SearchResultOut] = []
    for row in rows:
        title = _as_localized(row.title)
        if title is None:
            continue
        score, matched = _score_hit(
            _locale_texts(row.title),
            _locale_texts(row.description),
            needle,
            recency_ts=row.created_at,
            popularity=_popularity_boost(
                enrollments.get(str(row.id), 0), max_enroll
            ),
        )
        if score <= 0:
            continue
        hits.append(
            SearchResultOut(
                type="course",
                id=str(row.id),
                title=title,
                snippet=_snippet(matched or ""),
                url=f"/learn/courses/{row.id}",
                score=score,
            )
        )
    return hits


def _block_texts(blocks: object) -> list[str]:
    out: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, str):
            out.append(node)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(blocks)
    return out


async def _page_hits(db: AsyncSession, needle: str) -> list[SearchResultOut]:
    rows = (
        await db.execute(
            select(Page)
            .where(Page.workflow_status == "published")
            .order_by(Page.created_at.desc())
            .limit(_SCAN_CAP)
        )
    ).scalars().all()
    hits: list[SearchResultOut] = []
    for row in rows:
        title = _as_localized(row.title)
        if title is None:
            continue
        score, matched = _score_hit(
            _locale_texts(row.title),
            _block_texts(row.blocks),
            needle,
            recency_ts=row.published_at or row.created_at,
        )
        if score <= 0:
            continue
        hits.append(
            SearchResultOut(
                type="page",
                id=str(row.id),
                title=title,
                snippet=_snippet(matched or ""),
                url=f"/pages/{row.slug}",
                score=score,
            )
        )
    return hits


async def _apply_semantic_boost(
    db: AsyncSession, query: str, hits: list[SearchResultOut]
) -> None:
    """تقویت معناییِ hitهای فتوا — فقط با provider واقعی (نه hash).

    بهترین‌تلاش است: هر خطایی در این پا، جست‌وجوی واژگانی را هرگز
    خراب نمی‌کند (لاگ debug و ادامه).
    """
    fatwa_ids = {h.id for h in hits if h.type == "fatwa"}
    if not fatwa_ids:
        return
    try:
        from app.models.models import FiqhKnowledgeChunk
        from app.modules.fatwa.embeddings import ChunkIndex, get_embedding_provider

        provider = await get_embedding_provider(db)
        if getattr(provider, "name", "hash") == "hash":
            return
        scored = await ChunkIndex(provider).search(db, query, top_k=10)
        if not scored:
            return
        chunk_ids = [s.chunk_id for s in scored]
        chunks = (
            await db.execute(
                select(FiqhKnowledgeChunk).where(FiqhKnowledgeChunk.id.in_(chunk_ids))
            )
        ).scalars().all()
        ref_by_chunk = {
            str(c.id): (c.source_ref or {}).get("id")
            for c in chunks
            if isinstance(c.source_ref, dict)
        }
        best: dict[str, float] = {}
        for s in scored:
            ref = ref_by_chunk.get(str(s.chunk_id))
            if ref in fatwa_ids:
                best[ref] = max(best.get(ref, 0.0), float(s.semantic))
        for h in hits:
            if h.type == "fatwa" and h.id in best:
                h.score = round(h.score + _SEMANTIC_MAX * best[h.id], 4)
    except (APIError, ValueError, TypeError, KeyError, AttributeError) as exc:
        logger.debug("semantic boost skipped: %s", exc)


async def search(
    db: AsyncSession, q: str, result_type: str | None = None, limit: int = 10
) -> SearchOut:
    """جست‌وجوی واژگانی واقعی روی بخش‌های خانه و تم‌ها.

    - q خالی/فقط-فاصله → 422 (پاکت یکدست). طول >۲۰۰ در لایهٔ روتر رد می‌شود.
    - type نامعتبر/ناشناخته → نتیجهٔ خالی (نه خطا) تا افزودن typeهای فازهای بعد نشکند.
    - total = تعداد کل تطابق‌ها قبل از limit؛ results برش‌خورده با limit.
    """
    needle = q.strip().lower()
    if not needle:
        raise APIError(422, "invalid_query", "متن جست‌وجو نمی‌تواند خالی باشد")

    want_sections = result_type in (None, "section")
    want_themes = result_type in (None, "theme")

    hits: list[SearchResultOut] = []

    if want_sections:
        rows = (
            await db.execute(
                select(HomeSection)
                .where(HomeSection.visible.is_(True))
                .order_by(HomeSection.sort_order.asc())
            )
        ).scalars().all()
        for row in rows:
            title = _as_localized(row.title)
            subtitle = _as_localized(row.subtitle)
            if title is None:
                continue
            title_texts = [getattr(title, loc) for loc in _LOCALES]
            score = _match_score(title_texts, needle, _SCORE_PREFIX_TITLE, _SCORE_SUBSTR_TITLE)
            matched_text: str | None = None
            if subtitle is not None:
                sub_texts = [getattr(subtitle, loc) for loc in _LOCALES]
                sub_score = _match_score(
                    sub_texts, needle, _SCORE_PREFIX_SUBTITLE, _SCORE_SUBSTR_SUBTITLE
                )
                if sub_score > score:
                    score = sub_score
                    matched_text = next(
                        (t for t in sub_texts if needle in t.lower()), None
                    )
            if score <= 0:
                continue
            if matched_text is None:
                matched_text = next(
                    (t for t in title_texts if needle in t.lower()), title_texts[0]
                )
            hits.append(
                SearchResultOut(
                    type="section",
                    id=row.key,
                    title=title,
                    snippet=_snippet(matched_text),
                    url=None,  # URL سطح‌بخش در فازهای بعد (مسیر frontend) پر می‌شود
                    score=score,
                )
            )

    if want_themes:
        # FIX2-12: فقط تم فعال (منتشرشده) — مثل همهٔ مصرف‌کننده‌های
        # عمومی دیگر (meta/router، cms)؛ قبلاً همهٔ تم‌ها از جمله
        # پیش‌نویس/غیرفعال در جست‌وجوی عمومی نشت می‌کردند.
        themes = (
            await db.execute(select(Theme).where(Theme.is_active.is_(True)))
        ).scalars().all()
        for theme in themes:
            name = _as_localized(theme.name)
            if name is None:
                continue
            name_texts = [getattr(name, loc) for loc in _LOCALES]
            score = _match_score(
                name_texts, needle, _SCORE_PREFIX_TITLE, _SCORE_SUBSTR_TITLE
            )
            if score <= 0:
                continue
            matched = next((t for t in name_texts if needle in t.lower()), name_texts[0])
            hits.append(
                SearchResultOut(
                    type="theme",
                    id=str(theme.id),
                    title=name,
                    snippet=_snippet(matched),
                    url=None,
                    score=score,
                )
            )

    # M-01: تجمیع منابع محتوایی (فقط منتشرشده‌ها/عمومی‌ها)
    if result_type in (None, "fatwa"):
        hits += await _fatwa_hits(db, needle)
    if result_type in (None, "library"):
        hits += await _library_hits(db, needle)
    if result_type in (None, "course"):
        hits += await _course_hits(db, needle)
    if result_type in (None, "page"):
        hits += await _page_hits(db, needle)
    if result_type in (None, "fatwa"):
        await _apply_semantic_boost(db, q.strip(), hits)

    # امتیاز نزولی؛ تساوی: ترتیب نوع ثابت، بعد id برای قطعیت ترتیب
    hits.sort(key=lambda h: (-h.score, _TYPE_ORDER.get(h.type, 9), h.id))
    total = len(hits)
    return SearchOut(query=q.strip(), results=hits[:limit], total=total)


def _snippet(text: str, width: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[:width].rstrip() + "…"
