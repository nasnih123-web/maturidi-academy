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
from datetime import UTC, date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON as SA_JSON
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


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
    # آخرین گام زمانی TOTP مصرف‌شده (شمارندهٔ ۳۰ ثانیه‌ای) — ضد replay:
    # کدی که برای همین گام (یا قدیمی‌تر) قبلاً پذیرفته شده دوباره قبول نیست.
    # remediation-pass-2 Track 1 (§۵)
    totp_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # زمان فعال‌شدن فعلی TOTP (فاز ۲ — GET /2fa/status): با enable ست و با
    # disable/recover پاک می‌شود؛ مبنای enrolled_at در پاسخ status.
    totp_enabled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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


class WsTicket(Base):
    """بلیط یک‌بارمصرف اتصال WebSocket — hardening/audit-pass-1.

    جایگزین امن ارسال JWT بلندمدت در query string (که در لاگ‌ها/تاریخچهٔ
    مرورگر لو می‌رود): کلاینت با access token معتبر یک بلیط ۶۰ ثانیه‌ای
    می‌گیرد و فقط همان را در `?ticket=` می‌فرستد. مصرف اتمیک:
    UPDATE ... WHERE used_at IS NULL — استفادهٔ مجدد رد می‌شود.
    فقط هش بلیط ذخیره می‌شود، هرگز خودِ بلیط.
    """

    __tablename__ = "ws_tickets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    # گره‌خوردن به نشست صادرکننده (nullable برای سازگاری عقب‌رو): اگر نشست
    # باطل شده باشد، بلیطِ هنوزمصرف‌نشده هم مرده است. remediation-pass-2 Track 1
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("sessions.id"), nullable=True
    )
    ticket_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "channel", "notif_type"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    channel: Mapped[str] = mapped_column(String(16))  # email | sms | push | web_push | in_app
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
    # claim توزیع‌شدهٔ dispatcher (M-04 — ADR-0035): کدام worker و کی
    # این رویداد را گرفته؛ claim کهنه‌تر از TTL قابل‌گرفتنِ مجدد است.
    claimed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # Pass 4 / C1: زمان آخرین تلاش ناموفق — مبنای backoff نمایی.
    # قبلاً backoff به created_at گره خورده بود: رویداد قدیمیِ بازپس‌گرفته
    # در همان ثانیه‌های اول outage چند بار retry و dead-letter می‌شد و
    # سقف ۳۰۰ ثانیه‌ای هیچ‌وقت قابل‌دسترس نبود (dead-letter در ۳۲ ثانیه).
    # NULL یعنی «هنوز تلاش ناموفقی نبوده» → مبنا created_at است.
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


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


# ---------------------------------------------------------------------------
# فاز ۵ — قرآن / تسبیح دیجیتال (Track 1 — بک‌اند)
# ---------------------------------------------------------------------------


class UserAyahNote(Base):
    """یادداشت کاربر روی یک آیه — حریم خصوصی با owner-scoped کوئری در سرویس.

    هیچ workflow_status ندارد: یادداشت دادهٔ کاربر است، نه محتوای قابل‌انتشار (§۹).
    """

    __tablename__ = "user_ayah_notes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    surah: Mapped[int] = mapped_column(Integer, index=True)
    ayah: Mapped[int] = mapped_column(Integer, index=True)
    note_text: Mapped[str] = mapped_column(Text)
    is_private: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # فاز ۱۳ (ADR-0010): نسخهٔ خوش‌بینانه برای sync آفلاین
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=True
    )


class DhikrSession(Base):
    """نشست تسبیح دیجیتال — شمارش ذکر در یک بازهٔ زمانی."""

    __tablename__ = "dhikr_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    dhikr_text: Mapped[str] = mapped_column(String(255))
    target_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DhikrDailyCount(Base):
    """تجمیع روزانهٔ ذکر به‌ازای کاربر/تاریخ/متن ذکر — سه‌تایی یکتا."""

    __tablename__ = "dhikr_daily_counts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    dhikr_text: Mapped[str] = mapped_column(String(255))
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    # فاز ۱۳ (ADR-0010): نسخهٔ خوش‌بینانه برای sync آفلاین
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "date", "dhikr_text",
            name="uq_dhikr_daily_counts_user_date_dhikr",
        ),
    )


# ---------------------------------------------------------------------------
# فاز ۶ — موتور فتوای هوشمند (RAG)، مقایسهٔ مذاهب، آزمون، راستی‌آزمایی.
#
# قراردادها:
# - §۹: workflow_status ماشین مشترک؛ RAG فقط approved/published را می‌خواند.
# - §۹.۵: هیچ FK فیزیکی به جدول فازهای آینده — اتصال به library_items
#   فقط با source_ref/source_library_item_ref (رشته) تا migration فاز ۹.
# - §۹.۶/§۱۵.۵: هیچ قاعدهٔ فقهی در کد/seed ساخته نمی‌شود؛ seed فقط
#   نقل‌قول‌های verbatim موجود در ریپو را با استناد واقعی کپی می‌کند.
# ---------------------------------------------------------------------------


