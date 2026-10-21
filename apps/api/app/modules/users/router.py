"""روتر کاربران — فقط سیم‌کشی؛ منطق در service.py (فاز ۰ §۱۵، قانون ۶)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.users import service
from app.modules.users.schemas import (
    ConsentOut,
    DeviceRegisterIn,
    DeviceRegisterOut,
    MessageOut,
    MeUpdate,
    MyNotificationOut,
    MyNotificationsPage,
    SessionOut,
    UserOut,
    UsersPage,
    VapidKeyOut,
    WebPushSubscribeIn,
    WebPushSubscribeOut,
    WebPushUnsubscribeIn,
)

router = APIRouter(prefix="/api/v1", tags=["users"])


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.get("/users/me", response_model=UserOut)
async def get_me(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    # نقش‌ها/مجوزهای واقعی همراه پاسخ می‌آیند (فاز ۲) تا گیتینگ CRM روی
    # دادهٔ واقعی RBAC باشد، نه stub.
    return await service.build_user_out(db, user)


@router.patch("/users/me", response_model=UserOut)
async def update_me(
    data: MeUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client(request)
    updated = await service.update_me(db, user, data, ip, ua)
    return await service.build_user_out(db, updated)


@router.get("/users/me/sessions", response_model=list[SessionOut])
async def list_sessions(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await service.list_sessions(db, user)


@router.delete("/users/me/sessions/{session_id}", response_model=MessageOut)
async def revoke_session(
    session_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ip, _ = _client(request)
    await service.revoke_session(db, user, session_id, ip)
    return MessageOut(message="نشست بسته شد")


@router.get("/users/me/consent", response_model=list[ConsentOut])
async def list_consents(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await service.list_consents(db, user)


@router.post("/users/me/export")
async def export_data(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """خروجی JSON دادهٔ شخصی — GDPR از روز اول."""
    return await service.export_data(db, user)


@router.delete("/users/me", response_model=MessageOut)
async def delete_me(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ناشناس‌سازی دادهٔ شخصی — GDPR از روز اول."""
    ip, ua = _client(request)
    await service.delete_account(db, user, ip, ua)
    return MessageOut(message="حساب شما ناشناس‌سازی و غیرفعال شد")


@router.get("/admin/users", response_model=UsersPage)
async def admin_list_users(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(require_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    """لیست کاربران با صفحه‌بندی cursor-based (فاز ۰ §۱) — فقط super_admin/دارندگان مجوز."""
    items, next_cursor = await service.admin_list_users(db, cursor, limit)
    return UsersPage(
        items=await service.build_user_outs(db, items),
        next_cursor=next_cursor,
    )


@router.post("/users/me/devices", response_model=DeviceRegisterOut)
async def register_my_device(
    body: DeviceRegisterIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ثبت دستگاه + توکن FCM کاربر (upsert). کلاینت موبایل (فاز ۱۳) این‌جا می‌زند."""
    result = await service.register_device(
        db, user, body.device_id, body.platform, body.push_token,
    )
    return DeviceRegisterOut(**result)


@router.get("/notifications/web-push/vapid-key", response_model=VapidKeyOut)
async def get_vapid_key(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """کلید عمومی VAPID برای اشتراک web push — اگر تنظیم نشده، configured=false."""
    from app.core.platform_settings import get_setting

    key = await get_setting(db, "push.vapid_public_key")
    return VapidKeyOut(vapid_public_key=key, configured=bool(key))


@router.post("/users/me/web-push/subscriptions", response_model=WebPushSubscribeOut)
async def subscribe_web_push(
    body: WebPushSubscribeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """اشتراک web push مرورگر (VAPID) — جدا از FCM."""
    result = await service.subscribe_web_push(
        db, user, body.endpoint, body.p256dh, body.auth,
    )
    return WebPushSubscribeOut(**result)


@router.delete("/users/me/web-push/subscriptions", response_model=WebPushSubscribeOut)
async def unsubscribe_web_push(
    body: WebPushUnsubscribeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """لغو اشتراک web push."""
    result = await service.unsubscribe_web_push(db, user, body.endpoint)
    return WebPushSubscribeOut(**result)


@router.get("/users/me/notifications", response_model=MyNotificationsPage)
async def list_my_notifications(
    unread_only: bool = Query(default=False),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    items, unread_count, next_cursor = await service.list_my_notifications(
        db, user, unread_only, cursor, limit
    )
    return MyNotificationsPage(
        items=[MyNotificationOut.model_validate(i) for i in items],
        unread_count=unread_count,
        next_cursor=next_cursor,
    )


@router.post("/users/me/notifications/{notification_id}/read", response_model=MyNotificationOut)
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await service.mark_notification_read(db, user, notification_id)
    return MyNotificationOut.model_validate(row)
