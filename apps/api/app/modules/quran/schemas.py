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
    types: list[str] = []
    implemented: bool = True


class CustomProviderInfo(BaseModel):
    id: str
    name: str
    base_url: str
    type: str


class ProviderCatalogInfo(BaseModel):
    id: str
    name: str
    base_url: str
    types: list[str] = []
    implemented: bool = False
    note: str = ""


class QuranProvidersOut(BaseModel):
    providers: list[ProviderInfo]
    active_provider: str
    text_edition: str = "quran-uthmani"
    translations: list[str]
    tafsirs: list[str]
    # گام ۵: editionهای باندل‌شدهٔ نصب‌شده روی سرور (دادهٔ واقعی).
    bundled_translations: list[str] = []
    bundled_tafsirs: list[str] = []
    reciters: list[str]
    reciter_photos: dict[str, str] = {}
    active_languages: list[str]
    show_translation: bool
    show_tafsir: bool
    highlight_mode: str
    font_size: float
    playback: dict
    providers_by_type: dict[str, str] = {}
    custom_providers: list[CustomProviderInfo] = []
    provider_catalog: list[ProviderCatalogInfo] = []
    qf_base_url: str = ""
    qf_client_id: str = ""
    qf_client_secret_set: bool = False
    custom_provider_keys_set: list[str] = []


class CustomProviderKeyIn(BaseModel):
    key: str | None = Field(default=None, max_length=500)


class CustomProviderKeyOut(BaseModel):
    provider_id: str
    key_set: bool


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


# --- وضعیت خواندن (همگام‌سازی نشان‌ها + آخرین موقعیت — گام ۸، ایراد ۱۱) ---
# شکل درونیِ نشان/موقعیت عیناً قرارداد کلاینت وب است (کلیدهای camelCase
# مثل createdAt/savedAt همان‌طور که در localStorage ذخیره می‌شوند) تا
# sync بدون لایهٔ نگاشت رفت‌وبرگردد؛ کلیدهای بیرونی API طبق قرارداد
# بقیهٔ API snake_case می‌مانند (last_read / updated_at).


class ReadingBookmark(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    kind: Literal["ayah", "page"]
    surah: int = Field(ge=1, le=114)
    ayah: int | None = Field(default=None, ge=1, le=286)
    page: int | None = Field(default=None, ge=1, le=623)
    mushaf: str = Field(min_length=1, max_length=64)
    label: str = Field(max_length=500)
    favorite: bool = False
    createdAt: int = Field(ge=0)


class ReadingLastRead(BaseModel):
    surah: int = Field(ge=1, le=114)
    view: str = Field(min_length=1, max_length=16)
    target: int | None = Field(default=None, ge=1)
    ayah: int | None = Field(default=None, ge=1, le=286)
    mushaf: str = Field(min_length=1, max_length=64)
    savedAt: int = Field(ge=0)


class ReadingStateIn(BaseModel):
    bookmarks: list[ReadingBookmark] = Field(max_length=5000)
    last_read: ReadingLastRead | None = None
    updated_at: int = Field(ge=0)


class ReadingStateOut(BaseModel):
    bookmarks: list[ReadingBookmark]
    last_read: ReadingLastRead | None = None
    updated_at: int


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