class FiqhKnowledgeChunk(Base):
    """واحد دانش فقهیِ chunkشده — ورودی RAG.

    embedding: بردار به‌صورت JSON — منبع سازگاری و مسیر SQLite (Backend B).
    embedding_vec: ستون برداری واقعی روی PostgreSQL (B-03 — ADR-0026؛
    مهاجرت d2e4… اکستنشن vector + بک‌فیل از JSON + ایندکس HNSW را
    می‌سازد) — بازیابی معنایی روی PG کاملاً داخل دیتابیس انجام می‌شود
    و ingestion هنگام نوشتن، هر دو ستون را پر می‌کند. بُعد ۲۵۶ =
    EMBEDDING_DIM در modules/fatwa/embeddings.py.
    """

    __tablename__ = "fiqh_knowledge_chunks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    embedding_vec: Mapped[list | None] = mapped_column(Vector(256), nullable=True)
    # هویت provider/model سازندهٔ بردار (FIX2-03 — ADR-0042)؛ NULL یعنی
    # ردیف legacy پیش از ثبت هویت → در وضعیت جست‌وجو نیازمند reindex
    # شمرده می‌شود. بازیابی، بردار provider دیگر را قاطی نمی‌کند.
    embedding_provider: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True
    )
    embedding_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # هویت پروجکشن سازندهٔ بردار (FIX3-04 — ADR-0051)؛ مثل
    # «folding-v1» (fit_dim فعلی). NULL یعنی ردیف legacy پیش از ثبت
    # پروجکشن → در گزارش سازگاری ناسازگار و نیازمند reindex شمرده
    # می‌شود، چون بردارهای پیش از FIX2-03 با برش ساده ساخته شده‌اند.
    embedding_projection: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )
    source_type: Mapped[str] = mapped_column(String(32), default="manual", index=True)
    source_ref: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )  # {type, id, version} — ردیابی provenance، بدون FK (§۹.۵)
    source_library_item_ref: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )  # رزرو فاز ۹ — فعلاً همیشه null
    source_citation: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )  # LocalizedText: نام کتاب/اثر برای نمایش به کاربر
    topic_category: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    madhab_scope: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    workflow_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    ai_scopes: Mapped[list] = mapped_column(
        JSONB, default=list
    )  # زیرمجموعهٔ fatwa|assistant|quiz|verification|semantic_search
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class FiqhTopic(Base):
    """موضوع فقهی برای مقایسهٔ مذاهب."""

    __tablename__ = "fiqh_topics"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    workflow_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    # فهرست وردپرسی فتوا — دسته از بخش «ثبت دسته‌بندی» CRM می‌آید.
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("fatwa_categories.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    author_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    featured_image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    share_count: Mapped[int] = mapped_column(Integer, default=0)
    # موقع ورود به وضعیت published ثبت می‌شود؛ با بایگانی پاک نمی‌شود.
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class FatwaCategory(Base):
    """دستهٔ فتوا — در CRM تعریف می‌شود و در فرم ثبت انتخاب می‌شود."""

    __tablename__ = "fatwa_categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class MadhabPosition(Base):
    """موضع یک مذهب دربارهٔ یک موضوع — متن فقط از منابع واقعی."""

    __tablename__ = "madhab_positions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    topic_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("fiqh_topics.id", ondelete="CASCADE"), index=True
    )
    madhab: Mapped[str] = mapped_column(
        String(16), index=True
    )  # hanafi|maliki|shafii|hanbali
    position_text: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    evidence_refs: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    workflow_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FatwaSession(Base):
    """نشست گفتگوی فتوا — user_id خالی یعنی ask عمومی ناشناس."""

    __tablename__ = "fatwa_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    locale: Mapped[str] = mapped_column(String(8), default="fa")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FatwaMessage(Base):
    """پیام‌های یک نشست — نقش: user | assistant | system_note."""

    __tablename__ = "fatwa_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("fatwa_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class QuizQuestion(Base):
    """سؤال آزمون شرعی — فقط ریشه‌دار در chunk تأییدشده (ADR-0005)."""

    __tablename__ = "quiz_questions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    question_text: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    options: Mapped[list] = mapped_column(JSONB)  # لیست LocalizedText
    correct_option: Mapped[int] = mapped_column(Integer, nullable=False)
    source_chunk_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("fiqh_knowledge_chunks.id", ondelete="CASCADE"), index=True
    )
    difficulty: Mapped[str] = mapped_column(String(16), default="medium")
    workflow_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class QuizAttempt(Base):
    """تلاش کاربر در آزمون."""

    __tablename__ = "quiz_attempts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    # فاز ۸: پیوند به درس LMS (nullable — تلاش‌های قدیمی فتوا lesson_id ندارند).
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("lessons.id"), nullable=True, index=True
    )
    question_ids: Mapped[list] = mapped_column(JSONB)
    answers: Mapped[dict] = mapped_column(JSONB)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class VerificationCheck(Base):
    """راستی‌آزمایی محتوای پیست‌شده علیه دانش منتشرشده."""

    __tablename__ = "verification_checks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    input_hash: Mapped[str] = mapped_column(String(64), index=True)
    input_excerpt: Mapped[str] = mapped_column(String(512))
    verdict: Mapped[str] = mapped_column(String(16), index=True)
    matched_chunk_ids: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class TrustedExternalSource(Base):
    """منابع خارجی مورداعتماد — فقط super_admin (§۹.۶)."""

    __tablename__ = "trusted_external_sources"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    allowed_paths: Mapped[list] = mapped_column(JSONB, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    citation_required: Mapped[bool] = mapped_column(Boolean, default=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class AIProviderConfig(Base):
    """پیکربندی providerهای AI — مدل/نسخه/fallback."""

    __tablename__ = "ai_provider_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        UniqueConstraint("provider", "model", name="uq_ai_provider_configs_provider_model"),
    )


class AIUsageLog(Base):
    """لاگ مصرف token/هزینه به‌ازای کاربر (§۱۰)."""

    __tablename__ = "ai_usage_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    endpoint: Mapped[str] = mapped_column(String(64), index=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_estimate: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class IngestionRun(Base):
    """اجرای pipeline درون‌ریزی دانش."""

    __tablename__ = "ingestion_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    source_type: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(
        String(16), default="queued", index=True
    )  # queued|running|done|failed
    stats: Mapped[dict] = mapped_column(JSONB, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


# ---------------------------------------------------------------------------
# فاز ۷ — ماشین‌حساب ارث و زکات.
#
# قانون سخت (§۱۵.۵ و هشدار فاز ۷ در spec): جدول‌های فرائض/ارث و نصاب/نرخ
# زکات هر مذهب هرگز از دانش عمومی ایجنت هاردکد نمی‌شوند. همهٔ اعداد فقط
# از طریق rule_configs نسخه‌بندی‌شده و تأییدشدهٔ عالم وارد سیستم می‌شوند.
# تا زمانی که هیچ config تأییدشده‌ای وجود ندارد، محاسبهٔ عمومی با خطای
# rules_not_approved برمی‌گردد (نه حدس، نه جدول پیش‌فرض).
# ---------------------------------------------------------------------------


class _RuleConfigMixin:
    """فیلدهای مشترک نسخه‌بندی/تأیید rule_configs (§۹.۵ قرارداد محتوا)."""

    source: Mapped[str] = mapped_column(String(256))
    version: Mapped[int] = mapped_column(Integer, default=1)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    effective_to: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # draft | pending_review | approved | rejected  (گردش‌کار §۹)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class InheritanceRuleConfig(Base, _RuleConfigMixin):
    """پیکربندی قواعد ارث (فرائض) — به‌ازای هر مذهب، نسخه‌بندی‌شده.

    rule_data ساختار قراردادی دارد که موتور engine.py اجرایش می‌کند؛
    کلیدها و اعدادش فقط توسط عالم مجاز وارد می‌شود (§۱۵.۵).
    """

    __tablename__ = "inheritance_rule_configs"
    __table_args__ = (
        UniqueConstraint("madhab", "version", name="uq_inh_rule_madhab_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    madhab: Mapped[str] = mapped_column(String(16), index=True)
    rule_data: Mapped[dict] = mapped_column(JSONB, default=dict)


class InheritanceCase(Base):
    """یک محاسبهٔ ارث انجام‌شده (تاریخچهٔ کاربر/عمومی)."""

    __tablename__ = "inheritance_cases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    estate_value: Mapped[float] = mapped_column(Numeric(20, 4))
    madhab: Mapped[str] = mapped_column(String(16), index=True)
    heirs: Mapped[list] = mapped_column(JSONB, default=list)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    rule_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("inheritance_rule_configs.id"), nullable=True
    )
    # قرارداد §۱: هدر Idempotency-Key برای نوشتن‌های مالی — تکرار کلید
    # همان case را برمی‌گرداند، نه case تازه.
    idempotency_key: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class ZakatRuleConfig(Base, _RuleConfigMixin):
    """پیکربندی قواعد زکات — نسخه‌بندی‌شده (مشترک همهٔ مذاهب، مگر در
    rule_data تفکیک شده باشد). asset_categories دسته‌های دارایی و
    نرخ‌ها را مشخص می‌کند — بدون هیچ عدد پیش‌فرض هاردکد."""

    __tablename__ = "zakat_rule_configs"
    __table_args__ = (
        UniqueConstraint("version", name="uq_zakat_rule_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    madhab: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    rule_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    asset_categories: Mapped[dict] = mapped_column(JSONB, default=dict)


class ZakatCalculation(Base):
    """یک محاسبهٔ زکات انجام‌شده — به‌همراه snapshot نرخ نصاب لحظهٔ محاسبه."""

    __tablename__ = "zakat_calculations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    inputs: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    nisab_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    rule_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("zakat_rule_configs.id"), nullable=True
    )
    idempotency_key: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class NisabPriceCache(Base):
    """کش نرخ‌های نصاب (طلا/نقره) — هر رکورد یک منبع قیمتی.

    fetched_at لحظهٔ آخرین fetch موفق است؛ استال‌بودن در سرویس (نه در DB)
    از روی TTL محاسبه می‌شود و در پاسخ API با پرچم stale افشا می‌گردد.
    """

    __tablename__ = "nisab_price_cache"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    gold_per_gram: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    silver_per_gram: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


# ---------------------------------------------------------------------------
# فاز ۸ — LMS (پیشخوان یادگیری طلاب) — قراردادها در ADR-0006
# ---------------------------------------------------------------------------


class Curriculum(Base):
    """برنامهٔ درسی — دستهٔ سطح‌بالای دوره‌ها (LocalizedText)."""

    __tablename__ = "curricula"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText {"fa","ar","en"}
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Course(Base):
    """دورهٔ آموزشی — سطح beginner/intermediate/advanced."""

    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    curriculum_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("curricula.id"), nullable=True, index=True
    )
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    level: Mapped[str] = mapped_column(String(16), default="beginner", index=True)
    visibility: Mapped[str] = mapped_column(String(16), default="public")  # public|private
    thumbnail_media_ref: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Lesson(Base):
    """درس — body لیست بلاک‌های محتوایی (ارجاع به محتوای تأییدشده، نه کپی)."""

    __tablename__ = "lessons"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("courses.id"), index=True
    )
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    body: Mapped[list] = mapped_column(JSONB, default=list)  # content blocks
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_free_preview: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class UserProgress(Base):
    """پیشرفت کاربر روی هر درس — یکتا به‌ازای (user_id, lesson_id)."""

    __tablename__ = "user_progress"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("lessons.id"), index=True
    )
    status: Mapped[str] = mapped_column(
        String(16), default="not_started"
    )  # not_started|in_progress|completed
    position_seconds: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
    # فاز ۱۳ (ADR-0010): نسخهٔ خوش‌بینانه برای sync آفلاین
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "lesson_id", name="uq_user_progress_user_lesson"),
    )


