"""اسکیماهای Pydantic v2 ماژول خانه/جست‌وجو — فاز ۳.

شکل پاسخ‌ها frozen است و فرانت‌اند (apps/web) دقیقاً روی همین شکل کد می‌زند:
- GET /api/v1/home/sections → HomeOut
- GET /api/v1/search          → SearchOut
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


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
