"""روتر اماکن مذهبی — فاز ۱۱.

- عمومی `/api/v1/places`: فقط published + فیلتر bounding-box (نقشهٔ زنده).
- ادمین `/api/v1/admin/places`: CRUD + گذارهای گردش‌کار (مجوز places.manage).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import require_permission

from . import schemas, service

places_router = APIRouter(prefix="/api/v1/places", tags=["places"])
admin_places_router = APIRouter(prefix="/api/v1/admin/places", tags=["admin-places"])

_admin = require_permission("places.manage")


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ---------------------------------------------------------------------------
# عمومی — نقشهٔ زنده
# ---------------------------------------------------------------------------


@places_router.get("", response_model=schemas.PlaceList)
async def list_places(
    db: AsyncSession = Depends(get_db),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
    min_lng: float | None = Query(default=None, ge=-180, le=180),
    max_lng: float | None = Query(default=None, ge=-180, le=180),
    type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
):
    items, total = await service.list_places(
        db,
        published_only=True,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lng=min_lng,
        max_lng=max_lng,
        place_type=type,
        limit=limit,
    )
    return {"items": items, "total": total}


@places_router.get("/{place_id}", response_model=schemas.PlaceOut)
async def get_place(place_id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.get_place(db, place_id, published_only=True)


# ---------------------------------------------------------------------------
# ادمین
# ---------------------------------------------------------------------------


@admin_places_router.post("", response_model=schemas.PlaceOut, status_code=201)
async def create_place(
    body: schemas.PlaceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.create_place(
        db, body, actor=user, ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@admin_places_router.get("", response_model=schemas.PlaceList)
async def admin_list_places(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
    status: str | None = Query(default=None),
    type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
):
    items, total = await service.list_places(
        db, published_only=False, place_type=type, limit=limit
    )
    if status:
        items = [i for i in items if i["workflow_status"] == status]
        total = len(items)
    return {"items": items, "total": total}


@admin_places_router.get("/{place_id}", response_model=schemas.PlaceOut)
async def admin_get_place(
    place_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.get_place(db, place_id, published_only=False)


@admin_places_router.patch("/{place_id}", response_model=schemas.PlaceOut)
async def update_place(
    place_id: UUID,
    body: schemas.PlaceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.update_place(
        db, place_id, body, actor=user, ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@admin_places_router.post("/{place_id}/transition", response_model=schemas.PlaceOut)
async def transition_place(
    place_id: UUID,
    body: schemas.PlaceTransition,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    return await service.transition_place(
        db, place_id, body.target, actor=user, ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@admin_places_router.delete("/{place_id}", status_code=204)
async def delete_place(
    place_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_admin),
):
    await service.delete_place(
        db, place_id, actor=user, ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