class Certificate(Base):
    """گواهی پایان دوره — کد یکتا برای استعلام عمومی."""

    __tablename__ = "certificates"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("courses.id"), index=True
    )
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    pdf_storage_ref: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    locale: Mapped[str] = mapped_column(String(8), default="fa")


class CourseCohort(Base):
    """دورهٔ هم‌گروهی (کلاس زنده) — پنجرهٔ ثبت‌نام با ظرفیت."""

    __tablename__ = "course_cohorts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("courses.id"), index=True
    )
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    max_seats: Mapped[int] = mapped_column(Integer, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class CohortEnrollment(Base):
    """ثبت‌نام کاربر در هم‌گروهی — یکتا به‌ازای (cohort_id, user_id)."""

    __tablename__ = "cohort_enrollments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    cohort_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("course_cohorts.id"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|cancelled

    __table_args__ = (
        UniqueConstraint("cohort_id", "user_id", name="uq_cohort_enrollment_cohort_user"),
    )


class CoursePrerequisite(Base):
    """پیش‌نیاز دوره‌ها — بدون خودارجاع و بدون چرخه (اعتبارسنجی در service)."""

    __tablename__ = "course_prerequisites"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("courses.id"), index=True
    )
    requires_course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("courses.id"), index=True
    )

    __table_args__ = (
        UniqueConstraint(
            "course_id", "requires_course_id", name="uq_course_prereq_pair"
        ),
    )


