"""سرویس اماکن مذهبی — فاز ۱۱.

- گردش‌کار: ماشین مشترک §۹ (app/core/workflow.py) — بدون ماشین جدا.
- روتر هرگز مستقیم به DB دسترسی ندارد (§۱۵.۶).
- زمان‌ها UTC؛ در API به‌صورت ISO 8601 سریالایز می‌شوند (§۱).
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import LibraryItem, ReligiousPlace, User

from .schemas import PlaceCreate, PlaceUpdate


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _out(place: ReligiousPlace) -> dict:
    return {
        "id": place.id,
        "name": place.name,
        "description": place.description,
        "lat": place.lat,
        "lng": place.lng,
        "type": place.type,
        "video_360_id": place.video_360_id,
        "workflow_status": place.workflow_status,
        "version": place.version,
        "created_at": place.created_at,
        "updated_at": place.updated_at,
    }


async def _get_or_404(db: AsyncSession, place_id: uuid.UUID) -> ReligiousPlace:
    place = await db.get(ReligiousPlace, place_id)
    if place is None:
        raise APIError(404, "place_not_found", "مکان یافت نشد")
    return place


async def _check_360(db: AsyncSession, video_360_id: uuid.UUID | None) -> None:
    """ارجاع ۳۶۰ باید به یک آیتم video_360 موجود اشاره کند."""
    if video_360_id is None:
        return
    item = await db.get(LibraryItem, video_360_id)
    if item is None or item.kind != "video_360":
        raise APIError(
            422, "invalid_360_ref", "ارجاع ویدیوی ۳۶۰ نامعتبر است",
            details={"video_360_id": str(video_360_id)},
        )


async def create_place(
    db: AsyncSession, data: PlaceCreate, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    await _check_360(db, data.video_360_id)
    place = ReligiousPlace(
        name=data.name.model_dump(),
        description=data.description.model_dump() if data.description else None,
        lat=data.lat,
        lng=data.lng,
        type=data.type,
        video_360_id=data.video_360_id,
        workflow_status=workflow.DRAFT,
        version=1,
        created_by=actor.id,
    )
    db.add(place)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="religious_place",
        aggregate_id=str(place.id),
        event_type="place.created",
        payload={"type": place.type, "lat": place.lat, "lng": place.lng},
    )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="places.create",
        entity_type="religious_place",
        entity_id=str(place.id),
        new_values={"type": place.type, "lat": place.lat, "lng": place.lng},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(place)
    return _out(place)


async def list_places(
    db: AsyncSession,
    *,
    published_only: bool = True,
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lng: float | None = None,
    max_lng: float | None = None,
    place_type: str | None = None,
    limit: int = 100,
) -> tuple[list[dict], int]:
    """فهرست اماکن + فیلتر bounding-box (برای نقشهٔ زنده)."""
    stmt = select(ReligiousPlace)
    count_stmt = select(func.count()).select_from(ReligiousPlace)
    if published_only:
        stmt = stmt.where(ReligiousPlace.workflow_status == workflow.PUBLISHED)
        count_stmt = count_stmt.where(
            ReligiousPlace.workflow_status == workflow.PUBLISHED
        )
    if min_lat is not None:
        stmt = stmt.where(ReligiousPlace.lat >= min_lat)
        count_stmt = count_stmt.where(ReligiousPlace.lat >= min_lat)
    if max_lat is not None:
        stmt = stmt.where(ReligiousPlace.lat <= max_lat)
        count_stmt = count_stmt.where(ReligiousPlace.lat <= max_lat)
    if min_lng is not None:
        stmt = stmt.where(ReligiousPlace.lng >= min_lng)
        count_stmt = count_stmt.where(ReligiousPlace.lng >= min_lng)
    if max_lng is not None:
        stmt = stmt.where(ReligiousPlace.lng <= max_lng)
        count_stmt = count_stmt.where(ReligiousPlace.lng <= max_lng)
    if place_type:
        stmt = stmt.where(ReligiousPlace.type == place_type)
        count_stmt = count_stmt.where(ReligiousPlace.type == place_type)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.order_by(ReligiousPlace.created_at).limit(limit))
    ).scalars().all()
    return [_out(p) for p in rows], total


async def get_place(
    db: AsyncSession, place_id: uuid.UUID, *, published_only: bool = True
) -> dict:
    place = await _get_or_404(db, place_id)
    if published_only and place.workflow_status != workflow.PUBLISHED:
        raise APIError(404, "place_not_found", "مکان یافت نشد")
    return _out(place)


async def update_place(
    db: AsyncSession, place_id: uuid.UUID, data: PlaceUpdate, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    place = await _get_or_404(db, place_id)
    patch = data.model_dump(exclude_unset=True)
    if "video_360_id" in patch:
        await _check_360(db, patch["video_360_id"])
    old = {"name": place.name, "lat": place.lat, "lng": place.lng,
           "type": place.type, "workflow_status": place.workflow_status}
    for key, value in patch.items():
        if key in ("name", "description") and value is not None:
            setattr(place, key, dict(value))
        elif value is not None or key == "video_360_id":
            # video_360_id صریحاً null هم قابل پاک‌شدن است
            setattr(place, key, value)
    place.version = (place.version or 1) + 1
    place.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="places.update",
        entity_type="religious_place",
        entity_id=str(place.id),
        old_values=old,
        new_values={k: getattr(place, k) for k in
                    ("name", "lat", "lng", "type", "workflow_status")},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(place)
    return _out(place)


async def transition_place(
    db: AsyncSession, place_id: uuid.UUID, target: str, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """گذار گردش‌کار با ماشین مشترک §۹ — هیچ جهشی مجاز نیست."""
    place = await _get_or_404(db, place_id)
    workflow.validate_transition(place.workflow_status, target)
    old_status = place.workflow_status
    place.workflow_status = target
    place.version = (place.version or 1) + 1
    place.updated_at = _utcnow()
    await emit_event(
        db,
        aggregate_type="religious_place",
        aggregate_id=str(place.id),
        event_type=f"place.{target}",
        payload={"actor_id": str(actor.id), "from": old_status, "to": target},
    )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="places.transition",
        entity_type="religious_place",
        entity_id=str(place.id),
        old_values={"workflow_status": old_status},
        new_values={"workflow_status": target},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(place)
    return _out(place)


async def delete_place(
    db: AsyncSession, place_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> None:
    """حذف فیزیکی فقط برای draft — بقیه اول باید archived شوند (§۹)."""
    place = await _get_or_404(db, place_id)
    if place.workflow_status != workflow.DRAFT:
        raise APIError(
            422, "place_not_deletable",
            "فقط مکان‌های پیش‌نویس قابل حذف‌اند؛ بقیه اول باید بایگانی شوند",
        )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="places.delete",
        entity_type="religious_place",
        entity_id=str(place.id),
        old_values={"name": place.name},
        ip=ip,
        user_agent=user_agent,
    )
    await db.delete(place)
    await db.commit()
