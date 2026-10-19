"""روتر ادمین کلیدهای API — فاز ۱۱ (مجوز api_keys.manage)."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import require_permission

from . import schemas, service

api_keys_router = APIRouter(prefix="/api/v1/api-keys", tags=["api-keys"])

_admin = require_permission("api_keys.manage")


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@api_keys_router.post("", response_model=schemas.ApiKeyCreated, status_code=201)
async def create_key(
    body: schemas.ApiKeyCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.create_key(
        db, body.model_dump(), actor=user, ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@api_keys_router.get("", response_model=list[schemas.ApiKeyOut])
async def list_keys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
):
    items, _ = await service.list_keys(db)
    return items


@api_keys_router.get("/{key_id}", response_model=schemas.ApiKeyOut)
async def get_key(
    key_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
):
    return await service.get_key(db, key_id)


@api_keys_router.patch("/{key_id}", response_model=schemas.ApiKeyOut)
async def update_key(
    key_id: UUID,
    body: schemas.ApiKeyUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.update_key(
        db, key_id, body.model_dump(exclude_unset=True), actor=user,
        ip=_client_ip(request), user_agent=request.headers.get("user-agent"),
    )


@api_keys_router.post("/{key_id}/revoke", response_model=schemas.ApiKeyOut)
async def revoke_key(
    key_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.revoke_key(
        db, key_id, actor=user, ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@api_keys_router.get("/{key_id}/usage", response_model=schemas.ApiKeyUsage)
async def usage_stats(
    key_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
):
    return await service.usage_stats(db, key_id)


@api_keys_router.get("/{key_id}/embed-snippet", response_model=schemas.EmbedSnippet)
async def embed_snippet(
    key_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),  # noqa: ARG001
    widget: str = Query(...),
    base_url: str = Query(default=""),
):
    """قالب کد embed — به‌جای کلید واقعی، جای‌نگهدار می‌گذارد (§۱۴)."""
    await service.get_key(db, key_id)  # 404 اگر نبود
    html = service.build_embed_snippet(widget, "__API_KEY__", base_url=base_url)
    return {
        "widget": widget,
        "html": html,
        "note": "به‌جای __API_KEY__ کلید واقعی (که فقط لحظهٔ ساخت دیده شد) را بگذارید.",
    }