class LibraryItem(Base):
    """آیتم کتابخانهٔ چندرسانه‌ای — فاز ۹ (DMS).

    - media_key/cover_media_key کلیدهای storage هستند، هرگز URL عمومی.
    - دسترسی سطح‌بندی‌شده: visibility ∈ public/registered/scholars_only.
    - گردش‌کار: ماشین مشترک §۹ (workflow_status).
    - related_lesson_id بدون FK فیزیکی (§۹.۵)؛ religious_place_ref رشتهٔ
      رزروشده برای فاز ۱۱.
    - AI indexing جدا از publication: ai_indexed فقط با اقدام صریح index-ai
      و فقط روی آیتم approved/published فعال می‌شود.
    """

    __tablename__ = "library_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    # video | video_360 | pdf | audio | mindmap
    title: Mapped[dict] = mapped_column(JSONB, nullable=False)  # LocalizedText
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    cover_media_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    media_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    scholar_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    topic_tags: Mapped[list] = mapped_column(JSONB, default=list)
    related_lesson_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    religious_place_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    visibility: Mapped[str] = mapped_column(
        String(16), default="registered", index=True
    )  # public | registered | scholars_only
    workflow_status: Mapped[str] = mapped_column(
        String(16), default="draft", index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    ai_scopes: Mapped[list] = mapped_column(JSONB, default=list)
    include_in_fatwa_rag: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_indexed: Mapped[bool] = mapped_column(Boolean, default=False)
    download_policy: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_status: Mapped[str] = mapped_column(
        String(16), default="pending"
    )  # pending | processing | done | failed
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_status: Mapped[str] = mapped_column(
        String(16), default="pending"
    )  # pending | processing | done | failed | skipped
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_type: Mapped[str] = mapped_column(
        String(16), default="upload"
    )  # upload | telegram_import
    source_ref: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # فاز ۱۷: ایندکس ترکیبی مسیر داغ فهرست عمومی —
        # WHERE workflow_status + visibility + ORDER BY created_at,id
        # (‏app/modules/library/service.py::list_public‏)
        Index("ix_library_items_pub_list", "workflow_status", "visibility", "created_at", "id"),
    )


class LibraryItemVersion(Base):
    """نسخهٔ بایگانی‌شدهٔ آیتم کتابخانه — ویرایش نسخهٔ قبلی را بایگانی می‌کند، نه حذف."""

    __tablename__ = "library_item_versions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("library_items.id"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


# ---------------------------------------------------------------------------
# فاز ۱۰ — شبکهٔ اجتماعی، نظارت، پنل مؤلفین فتوا، تجمیع سوالات
# ---------------------------------------------------------------------------


class SocialGroup(Base):
    """گروه موضوعی شبکهٔ اجتماعی طلاب و علما."""

    __tablename__ = "social_groups"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    slug: Mapped[str] = mapped_column(String(128), unique=True)
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("media_assets.id"), nullable=True
    )
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    member_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class GroupMembership(Base):
    """عضویت کاربر در گروه — نقش member | moderator."""

    __tablename__ = "group_memberships"
    __table_args__ = (UniqueConstraint("group_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("social_groups.id"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(16), default="member")  # member | moderator
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SocialPost(Base):
    """پست شبکهٔ اجتماعی — فیلتر کلمات ممنوعه در لایهٔ service پیش از insert."""

    __tablename__ = "social_posts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("social_groups.id"), nullable=True, index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(16), default="published", index=True
    )  # published | removed
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    likes_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        # فاز ۱۷: ایندکس ترکیبی مسیر داغ فید —
        # WHERE status + ORDER BY created_at DESC, id DESC
        # (‏app/modules/social/service.py::list_feed‏)
        Index("ix_social_posts_feed", "status", "created_at", "id"),
    )


class PostLike(Base):
    """لایک پست — یکتا به‌ازای (post_id, user_id)؛ idempotent."""

    __tablename__ = "post_likes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("social_posts.id"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )

    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="uq_post_likes_pair"),
    )


