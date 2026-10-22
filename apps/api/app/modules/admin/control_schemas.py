"""اسکیماهای Pydantic فاز ۱۴ — کنترل مرکزی ادمین.

OpenAPI خودکار از FastAPI + Pydantic v2 (§۱)؛ هیچ اسکیمای دستی نوشته نمی‌شود.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# صندوق واحد محتوا
# ---------------------------------------------------------------------------


class ContentItemRef(BaseModel):
    domain: str
    content_type: str
    id: str


class ContentItemOut(BaseModel):
    domain: str
    content_type: str
    id: str
    title: str
    excerpt: str | None = None
    status: str
    author_id: str | None = None
    author_name: str | None = None
    visibility: str | None = None
    ai_scopes: list[str] = []
    version: int | None = None
    created_at: str | None = None
    updated_at: str | None = None
    published_at: str | None = None


class ContentListOut(BaseModel):
    items: list[ContentItemOut]
    next_cursor: str | None = None


class AdapterInfo(BaseModel):
    domain: str
    content_type: str
    label: str
    supports_transition: bool


class BulkActionIn(BaseModel):
    items: list[ContentItemRef] = Field(min_length=1, max_length=200)
    action: str  # transition | schedule | placement | distribution | export
    params: dict[str, Any] = {}


class BulkItemResult(BaseModel):
    domain: str
    content_type: str
    id: str
    ok: bool
    skipped: bool = False
    reason: str | None = None
    error: dict[str, Any] | None = None
    model_config = {"extra": "allow"}


class BulkActionOut(BaseModel):
    action: str
    total: int
    succeeded: int
    skipped: int
    failed: int
    results: list[BulkItemResult]
    export: list[dict[str, Any]] | None = None


class ContentDetailOut(BaseModel):
    domain: str
    content_type: str
    id: str
    preview: dict[str, Any]
    workflow: dict[str, Any]
    author: dict[str, Any]
    timestamps: dict[str, Any]
    visibility: str | None = None
    ai_scopes: list[str] = []
    placements: list[dict[str, Any]] = []
    distribution: dict[str, Any]
    schedules: list[dict[str, Any]] = []
    related: list[dict[str, Any]] = []
    versions: list[dict[str, Any]] = []
    seo: dict[str, Any] | None = None
    audit: list[dict[str, Any]] = []


class PlacementIn(BaseModel):
    domain: str
    content_type: str
    content_id: str
    surface: str
    slot: str | None = None
    sort_order: int = 0
    audience: dict[str, Any] = {}
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    locale: str | None = None
    active: bool = True


class PlacementOut(BaseModel):
    id: str
    domain: str
    content_type: str
    content_id: str
    surface: str
    slot: str | None = None
    sort_order: int
    audience: dict[str, Any]
    starts_at: str | None = None
    ends_at: str | None = None
    locale: str | None = None
    active: bool
    created_at: str


class DistributionSetIn(BaseModel):
    channel: str
    enabled: bool
    scheduled_at: datetime | None = None
    schedule_tz: str | None = None
    until_at: datetime | None = None


class DistributionOut(BaseModel):
    domain: str
    content_type: str
    id: str
    channels: dict[str, dict[str, Any]]


class CalendarOut(BaseModel):
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# اتصالات بیرونی
# ---------------------------------------------------------------------------


class ConnectionStatusOut(BaseModel):
    model_config = {"extra": "allow"}


class ConnectionTestIn(BaseModel):
    phone: str | None = None
    chat_id: str | None = None


class ConnectionTestOut(BaseModel):
    service: str
    ok: bool
    latency_ms: int
    tested_at: str
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# بیلدها
# ---------------------------------------------------------------------------


class BuildReleaseOut(BaseModel):
    id: str
    platform: str
    version: str
    build_number: str | None = None
    download_url: str | None = None
    download_expires_at: str | None = None
    # فایل واقعی بیلد در StorageProvider (B-01 — ADR-0025)
    has_file: bool = False
    artifact_key: str | None = None
    file_size_bytes: int | None = None
    sha256: str | None = None
    signed: bool
    build_metadata: dict[str, Any]
    created_at: str


class RebuildIn(BaseModel):
    platform: str
    version: str | None = None
    ref: str | None = None
    note: str | None = None
    # برندینگ بیلد (F-05 remediation) — اعتبارسنجی دامنه‌ای در builds_service
    app_name: str | None = None
    package_id: str | None = None
    version_code: int | None = None
    api_url: str | None = None
    environment: str | None = None


class BuildProviderFields(BaseModel):
    """فیلدهای ردیابی ارائه‌دهندهٔ بیلد — provider=None یعنی legacy/ارسال‌نشده."""

    branding: dict[str, Any] = {}
    provider: str | None = None
    provider_run_id: str | None = None
    provider_run_url: str | None = None
    artifact_name: str | None = None
    # نشانی Release پیش‌نویس مقصد — فقط وقتی درخواست با تگ (production +
    # نسخهٔ معتبر) dispatch شده باشد؛ وگرنه None (سیاست release_tag_for).
    release_url: str | None = None
    dispatched_at: str | None = None


class RebuildOut(BuildProviderFields):
    id: str
    platform: str
    version: str | None = None
    ref: str | None = None
    status: str
    signing_ready: bool
    missing_signing: list[str]
    note: str
    created_at: str


class BuildRequestOut(BuildProviderFields):
    id: str
    platform: str
    version: str | None = None
    ref: str | None = None
    status: str
    note: str | None = None
    created_at: str
    finished_at: str | None = None


class ReleaseCreateIn(BaseModel):
    platform: str
    version: str
    build_number: str | None = None
    download_url: str | None = None
    download_expires_at: datetime | None = None
    signed: bool = False
    build_metadata: dict[str, Any] = {}
    # فایل بیلدِ آپلودشده به باکت builds توسط workflow (B-01 — ADR-0025)
    artifact_key: str | None = None
    file_size_bytes: int | None = None
    sha256: str | None = None


class BuildPrereqsOut(BaseModel):
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# اعلان‌ها
# ---------------------------------------------------------------------------


class BroadcastIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    cohort: dict[str, Any] = {"type": "all"}
    channels: list[str] = Field(min_length=1)


class BroadcastOut(BaseModel):
    id: str
    title: str
    body: str
    cohort: dict[str, Any]
    channels_requested: list[str]
    status: str
    total_recipients: int
    total_sent: int
    total_skipped: int
    total_failed: int
    created_at: str
    finished_at: str | None = None
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# نمای ۳۶۰° کاربر
# ---------------------------------------------------------------------------


class UserOverviewOut(BaseModel):
    profile: dict[str, Any]
    roles: list[str]
    lms: dict[str, Any]
    library: dict[str, Any]
    social: dict[str, Any]
    fatwa: dict[str, Any]
    notifications: dict[str, Any]
    audit_trail: list[dict[str, Any]]
    generated_at: str


# ---------------------------------------------------------------------------
# نقش/مجوز
# ---------------------------------------------------------------------------


class PermissionOut(BaseModel):
    id: str
    key: str
    description: str | None = None


class RoleOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    permissions: list[PermissionOut]
    created_at: str
    model_config = {"extra": "allow"}


class RoleCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str | None = None
    permission_keys: list[str] = []


class RoleUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    description: str | None = None
    permission_keys: list[str] | None = None


class MessageOut(BaseModel):
    message: str


class TransitionIn(BaseModel):
    to: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=2000)


class ReorderPlacementsIn(BaseModel):
    ordered_ids: list[str] = Field(min_length=1, max_length=200)


class DistributionPolicyIn(BaseModel):
    policy: dict[str, bool] = Field(min_length=1)
    scheduled_at: datetime | None = None
    until_at: datetime | None = None


class AuditEntryOut(BaseModel):
    id: str
    actor_id: str | None = None
    actor_type: str
    action: str
    entity_type: str
    entity_id: str | None = None
    old_values: dict[str, Any] | None = None
    new_values: dict[str, Any] | None = None
    ip: str | None = None
    created_at: str | None = None


class AiSourceOut(BaseModel):
    domain: str
    content_type: str
    id: str
    title: str | None = None
    status: str | None = None
    author_id: str | None = None
    ai_scopes: list[str] = []
    updated_at: str | None = None
    reindex_supported: bool = False
