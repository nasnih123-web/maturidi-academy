"""اسکیماهای Pydantic حفاظ — فاز ۳ قرآن (record-then-grade).

صوت هرگز در هیچ پاسخی نمی‌آید: فقط نمره‌ها، خطاها و شمارش‌ها.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class HifzAttemptIn(BaseModel):
    surah: int = Field(ge=1, le=114)
    page: int | None = Field(default=None, ge=1, le=604)


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
    surah: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    word_index: int = Field(ge=0)


class HifzPeekOut(BaseModel):
    mistake_id: UUID
    surah: int
    ayah: int
    word_index: int
    word: str


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
