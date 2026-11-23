"""اسکیماهای Pydantic بخش کودکان — فاز ۴."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ChildrenVideoOut(BaseModel):
    id: UUID
    surah: int
    position: int
    item_id: UUID
    title: dict
    # youtube | aparat | direct | upload — همان طبقه‌بندی سرویس ویدیوها.
    source: str
    source_label: str
    external_url: str | None = None
    embed_url: str | None = None
    stream_url: str | None = None
    duration_seconds: int | None = None
    cover_url: str | None = None


class ChildrenVideoLinkIn(BaseModel):
    item_id: UUID
    position: int = 0


class ChildrenVideoOrderIn(BaseModel):
    item_ids: list[UUID]


class ChildrenQuestionOut(BaseModel):
    # برای سؤال CRM: UUID؛ برای سؤال خودکار: auto-mcq-<surah>-<key>.
    id: str
    surah: int
    question_type: Literal["mcq", "matching"]
    source: Literal["auto", "crm"]
    payload: dict
    # سؤال‌های عمومی همیشه فعال‌اند؛ فهرست مدیریت پرچم واقعی را می‌دهد.
    is_active: bool = True


class ChildrenQuestionCreateIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    question_type: Literal["mcq", "matching"]
    payload: dict
    is_active: bool = True


class ChildrenQuestionUpdateIn(BaseModel):
    payload: dict | None = None
    is_active: bool | None = None


class ChildrenQuizSubmitIn(BaseModel):
    question_type: Literal["mcq", "matching"]
    # mcq: {question_id: option_index}؛ matching: {question_id: {word: meaning}}.
    answers: dict


class ChildrenQuizSubmitOut(BaseModel):
    correct_count: int
    total: int
    stars: int
    stars_added: int
    completed: bool


class ChildrenListenIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    last_ayah: int = Field(ge=1)


class ChildrenProgressOut(BaseModel):
    surah: int
    stars: int
    status: str
    last_ayah: int
    listened_ayahs: int
    quiz_done: bool
    match_done: bool
    updated_at: datetime | None = None


class ChildrenJuzProgressOut(BaseModel):
    juz: int
    total_surahs: int
    completed_surahs: int
    started_surahs: int
    # done | started | current | locked
    state: str


class ChildrenWeekDayOut(BaseModel):
    date: str
    # برچسب کوتاه فارسی روز: ش ی د س چ پ ج (شنبه اول).
    label: str
    active: bool
    is_today: bool = False


class ChildrenDashboardOut(BaseModel):
    total_stars: int = 0
    learned_count: int = 0
    streak_current: int = 0
    streak_best: int = 0
    goal_surahs: int = 3
    goal_today_surahs: int = 0
    goal_met: bool = False
    today_surahs: list[dict] = []
    week: list[ChildrenWeekDayOut] = []
    weak_surahs: list[dict] = []
    continue_surah: dict | None = None
    juz_progress: list[ChildrenJuzProgressOut] = []
    progress: list[ChildrenProgressOut] = []


class ChildrenOfflinePackOut(BaseModel):
    surah: int
    reciter: str
    audio_url: str | None = None
    timing_available: bool = False
    timing: dict | None = None
    ayahs: list[dict] = []


class ChildrenWholeQuranPackOut(BaseModel):
    reciter: str
    surahs: list[dict] = []
