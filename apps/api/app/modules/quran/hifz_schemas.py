"""اسکیماهای Pydantic حفاظ — فاز ۳ قرآن (record-then-grade).

صوت هرگز در هیچ پاسخی نمی‌آید: فقط نمره‌ها، خطاها و شمارش‌ها.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class HifzAttemptIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    page: int | None = Field(default=None, ge=1, le=604)
    # فاز ۴ — بازهٔ تمرین و تکرار (None = کل سوره، ۱ = بدون تکرار).
    start_ayah: int | None = Field(default=None, ge=1, le=286)
    end_ayah: int | None = Field(default=None, ge=1, le=286)
    repeat_ayah: int = Field(default=1, ge=1, le=20)
    repeat_range: int = Field(default=1, ge=1, le=20)


class HifzAttemptCounts(BaseModel):
    correct: int = 0
    close: int = 0
    wrong: int = 0
    skipped: int = 0


class HifzAttemptOut(BaseModel):
    id: UUID
    surah: int
    page: int | None
    status: str
    engine: str
    counts: HifzAttemptCounts = HifzAttemptCounts()
    created_at: datetime
    updated_at: datetime | None = None
    completed_at: datetime | None = None
    # فاز ۴ — بازه، موقعیتِ جاری و تکرار.
    start_ayah: int | None = None
    end_ayah: int | None = None
    current_surah: int | None = None
    current_ayah: int | None = None
    current_word_index: int | None = None
    repeat_ayah: int = 1
    repeat_range: int = 1


class HifzWordScoreOut(BaseModel):
    id: UUID
    attempt_id: UUID
    surah: int
    ayah: int
    word_index: int
    expected_text: str
    status: str
    prob: float
    heard: str | None = None
    mistake_type: str | None = None
    disputed: bool = False


class HifzMistakeOut(BaseModel):
    id: UUID
    attempt_id: UUID
    surah: int
    ayah: int
    word_index: int | None = None
    mistake_type: str
    expected_text: str
    heard: str | None = None
    created_at: datetime


class HifzAttemptDetailOut(BaseModel):
    attempt: HifzAttemptOut
    words: list[HifzWordScoreOut] = []
    mistakes: list[HifzMistakeOut] = []


class HifzGradeWordOut(BaseModel):
    word_index: int
    expected: str
    status: str
    prob: float
    heard: str | None = None
    mistake_type: str | None = None


class HifzGradeOut(BaseModel):
    attempt_id: UUID
    surah: int
    ayah: int
    word_index: int | None = None
    engine_used: str
    thresholds: dict[str, float] = {"green": 0.8, "amber": 0.5}
    words: list[HifzGradeWordOut] = []
    counts: HifzAttemptCounts = HifzAttemptCounts()
    extra_words: list[str] = []


class HifzPeekIn(BaseModel):
    """Peek: exactly ONE of word_index (one word) or word_indices
    (the rest of the ayah, in order). The combination is validated
    in the service (APIError 422) — a model_validator ValueError
    would surface as an unhandled RequestValidationError here.

    فاز ۴ — `kind`: معنای دکمه از روی شواهد ویدیو (§۹ مشخصات فاز ۲):
    "word" = دکمهٔ `<`، پیش‌نمایش کلمهٔ بعد؛ "ayah" = دکمهٔ `<<`،
    پیش‌نمایش بقیهٔ آیه. خودِ دکمه‌ها در هیچ ویدیو زده نشدند، پس
    این معناها استنباطِ آیکنیِ قوی‌اند، نه مشاهدهٔ قطعی؛ در یادداشت
    فاز ۴ پرچم شده‌اند.
    """

    surah: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    word_index: int | None = Field(default=None, ge=0)
    word_indices: list[int] | None = Field(default=None)
    kind: str = "word"


class HifzPeekWordOut(BaseModel):
    mistake_id: UUID
    word_index: int
    word: str


class HifzPeekOut(BaseModel):
    """The single fields describe the FIRST revealed word (old
    clients); `revealed` lists every word this call revealed."""

    mistake_id: UUID
    surah: int
    ayah: int
    word_index: int
    word: str
    revealed: list[HifzPeekWordOut] = []


class HifzDisputeIn(BaseModel):
    word_score_id: UUID


class HifzDisputeOut(BaseModel):
    word_score_id: UUID
    disputed: bool = True


class HifzStatsOut(BaseModel):
    attempts: int = 0
    graded_words: int = 0
    counts: HifzAttemptCounts = HifzAttemptCounts()
    dominant_mistake: str | None = None
    due_ayahs: int = 0


class HifzReviewItemOut(BaseModel):
    surah: int
    ayah: int
    mistake_count: int
    last_activity_at: datetime


class HifzStatusOut(BaseModel):
    engine: str
    available: bool
    reason: str = ""
    map_available: bool = False
    map_reason: str = ""


class HifzAdminAttemptOut(BaseModel):
    id: UUID
    user_id: UUID
    surah: int
    page: int | None
    status: str
    engine: str
    counts: HifzAttemptCounts = HifzAttemptCounts()
    created_at: datetime


# ---------------------------------------------------------------------------
# فاز ۱۰ — برنامهٔ حفظ، SRS، آزمون، تسمی، جستجوی صوتی، متشابهات
# ---------------------------------------------------------------------------


class HifzTestIn(BaseModel):
    surah_start: int = Field(ge=1, le=114)
    surah_end: int = Field(ge=1, le=114)
    question_count: int = Field(default=10, ge=1, le=99)
    time_limit_minutes: int | None = Field(default=None, ge=1, le=60)
    question_length: str = "medium"
    stop_rule: str = "ayah_end"


class HifzTestQuestionOut(BaseModel):
    id: UUID
    position: int
    surah: int
    ayah_start: int
    ayah_end: int
    prompt: str | None = None
    status: str = "pending"
    score: float | None = None
    counts: dict[str, int] = {}
    peek_count: int = 0
    raw_events: list[dict] = []
    answered_at: datetime | None = None


class HifzTestTotalOut(BaseModel):
    score: float
    answered: int
    total: int


class HifzTestOut(BaseModel):
    id: UUID
    surah_start: int
    surah_end: int
    question_count: int
    time_limit_minutes: int | None = None
    question_length: str = "medium"
    stop_rule: str = "ayah_end"
    status: str = "in_progress"
    started_at: datetime
    ends_at: datetime | None = None
    completed_at: datetime | None = None
    temporary_session: bool = True
    questions: list[dict] = []
    total_score: HifzTestTotalOut | None = None
    answered: int = 0


class HifzTestAnswerOut(BaseModel):
    question_id: UUID
    status: str
    score: float | None = None
    counts: dict[str, int] = {}
    peek_count: int = 0
    raw_events: list[dict] = []


class HifzTestPeekIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    word_index: int = Field(ge=0)


class HifzTestPeekOut(BaseModel):
    question_id: UUID
    word: str
    surah: int
    ayah: int
    word_index: int
    peek_count: int = 0


class HifzTestRemoveEventIn(BaseModel):
    removed: bool = True


class HifzTestRemoveEventOut(BaseModel):
    question_id: UUID
    event_index: int
    removed: bool = True
    score: float | None = None
    counts: dict[str, int] = {}
    peek_count: int = 0
    raw_events: list[dict] = []


class HifzVoiceSearchCandidateOut(BaseModel):
    surah: int
    ayah: int
    match_text: str | None = None
    score: float
    confidence: str
    matched_phoneme_chars: int | None = None


class HifzVoiceSearchOut(BaseModel):
    engine_used: str
    level: str
    candidates: list[HifzVoiceSearchCandidateOut] = []
    note: str = ""


class HifzMutashabihatOccurrenceOut(BaseModel):
    surah: int
    ayah: int
    text: str


class HifzMutashabihatGroupOut(BaseModel):
    phrase: str
    occurrences: list[HifzMutashabihatOccurrenceOut] = []


class HifzPlanIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = "memorize"
    direction: str = "normal"
    start_surah: int = Field(ge=1, le=114)
    start_ayah: int = Field(ge=1, le=286)
    end_surah: int = Field(ge=1, le=114)
    end_ayah: int = Field(ge=1, le=286)
    daily_target_new: int = Field(default=1, ge=0, le=100)
    daily_target_review: int = Field(default=5, ge=0, le=500)


class HifzPlanItemOut(BaseModel):
    id: UUID
    surah: int
    ayah: int
    position: int
    is_new: bool = True
    status: str = "pending"
    completed_at: datetime | None = None


class HifzPlanOut(BaseModel):
    id: UUID
    title: str
    kind: str
    direction: str
    start_surah: int
    start_ayah: int
    end_surah: int
    end_ayah: int
    daily_target_new: int = 1
    daily_target_review: int = 5
    status: str = "active"
    created_at: datetime
    updated_at: datetime | None = None
    completed_at: datetime | None = None
    total_ayahs: int = 0
    done_ayahs: int = 0
    items: list[HifzPlanItemOut] = []


class HifzPlanStatusIn(BaseModel):
    status: str


class HifzPlanItemStatusIn(BaseModel):
    status: str


class HifzReviewIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    quality: int | None = Field(default=None, ge=0, le=5)
    counts: dict[str, int] | None = None
    peek_count: int = Field(default=0, ge=0)


class HifzReviewOut(BaseModel):
    surah: int
    ayah: int
    quality: int | None = None
    repetitions: int = 0
    ease: float = 2.5
    interval_days: int = 0
    due_at: datetime | None = None
    params_version: int = 1


class HifzDueReviewOut(BaseModel):
    surah: int
    ayah: int
    due_at: datetime | None = None
    repetitions: int | None = None
    ease: float | None = None
    interval_days: int | None = None
    last_quality: int | None = None
    mistake_count: int | None = None
    last_activity_at: datetime | None = None
    source: str = "srs"


class HifzDashboardOut(BaseModel):
    attempts: int = 0
    graded_words: int = 0
    counts: HifzAttemptCounts = HifzAttemptCounts()
    errors_by_type: dict[str, int] = {}
    daily_series: list[dict] = []
    # گام ۴ برابری: رکورد پیوستگی و هدف روزانه (از فعالیت واقعی).
    streak_current: int = 0
    streak_best: int = 0
    goal_ayahs: int = 0
    goal_today_ayahs: int = 0
    goal_met: bool = False
    due_count: int = 0
    due_ayahs: list[dict] = []
    plans: list[HifzPlanOut] = []
    weakest_ayahs: list[dict] = []


class HifzSuggestedCardOut(BaseModel):
    surah: int
    ayah: int
    kind: str
    mistake_count: int = 0
    reason: str = ""


class HifzSuggestedOut(BaseModel):
    available: bool = False
    reason: str = ""
    detail: str = ""
    cards: list[HifzSuggestedCardOut] = []


class HifzTasmiIn(BaseModel):
    method: str
    variant: str = "standard"
    start_surah: int = Field(ge=1, le=114)
    start_ayah: int = Field(ge=1, le=286)
    end_surah: int = Field(ge=1, le=114)
    end_ayah: int = Field(ge=1, le=286)


class HifzTasmiActionIn(BaseModel):
    action: str
    rating: str | None = None
    reflection: str | None = None


class HifzTasmiOut(BaseModel):
    id: UUID
    method: str
    variant: str = "standard"
    start_surah: int
    start_ayah: int
    end_surah: int
    end_ayah: int
    state: dict = {}
    current: dict = {}
    self_assessed: bool = True
    reflection: str | None = None
    status: str = "active"
    created_at: datetime
    updated_at: datetime | None = None
    completed_at: datetime | None = None


# ---------------------------------------------------------------------------
# فاز ۴ — تنظیم‌های حفظِ هر کاربر، موقعیت نشست، برگهٔ خطاها (گروهی)
# ---------------------------------------------------------------------------


class HifzUserSettingsIn(BaseModel):
    """همهٔ فیلدها اختیاری‌اند؛ فقط فیلدهای فرستاده‌شده به‌روز می‌شوند."""

    freeze_on_error: bool | None = None
    mistake_detection: bool | None = None
    tashkeel_detection: bool | None = None
    resumable_sessions: bool | None = None
    hide_ayah_markers: bool | None = None
    # هدف روزانه به واحد آیه؛ ۰ یعنی هدفی تنظیم نشده (گام ۴).
    daily_goal_ayahs: int | None = Field(default=None, ge=0, le=6236)


class HifzUserSettingsOut(BaseModel):
    freeze_on_error: bool = False
    mistake_detection: bool = True
    tashkeel_detection: bool = True
    resumable_sessions: bool = False
    hide_ayah_markers: bool = False
    daily_goal_ayahs: int = 0
    updated_at: datetime | None = None


class HifzActivityDayOut(BaseModel):
    """یک روز فعالیت واقعی (مبنای UTC، مثل daily_series داشبورد)."""

    date: str
    attempts: int = 0
    graded_words: int = 0
    reviews: int = 0
    ayahs: int = 0


class HifzActivityOut(BaseModel):
    """فعالیت روزانه + رکورد پیوستگی + پیشرفت هدف (گام ۴ برابری).

    days فقط روزهای بازهٔ خواسته‌شده را دارد؛ رکوردها روی کل
    تاریخچهٔ فعالیت کاربر حساب می‌شوند، نه فقط بازهٔ نمایشی.
    """

    days: list[HifzActivityDayOut] = []
    streak_current: int = 0
    streak_best: int = 0
    goal_ayahs: int = 0
    today_ayahs: int = 0
    goal_met: bool = False


class HifzPositionIn(BaseModel):
    """آخرین موقعیتِ دنبال‌شدهٔ نشست (برای ازسرگیری پس از خروج)."""

    current_surah: int = Field(ge=1, le=114)
    current_ayah: int = Field(ge=1, le=286)
    current_word_index: int | None = Field(default=None, ge=0)


class HifzMistakeGroupItemOut(BaseModel):
    """یک خطا در کارت برگهٔ خطاها: موردانتظار (سبز) در برابر خوانده‌شده (قرمز)."""

    id: UUID
    mistake_type: str
    word_index: int | None = None
    expected_text: str
    heard: str | None = None
    created_at: datetime


class HifzMistakeGroupOut(BaseModel):
    """یک کارت برگهٔ خطاها برای یک آیه: برچسب «سوره:آیه» + دسته."""

    surah: int
    ayah: int
    category: str  # wrong_words | extra_words
    items: list[HifzMistakeGroupItemOut] = []


# ---------------------------------------------------------------------------
# حذف یک‌جای دادهٔ حفظ (P1-5) — فقط دامن��ٔ hifz_only.
# ---------------------------------------------------------------------------


class HifzDataPurgeIn(BaseModel):
    """ورودی purge: فقط تأیید صریح + کلید یکتایی.

    `extra="forbid"`: هیچ فیلد دیگری پذیرفته نمی‌شود — نه `user_id`
    (IDOR از اساس ناممکن است) و نه `scope` (دامنهٔ quran_all ساخته
    نشده است؛ فرستادنش ۴۲۲ می‌گیرد).
    """

    model_config = ConfigDict(extra="forbid")

    confirm: bool = False
    idempotency_key: UUID


class HifzDataPreviewOut(BaseModel):
    """پیش‌نمایش حذف: تعداد ردیف به‌تفکیک جدول — بدون هیچ محتوا."""

    scope: str = "hifz_only"
    counts: dict[str, int]
    total: int = 0


class HifzDataPurgeOut(BaseModel):
    """نتیجهٔ purge: تعداد حذف‌شده به‌تفکیک جدول."""

    scope: str = "hifz_only"
    deleted: dict[str, int]
    total: int = 0
