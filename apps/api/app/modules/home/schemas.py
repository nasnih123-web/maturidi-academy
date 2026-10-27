"""اسکیماهای Pydantic v2 ماژول خانه/جست‌وجو — فاز ۳.

شکل پاسخ‌ها frozen است و فرانت‌اند (apps/web) دقیقاً روی همین شکل کد می‌زند:
- GET /api/v1/home/sections → HomeOut
- GET /api/v1/search          → SearchOut
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError


class LocalizedText(BaseModel):
    """متن قابل‌مشاهدهٔ کاربر — همیشه هر سه زبان (§۱۵.۴)."""

    fa: str
    ar: str
    en: str


class SectionEmpty(BaseModel):
    """حالت خالی بخش — وقتی ماژولِ بخش هنوز در فاز بعدی ساخته نشده."""

    title: LocalizedText
    hint: LocalizedText


class HomeSectionOut(BaseModel):
    key: str
    order: int
    visible: bool
    title: LocalizedText
    subtitle: LocalizedText | None
    data: dict[str, Any] | None
    empty: SectionEmpty | None


class ThemeOverrides(BaseModel):
    """رونویسی‌های تم از platform_settings.

    قرارداد کلیدها (مستند در service.py):
      theme.palette.<token> → palette["<token>"]   (مثل theme.palette.color-primary-700)
      theme.fonts.<slot>     → fonts["<slot>"]       (مثل theme.fonts.body)
    """

    palette: dict[str, str] = Field(default_factory=dict)
    fonts: dict[str, str] = Field(default_factory=dict)


class HomeOut(BaseModel):
    theme: ThemeOverrides | None
    sections: list[HomeSectionOut]


class SearchResultOut(BaseModel):
    # type: "section" | "theme" | "fatwa" | "library" | "course" | "page"
    # (M-01 تجمیع سراسری را کامل کرد — همان شکل forward-compatible فاز ۳).
    type: str
    id: str
    title: LocalizedText
    snippet: str | None
    url: str | None
    score: float


class SearchOut(BaseModel):
    query: str
    results: list[SearchResultOut]
    total: int


# ---------------------------------------------------------------------------
# Admin: section data (PUT /api/v1/admin/home/sections/{key}/data)
#
# Contract mirrors apps/web/lib/section-data.ts exactly:
# - data.items → cards, at most 12 (the web slices to 12; the API rejects
#   more instead of silently dropping items).
# - item.title must be a LocalizedText-ish dict with at least one non-empty
#   string (the web skips items whose picked title is empty).
# - item.url is stored only when it is a safe href: a same-origin path or an
#   http(s) URL (same rule as the web's safeHref).
# - data.layout, when given, must be one of the web's known layouts.
# This endpoint only REPLACES a section's data payload; it never touches
# key/sort_order/visible/title/subtitle (those live in seed + admin UI).
# ---------------------------------------------------------------------------

SECTION_LAYOUTS = ("slider", "grid", "featured-rail", "shelf", "mosaic")

_LOCALES = ("fa", "ar", "en")


def _validate_localized_text(value: Any, *, required: bool) -> Any:
    """Shared validator for LocalizedText-ish dicts.

    Accepts a plain string (kept as-is — the web's textOf handles it) or a
    dict whose keys are fa/ar/en and whose values are strings. For required
    fields at least one value must be non-empty.

    NOTE: raises PydanticCustomError, not ValueError — the app's validation
    handler serializes exc.errors() into the envelope, and a raw ValueError
    in the error ctx is not JSON-serializable (it would crash the handler).
    """
    if value is None:
        return None
    if isinstance(value, str):
        if required and not value.strip():
            raise PydanticCustomError("empty_text", "must be non-empty")
        return value
    if isinstance(value, dict):
        for k, v in value.items():
            if k not in _LOCALES:
                raise PydanticCustomError(
                    "unknown_locale", "unknown locale key: {key}", {"key": k}
                )
            if not isinstance(v, str):
                raise PydanticCustomError(
                    "bad_localized_value", "localized values must be strings"
                )
        if required and not any(v.strip() for v in value.values()):
            raise PydanticCustomError(
                "empty_text", "at least one locale must be non-empty"
            )
        return value
    raise PydanticCustomError(
        "bad_localized_text", "must be a string or a localized-text dict"
    )


def _validate_safe_href(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        raise PydanticCustomError("bad_url", "url must be a string")
    url = value.strip()
    if not url:
        return None
    if url.startswith("/") and not url.startswith("//"):
        return url
    if url.startswith(("https://", "http://")):
        return url
    raise PydanticCustomError(
        "unsafe_url", "url must be a same-origin path or an http(s) URL"
    )


class SectionDataItem(BaseModel):
    """One card inside a section's data.items (web ContentItem contract)."""

    id: str | None = None
    title: dict[str, str]
    subtitle: str | dict[str, str] | None = None
    snippet: str | dict[str, str] | None = None
    author: str | dict[str, str] | None = None
    category: str | dict[str, str] | None = None
    duration: str | dict[str, str] | None = None
    badge: str | dict[str, str] | None = None
    image: str | None = None
    url: str | None = None

    @field_validator("title")
    @classmethod
    def _title_ok(cls, v: Any) -> Any:
        return _validate_localized_text(v, required=True)

    @field_validator("subtitle", "snippet", "author", "category", "duration", "badge")
    @classmethod
    def _optional_text_ok(cls, v: Any) -> Any:
        return _validate_localized_text(v, required=False)

    @field_validator("url")
    @classmethod
    def _url_ok(cls, v: Any) -> Any:
        return _validate_safe_href(v)


class FooterLink(BaseModel):
    """One link inside a footer column (web NavLink contract).

    label is a LocalizedText-ish dict/string with at least one non-empty
    locale; href must be a safe href (same-origin path or http(s) URL) —
    the same rule as the web's safeHref. No invented targets: an unsafe
    href is rejected (422), never rewritten or dropped silently.
    """

    label: str | dict[str, str]
    href: str

    @field_validator("label")
    @classmethod
    def _label_ok(cls, v: Any) -> Any:
        return _validate_localized_text(v, required=True)

    @field_validator("href")
    @classmethod
    def _href_ok(cls, v: Any) -> Any:
        out = _validate_safe_href(v)
        if out is None:
            raise PydanticCustomError("unsafe_url", "url must be a same-origin path or an http(s) URL")
        return out


class FooterColumn(BaseModel):
    """One footer nav column: a localized heading plus its links."""

    heading: str | dict[str, str]
    links: list[FooterLink] = Field(max_length=12)

    @field_validator("heading")
    @classmethod
    def _heading_ok(cls, v: Any) -> Any:
        return _validate_localized_text(v, required=True)


class FooterBrand(BaseModel):
    """Footer brand texts, localized. Either field may be omitted; an
    omitted/empty field falls back to the web's built-in messages text.
    `rights` may contain a `{year}` placeholder, replaced by the web with
    the current year (same convention as the built-in messages string).
    """

    tagline: str | dict[str, str] | None = None
    rights: str | dict[str, str] | None = None

    @field_validator("tagline", "rights")
    @classmethod
    def _brand_text_ok(cls, v: Any) -> Any:
        return _validate_localized_text(v, required=False)


class SectionDataUpdate(BaseModel):
    """Full replacement payload for a section's data.

    Card sections send `items` (+ optional `layout`); the footer section
    sends `columns` (+ optional `brand`) instead — the endpoint is shared
    because the footer is a HomeSection key and only its `data` column is
    written, exactly like every other section. At least one content field
    must be present; fields that are absent are not written, so a footer
    save never invents an `items` key and an items save never invents
    footer columns.
    """

    items: list[SectionDataItem] | None = Field(default=None, max_length=12)
    layout: Literal["slider", "grid", "featured-rail", "shelf", "mosaic"] | None = None
    columns: list[FooterColumn] | None = Field(default=None, max_length=6)
    brand: FooterBrand | None = None

    @model_validator(mode="after")
    def _at_least_one_field(self) -> SectionDataUpdate:
        if (
            self.items is None
            and self.layout is None
            and self.columns is None
            and self.brand is None
        ):
            # PydanticCustomError, not ValueError: the app's validation
            # handler serializes exc.errors() into the envelope, and a raw
            # ValueError in the error ctx is not JSON-serializable (it
            # would crash the handler with TypeError instead of a 422).
            raise PydanticCustomError(
                "empty_payload",
                "at least one of items, layout, columns, brand must be present",
            )
        return self


class SectionDataOut(BaseModel):
    key: str
    data: dict[str, Any]
