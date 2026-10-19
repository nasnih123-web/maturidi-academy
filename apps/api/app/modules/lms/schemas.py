"""اسکیماهای Pydantic فاز ۸ (LMS) — قرارداد §۱۵.۷ (type/schema صریح) و §۱۵.۴ (LocalizedText)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# LocalizedText: {"fa": ..., "ar": ..., "en": ...} — هرگز متن تک‌زبانهٔ هاردکد.
LocalizedText = dict[str, str]


class CurriculumOut(BaseModel):
    id: uuid.UUID
    title: LocalizedText
    description: str | None = None
    sort_order: int
    is_active: bool


class CurriculumCreateIn(BaseModel):
    title: LocalizedText
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CurriculumUpdateIn(BaseModel):
    title: LocalizedText | None = None
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CourseOut(BaseModel):
    id: uuid.UUID
    curriculum_id: uuid.UUID | None
    title: LocalizedText
    description: LocalizedText | None
    level: str
    visibility: str
    sort_order: int
    is_active: bool
    lesson_count: int = 0
    progress_pct: float | None = None  # فقط برای کاربر احرازهویتی


class CourseCreateIn(BaseModel):
    curriculum_id: uuid.UUID | None = None
    title: LocalizedText
    description: LocalizedText | None = None
    level: str = Field(default="beginner", pattern="^(beginner|intermediate|advanced)$")
    visibility: str = Field(default="public", pattern="^(public|private)$")
    thumbnail_media_ref: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CourseUpdateIn(BaseModel):
    curriculum_id: uuid.UUID | None = None
    title: LocalizedText | None = None
    description: LocalizedText | None = None
    level: str | None = Field(default=None, pattern="^(beginner|intermediate|advanced)$")
    visibility: str | None = Field(default=None, pattern="^(public|private)$")
    thumbnail_media_ref: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class LessonOut(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: LocalizedText
    body: list = Field(default_factory=list)
    duration_minutes: int
    sort_order: int
    is_free_preview: bool
    status: str | None = None  # وضعیت پیشرفت کاربر (وقتی احرازهویت شده)
    position_seconds: int = 0
    prev_lesson_id: uuid.UUID | None = None  # ناوبری (فاز ۸)
    next_lesson_id: uuid.UUID | None = None


class LessonCreateIn(BaseModel):
    course_id: uuid.UUID
    title: LocalizedText
    body: list = Field(default_factory=list)
    duration_minutes: int = 0
    sort_order: int = 0
    is_free_preview: bool = False


class LessonUpdateIn(BaseModel):
    title: LocalizedText | None = None
    body: list | None = None
    duration_minutes: int | None = None
    sort_order: int | None = None
    is_free_preview: bool | None = None


class CourseDetailOut(BaseModel):
    course: CourseOut
    lessons: list[LessonOut]
    completed_lessons: int
    total_lessons: int
    progress_pct: float
    has_certificate: bool


class ProgressIn(BaseModel):
    status: str = Field(pattern="^(not_started|in_progress|completed)$")
    position_seconds: int = Field(default=0, ge=0)


class ProgressOut(BaseModel):
    lesson_id: uuid.UUID
    status: str
    position_seconds: int
    completed_at: datetime | None
    course_completed: bool = False
    certificate_code: str | None = None


class CursorPage(BaseModel):
    items: list
    next_cursor: str | None = None


class CourseProgressSummary(BaseModel):
    course_id: uuid.UUID
    course_title: LocalizedText
    level: str
    total_lessons: int
    completed_lessons: int
    progress_pct: float
    quiz_avg: float | None = None
    quiz_attempts: int = 0


class StudyReportOut(BaseModel):
    courses: list[CourseProgressSummary]
    total_completed_lessons: int
    total_lessons: int
    overall_progress_pct: float
    quiz_overall_avg: float | None = None
    streak_days: int


class RecommendationOut(BaseModel):
    lesson: LessonOut
    course_title: LocalizedText
    level: str
    reason: str  # کلید دلیل (نه متن نمایشی — متن در فرانت محلی‌سازی می‌شود)


class CohortOut(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: LocalizedText
    starts_at: datetime
    ends_at: datetime
    max_seats: int
    is_open: bool
    enrolled_count: int = 0
    seats_left: int = 0
    user_enrolled: bool = False


class CohortCreateIn(BaseModel):
    course_id: uuid.UUID
    title: LocalizedText
    starts_at: datetime
    ends_at: datetime
    max_seats: int = Field(gt=0)
    is_open: bool = True


class CohortUpdateIn(BaseModel):
    title: LocalizedText | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_seats: int | None = Field(default=None, gt=0)
    is_open: bool | None = None


class EnrollmentOut(BaseModel):
    cohort_id: uuid.UUID
    status: str
    enrolled_at: datetime
    seats_left: int


class PrerequisiteOut(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    requires_course_id: uuid.UUID


class PrerequisiteCreateIn(BaseModel):
    course_id: uuid.UUID
    requires_course_id: uuid.UUID


class CertificateVerifyOut(BaseModel):
    valid: bool
    code: str
    holder_name: str | None = None
    course_title: LocalizedText | None = None
    issued_at: datetime | None = None
    locale: str | None = None


class CertificateOut(BaseModel):
    id: uuid.UUID
    code: str
    course_id: uuid.UUID
    course_title: LocalizedText
    issued_at: datetime
    download_url: str | None = None


# ---------- admin reads (CRM پیشخوان یادگیری) ----------


class CohortEnrollmentAdminOut(BaseModel):
    id: uuid.UUID
    cohort_id: uuid.UUID
    user_id: uuid.UUID
    user_display: str
    enrolled_at: datetime
    status: str


class LessonProgressDetailOut(BaseModel):
    lesson_id: uuid.UUID
    lesson_title: LocalizedText
    sort_order: int
    completed: bool
    completed_at: datetime | None = None


class CourseProgressDetailOut(BaseModel):
    course_id: uuid.UUID
    course_title: LocalizedText
    total_lessons: int
    completed_lessons: int
    progress_pct: float
    lessons: list[LessonProgressDetailOut] = Field(default_factory=list)


class UserProgressAdminOut(BaseModel):
    user_id: uuid.UUID
    courses: list[CourseProgressDetailOut] = Field(default_factory=list)


class CertificateAdminOut(BaseModel):
    id: uuid.UUID
    code: str
    user_id: uuid.UUID
    user_display: str
    course_id: uuid.UUID
    course_title: LocalizedText
    issued_at: datetime
