"""اسکیماهای Pydantic فاز ۶ — OpenAPI خودکار از همین مدل‌ها (§۱)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# --- ask ---


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    session_id: UUID | None = None
    locale: Literal["fa", "ar", "en"] = "fa"
    top_k: int = Field(default=5, ge=1, le=10)


class CitationOut(BaseModel):
    chunk_id: UUID
    excerpt: str
    source_citation: dict | None = None
    topic_category: str | None = None
    madhab_scope: str | None = None
    score: float


class AskOut(BaseModel):
    session_id: UUID
    answer: str | None = None
    # وضعیت پاسخ: answered | llm_unavailable | no_sources
    status: Literal["answered", "llm_unavailable", "no_sources"]
    citations: list[CitationOut] = []
    ai_label: str = "پاسخ تولیدشده با کمک هوش مصنوعی — مشورت با عالم توصیه می‌شود"
    model: str | None = None


# --- categories / compare ---


class CategoryOut(BaseModel):
    key: str
    count: int


class PositionOut(BaseModel):
    madhab: str
    position_text: dict
    evidence_refs: list | None = None


class CompareOut(BaseModel):
    topic_id: UUID
    title: dict
    description: dict | None = None
    positions: list[PositionOut]


# --- quiz ---


class QuizQuestionOut(BaseModel):
    id: UUID
    question_text: dict
    options: list
    difficulty: str
    source_citation: dict | None = None


class QuizGenerateOut(BaseModel):
    attempt_id: UUID
    questions: list[QuizQuestionOut]


class QuizSubmitIn(BaseModel):
    attempt_id: UUID
    answers: dict[str, int] = Field(description="{question_id: option_index}")


class QuizSubmitOut(BaseModel):
    score: float
    total: int
    correct: int
    details: list[dict]


# --- verify ---


class VerifyIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class VerifyOut(BaseModel):
    verdict: Literal["verified", "not_found", "conflicting"]
    matched: list[CitationOut] = []
    note: str


# --- admin: chunks ---


class ChunkCreateIn(BaseModel):
    chunk_text: str = Field(min_length=1)
    source_type: str = "manual"
    source_ref: dict | None = None
    source_citation: dict | None = None
    topic_category: str | None = None
    madhab_scope: str | None = None
    ai_scopes: list[str] = Field(default_factory=list)


class ChunkOut(BaseModel):
    id: UUID
    chunk_text: str
    source_type: str
    source_ref: dict | None = None
    source_citation: dict | None = None
    topic_category: str | None = None
    madhab_scope: str | None = None
    workflow_status: str
    ai_scopes: list[str]
    created_at: datetime


class ChunkStatusIn(BaseModel):
    status: Literal["draft", "in_review", "approved", "published", "rejected", "archived"]


# --- admin: topics / positions ---


class TopicCreateIn(BaseModel):
    title: dict
    description: dict | None = None
    # فهرست وردپرسی فتوا — دسته فقط از دسته‌های ثبت‌شده انتخاب می‌شود.
    category_id: UUID | None = None
    author_name: str | None = Field(default=None, max_length=160)
    featured_image_url: str | None = Field(default=None, max_length=1024)


class TopicUpdateIn(BaseModel):
    """ویرایش موضوع — دقیقاً همان فیلدهایی که CRM با PUT می‌فرستد."""

    title: dict
    description: dict | None = None
    category_id: UUID | None = None
    author_name: str | None = Field(default=None, max_length=160)
    featured_image_url: str | None = Field(default=None, max_length=1024)


class TopicOut(BaseModel):
    id: UUID
    title: dict
    description: dict | None = None
    workflow_status: str
    category_id: UUID | None = None
    author_name: str | None = None
    featured_image_url: str | None = None
    view_count: int = 0
    share_count: int = 0
    published_at: datetime | None = None


class CategoryIn(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    title: dict


class FatwaCategoryOut(BaseModel):
    id: UUID
    slug: str
    title: dict
    created_at: datetime


class CategoryWithCountOut(FatwaCategoryOut):
    published_count: int = 0


# --- public: فهرست وردپرسی فتوا (فقط منتشرشده‌ها) ---


class PublicTopicCategoryOut(BaseModel):
    slug: str
    title: dict


class PublicTopicOut(BaseModel):
    id: UUID
    title: dict
    description: dict | None = None
    category: PublicTopicCategoryOut | None = None
    author_name: str | None = None
    featured_image_url: str | None = None
    published_at: datetime | None = None
    view_count: int = 0
    share_count: int = 0


class PublicTopicListOut(BaseModel):
    items: list[PublicTopicOut]
    total: int
    page: int
    per_page: int
    pages: int


class PublicTopicDetailOut(PublicTopicOut):
    positions: list[PositionOut] = []


class ShareOut(BaseModel):
    id: UUID
    share_count: int


class PositionCreateIn(BaseModel):
    # در مسیر تخت /positions، topic_id از body می‌آید؛ در مسیر تودرتوی
    # /topics/{topic_id}/positions از path (در صورت هر دو، path مقدم است).
    topic_id: UUID | None = None
    madhab: Literal["hanafi", "maliki", "shafii", "hanbali"]
    position_text: dict
    evidence_refs: list | None = None


# --- admin: ingestion ---


class IngestTriggerIn(BaseModel):
    source_type: Literal["text", "file"]
    payload: dict
    topic_category: str | None = None
    madhab_scope: str | None = None
    ai_scopes: list[str] = Field(default_factory=list)
    source_citation: dict | None = None


class IngestTriggerOut(BaseModel):
    run_id: UUID
    status: str


class IngestionRunOut(BaseModel):
    id: UUID
    source_type: str
    status: str
    stats: dict
    started_at: datetime | None = None
    finished_at: datetime | None = None


# --- admin: trusted sources ---


class TrustedSourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    base_url: str = Field(min_length=1, max_length=512)
    enabled: bool = False
    allowed_paths: list[str] = Field(default_factory=list)
    priority: int = 0
    citation_required: bool = True


class TrustedSourceOut(BaseModel):
    id: UUID
    name: str
    base_url: str
    domain: str | None = None
    enabled: bool
    allowed_paths: list[str]
    priority: int
    citation_required: bool
    last_checked_at: datetime | None = None


# --- admin: quiz question ---


class QuizQuestionCreateIn(BaseModel):
    question_text: dict
    options: list[dict] = Field(min_length=2)
    correct_option: int = Field(ge=0)
    source_chunk_id: UUID
    difficulty: Literal["easy", "medium", "hard"] = "medium"


# --- admin: audit list ---


class AuditEntryOut(BaseModel):
    id: UUID
    actor_id: UUID | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    created_at: datetime
