"""مدل‌های دیتابیس — همهٔ جدول‌ها در models.py.

قرارداد: جدول users هیچ ستون role ندارد؛ نقش همیشه از user_roles خوانده می‌شود (فاز ۰ §۲).
"""
from app.models.models import (  # noqa: F401
    AuditLog,
    DhikrDailyCount,
    DhikrSession,
    DomainEvent,
    HomeSection,
    LibraryItem,
    LibraryItemVersion,
    MediaAsset,
    NotificationPreference,
    PasswordResetToken,
    Permission,
    PhoneVerificationCode,
    PlatformSetting,
    Project,
    RecoveryCode,
    RefreshToken,
    Role,
    RolePermission,
    Session,
    StaffMember,
    Task,
    Theme,
    User,
    UserAyahNote,
    UserConsent,
    UserRole,
)