class SocialComment(Base):
    """کامنت زیر پست — مشمول همان فیلتر کلمات ممنوعه."""

    __tablename__ = "social_comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("social_posts.id"), index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(16), default="published"
    )  # published | removed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class SocialFollow(Base):
    """دنبال‌کردن کاربر توسط کاربر."""

    __tablename__ = "social_follows"
    __table_args__ = (UniqueConstraint("follower_id", "followed_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    follower_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    followed_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SocialReport(Base):
    """گزارش تخلف — صف نظارت با SLA.

    target_type: post | comment | user — شناسهٔ هدف polymorphic است و FK
    ندارد (§۹.۵ «no future-FK coupling» برای ارجاع‌های چندریختی).
    """

    __tablename__ = "social_reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    target_type: Mapped[str] = mapped_column(String(16))  # post | comment | user
    target_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    reason: Mapped[str] = mapped_column(Text)
    reported_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(
        String(16), default="new", index=True
    )  # new | triaged | actioned | dismissed
    reported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    triaged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    actioned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sla_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    action: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # triage | dismiss | remove_content | warn_user
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actioned_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )


class ModerationBannedWord(Base):
    """واژه/عبارت ممنوعهٔ فیلتر خودکار — تطبیق در لایهٔ service."""

    __tablename__ = "moderation_banned_words"
    __table_args__ = (UniqueConstraint("word"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    word: Mapped[str] = mapped_column(String(128))
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FatwaSubmission(Base):
    """ثبت فتوای رسمی توسط scholar_author.

    workflow_status طبق ماشین مشترک §۹ (app/core/workflow.py):
    draft → in_review → approved → published ↘ rejected / archived.
    """

    __tablename__ = "fatwa_submissions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    body: Mapped[str] = mapped_column(Text)
    madhab: Mapped[str | None] = mapped_column(String(16), nullable=True)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    workflow_status: Mapped[str] = mapped_column(
        String(16), default="draft", index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class QuestionCluster(Base):
    """خوشهٔ سوالات تکراری — نماینده + پاسخ یک‌بارهٔ مفتی."""

    __tablename__ = "question_clusters"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    representative_question: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default="open", index=True
    )  # open | answered | archived
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    answered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class ClusterMember(Base):
    """عضو خوشه — یک سوال از یک کاربر (منبع: chat | direct)."""

    __tablename__ = "cluster_members"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    cluster_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("question_clusters.id"), index=True
    )
    question_text: Mapped[str] = mapped_column(Text)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    source: Mapped[str] = mapped_column(
        String(16), default="direct"
    )  # chat | direct
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Notification(Base):
    """اعلان ذخیره‌شده — وب/CRM آن را از API می‌خوانند (فاز ۲ §۵)."""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    notif_type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


# ---------------------------------------------------------------------------
# فاز ۱۱ — اماکن مذهبی، تلگرام (بات/اتصال/درون‌ریزی/توزیع)، کلیدهای API ویجت
# (قراردادها: docs/adr/0008-phase11-telegram-widgets-backend.md)
#
# - ReligiousPlace: جدول typed جدا (§۹.۵)؛ video_360_id با FK واقعی به
#   library_items.id (فاز ۹ ساخته شده — «no future-FK coupling» نقض نمی‌شود)؛
#   religious_place_ref رشته‌ای فاز ۹ دست‌نخورده می‌ماند.
# - session تلگرام در platform_settings (رمزنگاری §۳) است، نه جدول جدا.
# - TelegramCallback: nonce یک‌بارمصرف دکمه‌های inline تأیید/رد فتوا.
# ---------------------------------------------------------------------------


class ReligiousPlace(Base):
    """مکان مذهبی — فاز ۱۱.

    workflow_status طبق ماشین مشترک §۹ (app/core/workflow.py).
    type ∈ mosque | shrine | holy_site | museum | other.
    """

    __tablename__ = "religious_places"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[dict] = mapped_column(JSONB)  # LocalizedText
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    lat: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    lng: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), default="mosque", index=True)
    video_360_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("library_items.id"), nullable=True
    )
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    workflow_status: Mapped[str] = mapped_column(
        String(16), default="draft", index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class TelegramDistributionPolicy(Base):
    """سیاست توزیع تلگرام به‌ازای نوع محتوا — §۹.۵.

    policy ∈ never | manual_approval | auto_publish | scheduled.
    پیش‌فرض غایب = never (در سرویس با get-or-create اعمال می‌شود).
    """

    __tablename__ = "telegram_distribution_policies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    content_type: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    policy: Mapped[str] = mapped_column(String(16), default="never", index=True)
    message_template: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_channels: Mapped[list] = mapped_column(JSONB, default=list)
    spacing_seconds: Mapped[int] = mapped_column(Integer, default=0)
    require_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    schedule_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class TelegramPublished(Base):
    """لاگ انتشارهای تلگرام — idempotency با کلید یکتا.

    ترکیب (source_content_type, source_content_id, distribution_target)
    در idempotency_key کد می‌شود تا ارسال دوباره رکورد تکراری نسازد.
    """

    __tablename__ = "telegram_published"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_telegram_published_idem"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    source_content_type: Mapped[str] = mapped_column(String(64), index=True)
    source_content_id: Mapped[str] = mapped_column(String(64), index=True)
    distribution_target: Mapped[str] = mapped_column(String(128), index=True)
    published_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)  # فاز ۱۷: هم‌راستا با uq_telegram_published_idem در migration فاز ۱۱
    status: Mapped[str] = mapped_column(
        String(16), default="pending", index=True
    )  # pending | sent | failed | notified | deleted
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class TelegramCallback(Base):
    """nonce یک‌بارمصرف دکمه‌های inline (تأیید/رد فتوا و ...).

    بایند: (content, op, actor) — ‏actor همان کاربری است که اعلان برایش
    ارسال شده تا گذار از مسیر مجوزدار واقعی اجرا شود.
    """

    __tablename__ = "telegram_callbacks"

    nonce: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_content_type: Mapped[str] = mapped_column(String(64), index=True)
    source_content_id: Mapped[str] = mapped_column(String(64), index=True)
    op: Mapped[str] = mapped_column(String(32))  # approve | reject
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    signature: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class ApiKey(Base):
    """کلید API برای ویجت‌های جاسازی‌شونده — فاز ۱۱.

    فقط هش SHA-256 کلید ذخیره می‌شود؛ خودِ کلید فقط لحظهٔ ساخت دیده می‌شود.
    """

    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(8))  # ۸ کاراکتر اول برای نمایش
    name: Mapped[str] = mapped_column(String(128))
    scopes: Mapped[list] = mapped_column(JSONB, default=list)
    rate_limit_per_min: Mapped[int] = mapped_column(Integer, default=60)
    quota_monthly: Mapped[int] = mapped_column(Integer, default=10000)
    used_this_month: Mapped[int] = mapped_column(Integer, default=0)
    quota_period: Mapped[str] = mapped_column(String(7), default="")  # YYYY-MM
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    abuse_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class VoiceSession(Base):
    """نشست دستیار صوتی — فاز ۱۲.

    هر فراخوانی /voice/ask یک نشست می‌سازد؛ user_id nullable چون ask ناشناس
    هم پذیرفته می‌شود (مثل fatwa.ask).
    """

    __tablename__ = "voice_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    lang: Mapped[str] = mapped_column(String(8), default="fa", index=True)  # fa | ar
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class VoiceUsageLog(Base):
    """لاگ مصرف دستیار صوتی — فاز ۱۲ (پایش/سهمیه در CRM)."""

    __tablename__ = "voice_usage_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("voice_sessions.id"), nullable=False, index=True
    )
    intent: Mapped[str] = mapped_column(String(16), index=True)  # quran | fatwa | general
    lang: Mapped[str] = mapped_column(String(8), index=True)
    stt_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tts_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


