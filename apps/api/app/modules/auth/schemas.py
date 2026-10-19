"""اسکیماهای احراز هویت — Pydantic v2 (فاز ۰ §۱: schema صریح برای هر API)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, min_length=8, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    locale: str = Field(default="fa", max_length=8)
    accept_terms: bool = False

    @field_validator("email", "phone")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) else v


class LoginIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=320)  # ایمیل یا شماره
    password: str = Field(min_length=1, max_length=128)
    totp_code: str | None = Field(default=None, max_length=16)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # افزودنیِ سازگار با قرارداد (الگوی turbo): اگر کاربر نقش مدیریتی دارد ولی
    # هنوز 2FA ثبت‌نام نکرده، True است تا CRM ورود را مشروط کند (قرارداد §۲).
    must_enroll_2fa: bool = False


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=10)


class LogoutIn(BaseModel):
    refresh_token: str = Field(min_length=10)


class VerifyEmailIn(BaseModel):
    token: str = Field(min_length=10)


class PhoneCodeRequestIn(BaseModel):
    phone: str = Field(min_length=8, max_length=32)


class PhoneVerifyIn(BaseModel):
    phone: str = Field(min_length=8, max_length=32)
    code: str = Field(min_length=4, max_length=16)


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class PasswordResetConfirmIn(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=128)


class TwoFASetupOut(BaseModel):
    secret: str
    provisioning_uri: str


class TwoFAEnableIn(BaseModel):
    secret: str = Field(min_length=10)
    code: str = Field(min_length=4, max_length=16)


class TwoFARecoverIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    recovery_code: str = Field(min_length=4, max_length=32)


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class UserSummary(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    locale: str
    is_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    message: str


class WsTicketOut(BaseModel):
    """بلیط یک‌بارمصرف وب‌سوکت — جایگزین JWT در query string."""

    ticket: str
    expires_in: int
