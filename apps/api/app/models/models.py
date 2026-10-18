"""همهٔ مدل‌های دیتابیس — فاز ۱.

قراردادهای رعایت‌شده (فاز ۰):
- §۲: جدول users هیچ ستون role ندارد — RBAC فقط از طریق user_roles.
- §۴: domain_events با event_id (pk) جدا از idempotency_key.
- §۱۴: audit_logs هرگز secret نگه نمی‌دارد (در app/core/audit.py اسکراب می‌شود).
- نوع ستون‌ها Postgres-سازگار است: Uuid و JSON (روی PostgreSQL به JSONB رندر می‌شود).
- زمان‌ها همیشه UTC.

قرارداد LocalizedText: هر متن قابل‌مشاهدهٔ کاربر به‌صورت JSONB با شکل
{"fa": str, "ar": str, "en": str} ذخیره می‌شود — هرگز هاردکد در کد (فاز ۰ §۱۵).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy import JSON as SA_JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


# JSONB روی PostgreSQL، JSON روی SQLite — همان ستون، بدون تغییر کد.
JSONB = SA_JSON


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    full_name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    locale: Mapped[str] = mapped_column(String(8), default="fa")
    avatar_media_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("media_assets.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # سکرت TOTP — رمزنگاری‌شده (envelope فاز ۰ §۳) به‌صورت رشتهٔ JSON، نه plaintext
    totp_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(64), unique=True)  # مثل super_admin
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(128), unique=True)  # مثل fatwa.approve
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("roles.id"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("permissions.id"), primary_key=True
    )


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("roles.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    device_info: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("sessions.id"), nullable=True
    )
    # فقط هش SHA256 توکن ذخیره می‌شود، هرگز خودِ توکن
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    rotated_from: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    purpose: Mapped[str] = mapped_column(String(32), default="reset")  # reset | email_verify
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class PhoneVerificationCode(Base):
    __tablename__ = "phone_verification_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    phone: Mapped[str] = mapped_column(String(32))
    code_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RecoveryCode(Base):
    """کدهای بازیابی 2FA — فقط هش ذخیره می‌شود، یک‌بارمصرف."""

    __tablename__ = "recovery_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "channel", "notif_type"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    channel: Mapped[str] = mapped_column(String(16))  # email | sms | push | in_app
    notif_type: Mapped[str] = mapped_column(String(64))  # security | product | marketing
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class UserConsent(Base):
    """رضایت صریح کاربر — GDPR از روز اول (فاز ۱)."""

    __tablename__ = "user_consent"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    consent_type: Mapped[str] = mapped_column(String(32))  # terms | privacy | cookies | marketing
    text_version: Mapped[str] = mapped_column(String(16))
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(32))  # image | audio | video | video_360 | pdf | doc
    storage_key: Mapped[str] = mapped_column(String(512))
    thumbnail_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    visibility: Mapped[str] = mapped_column(String(16), default="public")  # public | private
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Theme(Base):
    __tablename__ = "themes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class AuditLog(Base):
    """فاز ۰ §۱۴ — secretها قبل از ذخیره اسکراب می‌شوند (app/core/audit.py)."""

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    actor_type: Mapped[str] = mapped_column(String(32))  # user | admin | system
    action: Mapped[str] = mapped_column(String(128))
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    old_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class DomainEvent(Base):
    """الگوی outbox — فاز ۰ §۴. event_id هویت رویداد؛ idempotency_key مال command مبدأ."""

    __tablename__ = "domain_events"

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(128), unique=True, nullable=True
    )
    aggregate_type: Mapped[str] = mapped_column(String(64))
    aggregate_id: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[str] = mapped_column(String(128), index=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    source_client: Mapped[str] = mapped_column(String(64), default="api")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HomeSection(Base):
    """بخش‌های صفحهٔ خانه — فاز ۳.

    چیدمان و نمایش خانه بدون FK به جدول‌های ماژول‌های آینده (§۹.۵: no future-FK coupling):
    هر بخش فقط یک `key` پایدار دارد که فرانت‌اند/ماژول‌های بعدی روی آن سوئیچ می‌کنند.
    متن‌های قابل‌مشاهده LocalizedText هستند (§۱۵.۴)؛ data ساخت‌یافتهٔ هر بخش است
    (برای بخش‌هایی که ماژول‌شان هنوز نیست: data=null + empty_title/empty_hint).
    """

    __tablename__ = "home_sections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText {"fa","ar","en"}
    subtitle: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # دادهٔ ساخت‌یافتهٔ بخش
    empty_title: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    empty_hint: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class PlatformSetting(Base):
    """value رمزنگاری‌شده با envelope نسخه‌دار فاز ۰ §۳ — هرگز plaintext."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)  # {"v": key_version, "data": "<fernet token>"}
    encryption_key_version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