# ---------------------------------------------------------------------------
# فاز ۱۳ — موتور همگام‌سازی آفلاین (Track 1 — بک‌اند، ADR-0010)
#
# قراردادها:
# - موجودیت‌های syncable: user_ayah_notes | user_progress | dhikr_daily_counts
#   (§۹.۵: جدول‌های sync موتور از همان فاز ساخته می‌شوند؛ ارجاع به جدول‌های
#   فازهای قبل فقط روی کلیدهای پایدار خودشان است، بدون FK جدید به آن‌ها —
#   entity_id رشته‌ای و مالکیت با user_id کنترل می‌شود).
# - tombstone = حذف منطقیِ ماندگار؛ sync_operations با client_op_id یکتا
#   (idempotency بازپخش)؛ ژورنال sync_changelog منبع pull است.
# ---------------------------------------------------------------------------


class DeviceCursor(Base):
    """کرسر pull به‌ازای هر (کاربر، دستگاه) — یکتا روی (user_id, device_id)."""

    __tablename__ = "device_cursors"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    cursor_seq: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "device_id", name="uq_device_cursors_user_device"
        ),
    )


class SyncOperation(Base):
    """عملیات push یک دستگاه — idempotency روی client_op_id.

    نتیجهٔ هر op در `result` ذخیره می‌شود تا بازپخش همان batch دقیقاً همان
    پاسخ را بدهد بدون اعمال دوباره (§۴ تفاوت idempotency درخواست و رویداد).
    """

    __tablename__ = "sync_operations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    client_op_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    op_type: Mapped[str] = mapped_column(String(16), nullable=False)  # upsert | delete
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    base_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False
    )  # pending | applied | conflicted | rejected
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_sync_operations_entity", "entity_type", "entity_id"),
    )


class SyncTombstone(Base):
    """حذف منطقیِ ماندگار — بین دستگاه‌ها همگام می‌شود، هرگز زود پاک نمی‌شود.

    یکتایی (user_id, entity_type, entity_id): چون entity_idهایی مثل lesson_id
    بین کاربران یکتا نیستند (ADR-0010).
    """

    __tablename__ = "sync_tombstones"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    version: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "entity_type", "entity_id",
            name="uq_sync_tombstones_user_entity",
        ),
    )


class ConflictRecord(Base):
    """تعارض نسخه‌ای محتوای نوشته‌شدهٔ کاربر — سطح فیلد، هر دو نسخه نگه‌داری می‌شود.

    قرارداد نام‌گذاری (ADR-0010): local = نسخهٔ دستگاهی که دیرتر push کرد و
    بازنده شد؛ remote = نسخهٔ فعلی سرور که برنده شد و نگه داشته شد.
    """

    __tablename__ = "conflict_records"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    local_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    remote_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    local_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remote_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolution: Mapped[str] = mapped_column(
        String(16), default="pending", index=True, nullable=False
    )  # pending | keep_local | keep_remote | merged
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class SyncChangeLog(Base):
    """ژورنال الحاقی تغییرات سرور — تنها منبع pull.

    seq کلید اصلیِ خودافزاست (ترتیب سراسری به‌ازای کاربر)؛ pull ردیف‌های
    seq > cursor_seq همان کاربر را برمی‌گرداند. حذف‌ها هم این‌جا با
    op_type=delete ثبت می‌شوند (tombstone رکورد ماندگارِ حذف است).
    """

    __tablename__ = "sync_changelog"

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    op_type: Mapped[str] = mapped_column(String(16), nullable=False)  # upsert | delete
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )

    __table_args__ = (
        Index("ix_sync_changelog_user_seq", "user_id", "seq"),
    )


# ---------------------------------------------------------------------------
# فاز ۱۳ (تکمیلی هماهنگ‌کننده): دستگاه‌های کاربر و اشتراک‌های web push
# ---------------------------------------------------------------------------


class UserDevice(Base):
    """دستگاه ثبت‌شدهٔ کاربر برای push (FCM) و sync.

    توکن push قابل چرخش است؛ آخرین مقدار برنده است. خود توکن دادهٔ حساس
    است و هرگز در audit log ذخیره نمی‌شود (فاز ۰ §۱۴).
    """

    __tablename__ = "user_devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    platform: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # android | ios | web | desktop
    push_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "device_id", name="uq_user_devices_user_device"
        ),
    )


class WebPushSubscription(Base):
    """اشتراک web push (VAPID) مرورگر کاربر — جدا از FCM (فاز ۱۳)."""

    __tablename__ = "web_push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    endpoint: Mapped[str] = mapped_column(String(1024), nullable=False)
    p256dh: Mapped[str] = mapped_column(String(256), nullable=False)
    auth: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "endpoint", name="uq_web_push_user_endpoint"
        ),
    )


# ---------------------------------------------------------------------------
# فاز ۱۴ — کنترل مرکزی ادمین (Track 1 — بک‌اند، ADR-0011)
#
# قراردادها:
# - §۹.۵ اصل ضد-جدول-غول‌پیکر: هیچ جدول generic content ساخته نمی‌شود.
#   content_placements و content_distributions فقط «ارجاع چندریختی»
#   (domain, content_type, content_id) بدون FK فیزیکی نگه می‌دارند؛
#   دادهٔ typed همچنان در جدول‌های خودِ دامنه‌هاست.
# - زمان‌ها UTC؛ schedule_tz فقط متادیتای ورودی است (مقادیر به UTC نرمال می‌شوند).
# ---------------------------------------------------------------------------


