"""مدل‌های دیتابیس — همهٔ جدول‌ها در models.py.

قرارداد: جدول users هیچ ستون role ندارد؛ نقش همیشه از user_roles خوانده می‌شود (فاز ۰ §۲).
"""
from app.models.models import (  # noqa: F401
    AuditLog,
    DomainEvent,
    MediaAsset,
    NotificationPreference,
    PasswordResetToken,
    Permission,
    PhoneVerificationCode,
    PlatformSetting,
    RecoveryCode,
    RefreshToken,
    Role,
    RolePermission,
    Session,
    Theme,
    User,
    UserConsent,
    UserRole,
)
