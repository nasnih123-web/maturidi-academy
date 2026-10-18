"""روتر احراز هویت — فقط سیم‌کشی؛ منطق در service.py (فاز ۰ §۱۵، قانون ۶)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth import service
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import (
    LoginIn,
    LogoutIn,
    MessageOut,
    PasswordResetConfirmIn,
    PasswordResetRequestIn,
    PhoneCodeRequestIn,
    PhoneVerifyIn,
    RecoveryCodesOut,
    RefreshIn,
    RegisterIn,
    TokenPair,
    TwoFAEnableIn,
    TwoFARecoverIn,
    TwoFASetupOut,
    UserSummary,
    VerifyEmailIn,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.post("/register", response_model=UserSummary, status_code=201)
async def register(
    data: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)
):
    ip, ua = _client(request)
    user = await service.register(db, data, ip, ua)
    return user


@router.post("/login", response_model=TokenPair)
async def login(data: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    ip, ua = _client(request)
    user = await service.authenticate(db, data, ip)
    access, refresh = await service.create_session_pair(db, user, ua, ip)
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        must_enroll_2fa=await service.must_enroll_2fa(db, user),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshIn, db: AsyncSession = Depends(get_db)):
    access, refresh = await service.refresh_pair(db, data.refresh_token)
    return TokenPair(access_token=access, refresh_token=refresh)


@router.post("/logout", response_model=MessageOut)
async def logout(
    data: LogoutIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await service.logout(db, user, data.refresh_token)
    return MessageOut(message="با موفقیت خارج شدید")


@router.post("/logout-all", response_model=MessageOut)
async def logout_all(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await service.logout_all(db, user)
    return MessageOut(message="از همهٔ دستگاه‌ها خارج شدید")


@router.post("/verify-email", response_model=MessageOut)
async def verify_email(data: VerifyEmailIn, db: AsyncSession = Depends(get_db)):
    await service.verify_email(db, data.token)
    return MessageOut(message="ایمیل با موفقیت تأیید شد")


@router.post("/verify-phone/request", response_model=MessageOut)
async def verify_phone_request(
    data: PhoneCodeRequestIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await service.request_phone_code(db, user, data)
    return MessageOut(message="کد تأیید پیامک شد")


@router.post("/verify-phone", response_model=MessageOut)
async def verify_phone(
    data: PhoneVerifyIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await service.verify_phone_code(db, user, data)
    return MessageOut(message="شماره تلفن با موفقیت تأیید شد")


@router.post("/password-reset/request", response_model=MessageOut)
async def password_reset_request(
    data: PasswordResetRequestIn, db: AsyncSession = Depends(get_db)
):
    await service.request_password_reset(db, data.email)
    return MessageOut(message="اگر این ایمیل ثبت شده باشد، لینک بازیابی ارسال شد")


@router.post("/password-reset/confirm", response_model=MessageOut)
async def password_reset_confirm(
    data: PasswordResetConfirmIn, db: AsyncSession = Depends(get_db)
):
    await service.confirm_password_reset(db, data.token, data.new_password)
    return MessageOut(message="رمز عبور با موفقیت تغییر کرد")


@router.post("/2fa/setup", response_model=TwoFASetupOut)
async def twofa_setup(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    secret, uri = await service.setup_2fa(db, user)
    return TwoFASetupOut(secret=secret, provisioning_uri=uri)


@router.post("/2fa/enable", response_model=RecoveryCodesOut)
async def twofa_enable(
    data: TwoFAEnableIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ip, _ = _client(request)
    codes = await service.enable_2fa(db, user, data, ip)
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/2fa/recover", response_model=MessageOut)
async def twofa_recover(
    data: TwoFARecoverIn, request: Request, db: AsyncSession = Depends(get_db)
):
    ip, _ = _client(request)
    await service.recover_2fa(db, data, ip)
    return MessageOut(message="احراز دوعاملی غیرفعال شد؛ لطفاً دوباره فعال کنید")