class ContentPlacement(Base):
    """اتصال یک محتوا به surface/slot — §۹.۵ Placement.

    surfaces: homepage.section | page.section | banner_area | scholar_profile |
    library_collection | quran_context | dashboard | widget | telegram | ...
    """

    __tablename__ = "content_placements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    domain: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    surface: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    slot: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    audience: Mapped[dict] = mapped_column(JSONB, default=dict)
    starts_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    locale: Mapped[str | None] = mapped_column(String(8), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "surface", "slot", "domain", "content_type", "content_id",
            name="uq_content_placements_slot_content",
        ),
        Index("ix_content_placements_content", "domain", "content_type", "content_id"),
    )


class ContentDistribution(Base):
    """تاگل توزیع به‌ازای هر کانال — §۹.۵ Distribution Policy.

    channels: web | mobile | desktop | telegram | ai_knowledge | search | embed.
    ترتیب اولویت در is_channel_allowed (content_center_service):
    ردیف صریح این جدول → distribution بومی دامنه → پیش‌فرض ADR-002 (فقط web).
    """

    __tablename__ = "content_distributions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    domain: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # انتشار زمان‌بندی‌شده از این لحظه (UTC)
    schedule_tz: Mapped[str | None] = mapped_column(String(64), nullable=True)
    until_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # غیرفعال‌سازی خودکار از این لحظه (UTC)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "domain", "content_type", "content_id", "channel",
            name="uq_content_distributions_content_channel",
        ),
    )


class NotificationBroadcast(Base):
    """پخش اعلان گروهی چندکاناله — سرجمع عملیات."""

    __tablename__ = "notification_broadcasts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    cohort: Mapped[dict] = mapped_column(JSONB, default=dict)
    channels_requested: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(
        String(16), default="queued", index=True
    )  # queued | sending | done | failed
    total_recipients: Mapped[int] = mapped_column(Integer, default=0)
    total_sent: Mapped[int] = mapped_column(Integer, default=0)
    total_skipped: Mapped[int] = mapped_column(Integer, default=0)
    total_failed: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class NotificationDelivery(Base):
    """لاگ تحویل به‌ازای هر (پخش، کاربر، کانال) — audit تحویل."""

    __tablename__ = "notification_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    broadcast_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("notification_broadcasts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    channel: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
    )  # email | sms | push | in_app
    status: Mapped[str] = mapped_column(
        String(16), default="pending", index=True
    )  # pending | sent | skipped | failed
    skip_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        UniqueConstraint(
            "broadcast_id", "user_id", "channel",
            name="uq_notification_deliveries_triplet",
        ),
    )


class BuildRelease(Base):
    """نسخهٔ منتشرشدهٔ اپ — هرگز ادعای امضای دروغین (signed صادقانه)."""

    __tablename__ = "build_releases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    platform: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
    )  # android | ios | desktop
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    build_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    download_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    download_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # فایل واقعی بیلد در StorageProvider (B-01 — ADR-0025): کلید آبجکت در
    # باکت builds؛ download_url پاسخ از همین کلید، تازه و کوتاه‌عمر، با
    # get_presigned_url ساخته می‌شود و در DB ذخیره نمی‌شود.
    artifact_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    signed: Mapped[bool] = mapped_column(Boolean, default=False)
    build_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    released_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )

    # FIX2-11 (ADR-0046): قید یکتایی قدیمی (platform, version,
    # build_number) با طراحی callback ناسازگار بود — callback برای هر
    # فایل یک رکورد با همان سه‌تایی ثبت می‌کند، پس انتشار چندفایلی
    # اصلاً ثبت نمی‌شد. یکتایی واقعی روی artifact_key است (یک رکورد
    # برای هر فایل ذخیره‌شده؛ NULLها — انتشار دستی — آزادند) و گروه
    # انتشار (platform, version, build_number) واحد نگهداری است.
    __table_args__ = (
        Index(
            "uq_build_releases_artifact_key",
            "artifact_key",
            unique=True,
        ),
    )


class BuildRequest(Base):
    """درخواست بازسازی اپ — dispatch واقعی به GitHub Actions (F-05 remediation).

    چرخهٔ صادقانه: ردیف فقط وقتی ساخته می‌شود که ارائه‌دهندهٔ بیلد پیکربندی
    شده باشد (وگرنه API خطای 503 می‌دهد)؛ dispatch به workflow متناظر پلتفرم
    ارسال می‌شود و وضعیت از روی workflow run واقعی همگام می‌شود
    (queued → running → completed | failed). ردیف‌های legacy فاز ۱۴
    provider ندارند (provider=NULL) — یعنی هرگز dispatch نشده‌اند و UI
    آن‌ها را «ارسال‌نشده» نشان می‌دهد، نه «در صفِ در حال انجام».
    """

    __tablename__ = "build_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    platform: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
    )  # android | ios | desktop
    version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ref: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )  # branch/commit درخواستی
    status: Mapped[str] = mapped_column(
        String(16), default="queued", index=True
    )  # queued | running | completed | failed
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # برندینگ درخواستی CRM: app_name/package_id/version_code/api_url/environment
    branding: Mapped[dict] = mapped_column(JSONB, default=dict)
    # ردیابی ارائه‌دهندهٔ بیلد — NULL یعنی هرگز dispatch نشده (legacy)
    provider: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # github_actions
    provider_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider_run_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    artifact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    requested_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


# ===========================================================================
# فاز ۱۵ — مالی، اهدا و درگاه پرداخت (ADR-0013)
# ===========================================================================


