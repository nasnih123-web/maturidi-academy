"""اسکیماهای پنل مؤلفین فتوا و تجمیع سوالات — فاز ۱۰."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.home.schemas import LocalizedText

# ---------------------------------------------------------------------------
# ثبت فتوا
# ---------------------------------------------------------------------------


class SubmissionCreate(BaseModel):
    title: LocalizedText
    body: str = Field(min_length=1, max_length=20000)
    madhab: str | None = Field(default=None, max_length=16)
    evidence: str | None = Field(default=None, max_length=20000)


class SubmissionOut(BaseModel):
    id: UUID
    title: LocalizedText
    body: str
    madhab: str | None
    evidence: str | None
    author_id: UUID
    workflow_status: str
    version: int
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SubmissionPage(BaseModel):
    items: list[SubmissionOut]
    next_cursor: str | None = None


class RejectBody(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class ChunkRef(BaseModel):
    chunk_id: UUID


# ---------------------------------------------------------------------------
# خوشه‌های سوال
# ---------------------------------------------------------------------------


class QuestionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    source: Literal["chat", "direct"] = "direct"


class QuestionSuggestion(BaseModel):
    answer: str
    answered_at: datetime | None


class QuestionOut(BaseModel):
    cluster_id: UUID
    matched: bool
    similarity: float | None
    suggestion: QuestionSuggestion | None = None


class ClusterMemberOut(BaseModel):
    id: UUID
    question_text: str
    user_id: UUID
    source: str
    created_at: datetime


class ClusterOut(BaseModel):
    id: UUID
    representative_question: str
    status: str
    answer: str | None
    answered_by: UUID | None
    answered_at: datetime | None
    member_count: int
    members: list[ClusterMemberOut] = []
    created_at: datetime


class ClusterPage(BaseModel):
    items: list[ClusterOut]
    next_cursor: str | None = None


class ClusterAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=20000)


class ClusterAnswerOut(BaseModel):
    id: UUID
    status: str
    answer: str
    answered_at: datetime | None
    notified_count: int
