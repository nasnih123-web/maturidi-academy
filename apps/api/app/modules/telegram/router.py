"""روتر تلگرام — فاز ۱۱.

- `/webhook`: وبهوک بات (بدون auth کاربری؛ احراز هویت با هدر
  X-Telegram-Bot-Api-Secret-Token).
- `/connect/*`: اتصال حساب Telethon از CRM (ادمین، مجوز telegram.manage).
- `/import`: درون‌ریزی آرشیو کانال → جاب ARQ صف telegram.
- `/distribute/*`: سیاست‌ها، انتشار دستی، لاگ، retry، لغو.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import require_permission

from . import bot_service, connect_service, distribute_service, schemas

telegram_router = APIRouter(prefix="/api/v1/telegram", tags=["telegram"])

_admin = require_permission("telegram.manage")


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


# ---------------------------------------------------------------------------
# وبهوک بات — احراز هویت با secret تلگرام، نه JWT
# ---------------------------------------------------------------------------


@telegram_router.post("/webhook")
async def telegram_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    secret_token: str | None = Header(
        default=None, alias="X-Telegram-Bot-Api-Secret-Token"
    ),
):
    if not await distribute_service.verify_webhook_secret(db, secret_token):
        raise APIError(401, "bad_webhook_secret", "امضای وبهوک نامعتبر است")
    try:
        update: dict[str, Any] = await request.json()
    except Exception:
        raise APIError(400, "bad_update", "بدنهٔ وبهوک نامعتبر است")

    callback = (update.get("callback_query") or {})
    data = callback.get("data") or ""
    if isinstance(data, str) and data.startswith("tg:"):
        nonce = data[3:]
        result = await distribute_service.apply_callback(
            db, nonce=nonce, callback_query_id=callback.get("id")
        )
        return {"ok": True, "result": result}
    # آپدیت‌های دیگر فعلاً نادیده گرفته می‌شوند (200)
    return {"ok": True, "ignored": True}


@telegram_router.get("/status/public")
async def bot_status(db: AsyncSession = Depends(get_db)):
    """وضعیت بات — بدون افشای secret (برای CRM)."""
    return {"enabled": await bot_service.bot_enabled(db)}


# ---------------------------------------------------------------------------
# اتصال حساب Telethon (ادمین)
# ---------------------------------------------------------------------------


@telegram_router.post("/connect/request-code", response_model=dict)
async def connect_request_code(
    body: schemas.ConnectRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await connect_service.request_code(
        db, phone=body.phone, actor=user,
        ip=_client_ip(request), user_agent=_ua(request),
    )


@telegram_router.post("/connect/confirm-code", response_model=schemas.ConnectStatus)
async def connect_confirm_code(
    body: schemas.ConfirmCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await connect_service.confirm_code(
        db, phone=body.phone, code=body.code, password=body.password,
        actor=user, ip=_client_ip(request), user_agent=_ua(request),
    )


@telegram_router.get("/connect/status", response_model=schemas.ConnectStatus)
async def connect_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
):
    return await connect_service.status(db)


@telegram_router.post("/connect/disconnect", response_model=schemas.ConnectStatus)
async def connect_disconnect(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await connect_service.disconnect(
        db, actor=user, ip=_client_ip(request), user_agent=_ua(request)
    )


# ---------------------------------------------------------------------------
# درون‌ریزی کانال → جاب ARQ
# ---------------------------------------------------------------------------


@telegram_router.post("/import", status_code=202)
async def import_channel(
    body: schemas.ImportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    st = await connect_service.status(db)
    if not st["connected"]:
        raise APIError(
            422, "telegram_not_connected",
            "حساب تلگرام متصل نیست؛ اول از /connect وارد شوید",
        )
    enqueued = await distribute_service._enqueue_telegram_job(
        "telegram_import_channel",
        channel=body.channel,
        limit=body.limit,
        actor_id=str(user.id),
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="admin",
        action="telegram.import.request",
        entity_type="telegram_import",
        entity_id=body.channel,
        new_values={"channel": body.channel, "limit": body.limit,
                     "enqueued": enqueued},
        ip=_client_ip(request),
        user_agent=_ua(request),
    )
    await db.commit()
    return {"enqueued": enqueued, "channel": body.channel, "limit": body.limit}


# ---------------------------------------------------------------------------
# توزیع
# ---------------------------------------------------------------------------


@telegram_router.get("/distribute/policies", response_model=list[schemas.PolicyOut])
async def list_policies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
):
    return await distribute_service.list_policies(db)


@telegram_router.put(
    "/distribute/policies/{content_type}", response_model=schemas.PolicyOut
)
async def set_policy(
    content_type: str,
    body: schemas.PolicyUpsert,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await distribute_service.set_policy(
        db, content_type, body.model_dump(exclude_unset=True), actor=user,
        ip=_client_ip(request), user_agent=_ua(request),
    )


@telegram_router.post(
    "/distribute/publish", response_model=list[schemas.PublishedOut]
)
async def publish_now(
    body: schemas.PublishRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await distribute_service.request_publish(
        db,
        content_type=body.content_type,
        content_id=body.content_id,
        actor=user,
        targets=body.targets,
        idempotency_key=body.idempotency_key,
        ip=_client_ip(request),
        user_agent=_ua(request),
    )


@telegram_router.get("/distribute/log", response_model=schemas.PublishedList)
async def publish_log(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
    content_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    items, total = await distribute_service.list_published(
        db, content_type=content_type, status=status, limit=limit
    )
    return {"items": items, "total": total}


@telegram_router.post(
    "/distribute/retry/{published_id}", response_model=schemas.PublishedOut
)
async def retry_publish(
    published_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await distribute_service.retry_publish(
        db, published_id, actor=user,
        ip=_client_ip(request), user_agent=_ua(request),
    )


@telegram_router.post(
    "/distribute/revoke/{published_id}", response_model=schemas.PublishedOut
)
async def revoke_publish(
    published_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await distribute_service.revoke_publish(
        db, published_id, actor=user,
        ip=_client_ip(request), user_agent=_ua(request),
    )