class DonationCampaign(Base):
    """کمپین اهدا — title/description همیشه LocalizedText (§۱۵.۴).

    وضعیت با پرچم ساده (active | draft | archived) — دادهٔ کمپین محتوای
    قابل‌انتشار §۹ نیست، پس از موتور گردش‌کار مشترک استفاده نمی‌کند.
    """

    __tablename__ = "donation_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[dict] = mapped_column(JSONB)  # LocalizedText {"fa","ar","en"}
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    goal_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # ریال
    raised_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # ریال
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    cover: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PaymentIntent(Base):
    """نیت پرداخت — نقطهٔ idempotency درخواست (§۱، §۴، ADR-0013).

    هدر Idempotency-Key هر درخواست /donate به دقیقاً یک ردیف اینجا نگاشت
    می‌شود؛ کلید تکراری → همان ردیف موجود برمی‌گردد (بدون تراکنش جدید).
    """

    __tablename__ = "payment_intents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)  # فاز ۱۷: هم‌راستا با uq_payment_intents_idempotency_key در migration فاز ۱۵
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # ریال (IRR)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="IRR")
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("donation_campaigns.id"), nullable=True
    )
    donor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    donor_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )  # pending | succeeded | failed | cancelled
    gateway: Mapped[str] = mapped_column(String(32), nullable=False, default="zarinpal")
    authority: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_payment_intents_idempotency_key"),
    )


class Donation(Base):
    """اهدای ثبت‌شده — یک donation به‌ازای هر intent موفق.

    gateway_reference یکتا: تکرار وبهوک/کال‌بک هرگز ردیف دوم نمی‌سازد.
    """

    __tablename__ = "donations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    donor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    payment_intent_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("payment_intents.id"), nullable=False
    )
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("donation_campaigns.id"), nullable=True
    )
    gateway: Mapped[str] = mapped_column(String(32), nullable=False)
    gateway_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="succeeded", index=True
    )  # succeeded | refunded | failed
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # ریال
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="IRR")
    donor_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )

    __table_args__ = (
        UniqueConstraint("gateway_reference", name="uq_donations_gateway_reference"),
        UniqueConstraint("payment_intent_id", name="uq_donations_payment_intent_id"),
    )


class LedgerEntry(Base):
    """دفتر مالی سبک — هر ورود/خروج پول یک ردیف علامت‌دار."""

    __tablename__ = "ledger_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    entry_type: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
    )  # donation_in | refund | fee
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # علامت‌دار، ریال
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="IRR")
    reference: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    donation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("donations.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class PaymentWebhookLog(Base):
    """لاگ وبهوک — payload_hash یکتا یعنی هر payload فقط یک‌بار پردازش می‌شود."""

    __tablename__ = "payment_webhook_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    gateway: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)  # فاز ۱۷: هم‌راستا با uq_payment_webhook_log_payload_hash در migration فاز ۱۵
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="processed"
    )  # processed | duplicate | rejected
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("payload_hash", name="uq_payment_webhook_log_payload_hash"),
    )


class RecurringDonation(Base):
    """اهدای مکرر — فقط ثبت/مدیریت؛ اجرای شارژ دوره‌ای با فاز ۱۶ (صف ARQ)."""

    __tablename__ = "recurring_donations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    donor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("donation_campaigns.id"), nullable=True
    )
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # ریال
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="IRR")
    interval: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    # weekly | monthly | yearly
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", index=True
    )  # active | paused | cancelled
    next_charge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# فاز ۱۶ — مدیریت پروژه و نیروی انسانی داخلی (PMS)
# (قراردادها: docs/adr/0014-phase16-pms-backend.md)
#
# - ابزار تیم داخلی، نه کاربر نهایی؛ متن‌های قابل‌مشاهده LocalizedText (§۱۵.۴).
# - tasks.related_entity_*: مرجع رشته‌ای + UUID بدون FK فیزیکی (§۹.۵
#   no future-FK coupling — آیتم کتابخانه از فاز ۹ است ولی مرجع نرم کافی است).
# - payroll/leave/contracts عمداً ساخته نمی‌شود (اسپک فاز ۱۶).
# ---------------------------------------------------------------------------


class Project(Base):
    """پروژهٔ داخلی تیم — فاز ۱۶.

    status ∈ active | on_hold | completed | archived (پرچم ساده؛ پروژه محتوای
    قابل‌انتشار §۹ نیست، پس از موتور گردش‌کار مشترک استفاده نمی‌کند).
    """

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    title: Mapped[dict] = mapped_column(JSONB, nullable=False)  # LocalizedText
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", index=True
    )  # active | on_hold | completed | archived
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Task(Base):
    """تسک داخلی تیم — فاز ۱۶.

    status ∈ backlog | todo | in_progress | review | done — گذارها در
    service._TASK_TRANSITIONS اعتبارسنجی می‌شوند.
    priority ∈ low | medium | high | urgent.
    related_entity_type/id: اتصال نرم به موجودیت دیگر فازها
    (مثلاً library_item) — lookup معکوس از /projects/tasks/by-entity.
    """

    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[dict] = mapped_column(JSONB, nullable=False)  # LocalizedText
    description: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LocalizedText
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="backlog", index=True
    )  # backlog | todo | in_progress | review | done
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    priority: Mapped[str] = mapped_column(
        String(16), nullable=False, default="medium", index=True
    )  # low | medium | high | urgent
    related_entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    due_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # آخرین اعلان سررسید (کرون due_soon — ضد اسپم)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_tasks_related_entity", "related_entity_type", "related_entity_id"),
    )


class StaffMember(Base):
    """عضو تیم داخلی — فاز ۱۶.

    نه حقوق/دستمزد، نه مرخصی، نه قرارداد رسمی (عمداً خارج از اسپک).
    """

    __tablename__ = "staff_members"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, unique=True, index=True
    )
    title: Mapped[dict] = mapped_column(JSONB, nullable=False)  # LocalizedText
    department: Mapped[dict] = mapped_column(JSONB, nullable=False)  # LocalizedText
    joined_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
