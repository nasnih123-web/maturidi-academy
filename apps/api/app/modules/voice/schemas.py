"""اسکیماهای دستیار صوتی — فاز ۱۲ (Pydantic v2، OpenAPI خودکار)."""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class TranscribeOut(BaseModel):
    text: str
    language: str
    duration_s: float
    stt_ms: int
    provider: str


class AyahOut(BaseModel):
    surah: int
    ayah: int
    surah_label: str
    text_ar: str | None = None
    translation: str | None = None
    translation_edition: str | None = None


class CitationOut(BaseModel):
    chunk_id: str
    excerpt: str
    source_citation: str | None = None
    topic_category: str | None = None
    madhab_scope: str | None = None
    score: float | None = None


class AskOut(BaseModel):
    intent: Literal["quran", "fatwa", "general"]
    lang: Literal["fa", "ar"]
    text: str
    transcript: str | None = None
    audio_kind: Literal["recitation", "tts", "none"]
    audio_url: str | None = None
    audio_base64: str | None = None
    audio_mime: str | None = None
    notice: str | None = None
    ayah: AyahOut | None = None
    citations: list[CitationOut] = Field(default_factory=list)
    fatwa_status: str | None = None
    stt_provider: str | None = None
    session_id: UUID


class VoiceSettingsOut(BaseModel):
    settings: dict[str, Any]


class VoiceSettingsUpdate(BaseModel):
    settings: dict[str, Any]


class VoiceSettingsUpdateOut(BaseModel):
    updated: list[str]


class UsageLogOut(BaseModel):
    id: UUID
    session_id: UUID
    intent: str
    lang: str
    stt_ms: int | None = None
    tts_provider: str | None = None
    created_at: str


class UsageLogPage(BaseModel):
    items: list[UsageLogOut]
    next_cursor: str | None = None