# ---------------------------------------------------------------------------
# فاز ۴ — CMS + تقویم اسلامی (قرارداد §۹.۵)
#
# - همهٔ جدول‌های قابل‌انتشار: workflow_status طبق ماشین مشترک §۹
#   (پیاده‌سازی در app/core/workflow.py) + version (خوش‌بینی) + created_by.
# - distribution: JSONB {"web","mobile","desktop","telegram","ai_knowledge"} —
#   تاگل مستقل هر surface (§۹.۵). پیش‌فرض‌ها را لایهٔ service اعمال می‌کند:
#   هنگام انتشار web=true و بقیه false.
# - nav_items وضعیت گردش‌کار ندارد: نمایش با visible + پنجرهٔ زمانی کنترل می‌شود.
# ---------------------------------------------------------------------------


class _PublishableMixin:
    """ستون‌های مشترک همهٔ موجودیت‌های قابل‌انتشار CMS."""

    workflow_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    distribution: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class IslamicEvent(Base, _PublishableMixin):
    """رویداد تقویم اسلامی — فاز ۴.

    اتصال به theme_id یعنی «وقتی این رویداد فعال است، تم پلتفرم عوض شود»؛
    کرون روزانه (calendar_tasks) فعال‌سازی/بازگشت را انجام می‌دهد.
    """

    __tablename__ = "islamic_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    hijri_month: Mapped[int] = mapped_column(Integer, index=True)
    hijri_day: Mapped[int] = mapped_column(Integer, index=True)
    recurring: Mapped[bool] = mapped_column(Boolean, default=True)
    theme_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("themes.id"), nullable=True
    )
    auto_publish: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_admin_confirmation: Mapped[bool] = mapped_column(Boolean, default=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class ScholarQuote(Base, _PublishableMixin):
    """نقل‌قول علما — placements لیست surfaceهاست (مثل ["homepage","scholar_profile"])."""

    __tablename__ = "scholar_quotes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    text: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    scholar: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    source: Mapped[str | None] = mapped_column(String(512), nullable=True)
    quote_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    placements: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class Page(Base, _PublishableMixin):
    """صفحهٔ CMS — blocks لیست بلاک‌های ویرایشگر دیداری (GrapesJS)؛
    content_type یکی از page | article | faq است و روی وب schema.org را می‌سازد."""

    __tablename__ = "pages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    blocks: Mapped[list] = mapped_column(JSONB, default=list)  # بلاک‌های ویرایشگر
    seo_meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_type: Mapped[str] = mapped_column(String(16), default="page", index=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class NavItem(Base):
    """آیتم ناوبری — درخت با parent_id؛ ترتیب با sort_order؛
    locale=null یعنی همهٔ زبان‌ها. نمایش = visible و درون پنجرهٔ زمانی."""

    __tablename__ = "nav_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    label: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("nav_items.id"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    locale: Mapped[str | None] = mapped_column(String(8), nullable=True)
    link_type: Mapped[str] = mapped_column(String(16), default="internal")
    url: Mapped[str] = mapped_column(String(1024))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class Banner(Base, _PublishableMixin):
    """بنر تبلیغاتی/اطلاع‌رسانی — placement مثل homepage؛ اولویت با priority."""

    __tablename__ = "banners"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    subtitle: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    media: Mapped[dict] = mapped_column(
        JSONB, default=dict
    )  # {"type": "image"|"video", "url": ..., "variants"?: {...}}
    cta: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )  # {"text": LocalizedText, "url": ...}
    placement: Mapped[str] = mapped_column(String(64), default="homepage", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0, index=True)
    audience: Mapped[dict] = mapped_column(JSONB, default=dict)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class Announcement(Base):
    """اعلان سراسری/جایگاهی — قابل بستن بودن با dismissible."""

    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    workflow_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    message: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    dismissible: Mapped[bool] = mapped_column(Boolean, default=True)
    audience: Mapped[dict] = mapped_column(JSONB, default=dict)
    placement: Mapped[str] = mapped_column(String(64), default="global", index=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    distribution: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
