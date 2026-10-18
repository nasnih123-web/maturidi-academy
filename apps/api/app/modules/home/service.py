"""سرویس خانه و جست‌وجو — فاز ۳.

- GET /api/v1/home/sections: فقط بخش‌های visible به‌ترتیب sort_order + رونویسی‌های
  تم از platform_settings (قرارداد کلیدها: `theme.palette.<token>` و `theme.fonts.<slot>`؛
  مثلاً کلید `theme.palette.color-primary-700` با مقدار `#0a5c44` می‌شود
  `"palette": {"color-primary-700": "#0a5c44"}`. اگر هیچ کلید `theme.*` نباشد → theme=null
  و فرانت‌اند به CSS پیش‌فرض برمی‌گردد).
- GET /api/v1/search: جست‌وجوی واژگانی واقعی (نه mock) روی home_sections
  (title/subtitle در هر سه زبان) و themes (name). امتیاز: تطابق پیشوندی بالاتر از
  تطابق درونی. عمداً با ilike/lower پیاده شده تا هم روی SQLite (تست) هم Postgres
  کار کند — FTS معنایی/pgvector فازهای بعد می‌آید (قرارداد §۸).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.platform_settings import get_setting
from app.models.models import HomeSection, PlatformSetting, Theme

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
        themes = (await db.execute(select(Theme))).scalars().all()
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

    # امتیاز نزولی؛ تساوی: sectionها قبل از themeها، بعد key/id برای قطعیت ترتیب
    hits.sort(key=lambda h: (-h.score, 0 if h.type == "section" else 1, h.id))
    total = len(hits)
    return SearchOut(query=q.strip(), results=hits[:limit], total=total)


def _snippet(text: str, width: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[:width].rstrip() + "…"
