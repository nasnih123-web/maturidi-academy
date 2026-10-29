"""اسکیماهای Pydantic فاز ۵ — OpenAPI خودکار از همین مدل‌ها (§۱)."""
from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# --- قرآن ---


class SurahSummary(BaseModel):
    number: int
    name_ar: str
    name_en: str
    ayahs: int
    revelation: str


class SurahListOut(BaseModel):
    items: list[SurahSummary]
    total: int = 114


class AyahEditionOut(BaseModel):
    edition: str
    text: str
    audio_url: str | None = None
    juz: int | None = None
    page: int | None = None


class AyahOut(BaseModel):
    surah: int
    ayah: int
    editions: list[AyahEditionOut]


class SurahDetailOut(BaseModel):
    surah: int
    name_ar: str
    name_en: str
    ayahs: list[AyahOut]
    edition_ids: list[str]


class ProviderInfo(BaseModel):
    id: str
    name: str
    base_url: str
    active: bool


class QuranProvidersOut(BaseModel):
    providers: list[ProviderInfo]
    active_provider: str
    text_edition: str = "quran-uthmani"
    translations: list[str]
    tafsirs: list[str]
    reciters: list[str]
    active_languages: list[str]
    show_translation: bool
    show_tafsir: bool
    highlight_mode: str
    font_size: float
    playback: dict


# --- یادداشت آیه ---


class NoteIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    note_text: str = Field(min_length=1, max_length=5000)
    is_private: bool = True


class NoteUpdate(BaseModel):
    note_text: str | None = Field(default=None, min_length=1, max_length=5000)
    is_private: bool | None = None


class NoteOut(BaseModel):
    id: UUID
    surah: int
    ayah: int
    note_text: str
    is_private: bool
    created_at: str  # ISO 8601 (§۱)


class NoteListOut(BaseModel):
    items: list[NoteOut]
    next_cursor: str | None = None


# --- تسبیح ---


class TasbihSessionIn(BaseModel):
    dhikr_text: str = Field(min_length=1, max_length=255)
    target_count: int | None = Field(default=None, ge=1, le=1_000_000)


class TasbihCountIn(BaseModel):
    amount: int = Field(default=1, ge=1, le=1000)
    idempotency_key: str | None = Field(default=None, max_length=64)


class TasbihSessionOut(BaseModel):
    id: UUID
    dhikr_text: str
    target_count: int | None
    count: int
    started_at: str  # ISO 8601
    ended_at: str | None = None
    completed: bool = False


class DhikrTotalOut(BaseModel):
    dhikr_text: str
    total_count: int


class TasbihTodayOut(BaseModel):
    date: date
    totals: list[DhikrTotalOut]


# --- اذان ---


AdhanMethod = Literal[
    "council", "tehran", "isna", "mwl", "egypt", "karachi", "makkah",
    "qom", "jafari", "france",
]
Madhab = Literal["shafi", "hanafi"]


class AdhanTimes(BaseModel):
    imsak: str
    fajr: str
    sunrise: str
    dhuhr: str
    asr: str
    maghrib: str
    isha: str
    midnight: str


class AdhanTimesOut(BaseModel):
    date: date
    latitude: float
    longitude: float
    timezone_offset: float
    method: str
    method_label: str
    madhab: str
    times: AdhanTimes
    city: str | None = None
    source: str = "computed"
    sources: dict[str, str] = {}


class AdhanDayTimes(BaseModel):
    date: date
    source: str
    times: AdhanTimes


class AdhanRangeOut(BaseModel):
    start: date
    end: date
    city: str | None
    latitude: float
    longitude: float
    timezone_offset: float
    method: str
    madhab: str
    days: list[AdhanDayTimes]


class AdhanMethodOption(BaseModel):
    id: str
    label: str
    authority: str
    fajr: float | None
    isha: float | None
    maghrib: float | None
    isha_minutes: int | None
    isha_minutes_ramadan: int | None
    available: bool
    note: str


class AdhanCityOption(BaseModel):
    slug: str
    lat: float
    lng: float


class AdhanOptionsOut(BaseModel):
    methods: list[AdhanMethodOption]
    cities: list[AdhanCityOption]


class GeocodePlaceOut(BaseModel):
    name: str | None = None
    display_name: str = ""
    lat: float
    lng: float


class GeocodeSearchOut(BaseModel):
    results: list[GeocodePlaceOut]
