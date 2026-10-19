"""اسکیماهای ویجت‌ها — فاز ۱۱."""
from __future__ import annotations

from pydantic import BaseModel, Field


class PrayerTimesOut(BaseModel):
    date: str
    lat: float
    lng: float
    method: str
    madhab: str
    tz: float
    times: dict[str, str]


class AyahOfDayOut(BaseModel):
    date: str
    surah: int
    ayah: int
    bundle: dict


class LatestFatwaOut(BaseModel):
    id: str
    title: dict
    excerpt: str
    published_at: str | None


class ZakatMiniOut(BaseModel):
    amount: str
    currency: str | None = None
    zakat_due: str | None = None
    nisab: str | None = None
    detail: dict = Field(default_factory=dict)
