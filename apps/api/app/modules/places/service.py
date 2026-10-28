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
from app.core.platform_settings import get_typed_setting
from app.models.models import LibraryItem, ReligiousPlace, User

from .schemas import PlaceCreate, PlaceUpdate
from .types import DEFAULT_PLACE_TYPES, parse_place_types, type_keys


async def _allowed_types(db: AsyncSession) -> set[str]:
    """Live type keys from the CRM ``places.types`` setting.

    Any failure (missing setting, malformed stored value) falls back to
    the defaults — a bad setting must never break place registration.
    """
    try:
        raw = await get_typed_setting(db, "places.types", None)
    except Exception:  # noqa: BLE001 - any settings failure (DB, decrypt,
        # malformed JSON) must fall back to defaults, never break places
        return type_keys(DEFAULT_PLACE_TYPES)
    if raw is None:
        return type_keys(DEFAULT_PLACE_TYPES)
    return type_keys(parse_place_types(raw))  # defensive: never raises


async def _check_type(
    db: AsyncSession, place_type: str | None, *, keep: str | None = None,
) -> None:
    """Reject unknown types with a serializable 422.

    ``keep`` is the row's existing type: an update that does not change
    the type is never rejected, so legacy rows (``shrine`` / ``holy_site``)
    stay editable until an admin retypes them.
    """
    if place_type is None:
        return
    if keep is not None and place_type == keep:
        return
    if place_type not in await _allowed_types(db):
        raise APIError(
            422, "unknown_place_type",
            f"نوع مکان ناشناخته است: {place_type}",
        )


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
        "city": place.city,
        "image_url": place.image_url,
        "images": place.images,
        "video_360_id": place.video_360_id,
        "video_url": place.video_url,
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
    await _check_type(db, data.type)
    place = ReligiousPlace(
        name=data.name.model_dump(),
        description=data.description.model_dump() if data.description else None,
        lat=data.lat,
        lng=data.lng,
        type=data.type,
        city=(data.city or None),
        image_url=data.image_url,
        images=[img.model_dump() for img in data.images] if data.images else None,
        video_360_id=data.video_360_id,
        video_url=data.video_url,
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


async def submit_place(
    db: AsyncSession, data, *, ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """Anonymous registration (maps phase): a draft only. The CRM reviews it
    through the normal §9 workflow; nothing submitted here ever reaches the
    public map or detail page until an admin publishes it."""
    await _check_type(db, data.type)
    place = ReligiousPlace(
        name=data.name.model_dump(),
        description=data.description.model_dump() if data.description else None,
        lat=data.lat,
        lng=data.lng,
        type=data.type,
        city=(data.city or None),
        image_url=data.image_url,
        workflow_status=workflow.DRAFT,
        version=1,
        submitted_by=None,
    )
    db.add(place)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="religious_place",
        aggregate_id=str(place.id),
        event_type="place.submitted",
        payload={"type": place.type, "lat": place.lat, "lng": place.lng},
    )
    await log_audit(
        db,
        actor_id=None,
        actor_type="public",
        action="places.submit",
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
    if "type" in patch:
        await _check_type(db, patch["type"], keep=place.type)
    old = {"name": place.name, "lat": place.lat, "lng": place.lng,
           "type": place.type, "workflow_status": place.workflow_status}
    for key, value in patch.items():
        if key in ("name", "description") and value is not None:
            setattr(place, key, dict(value))
        elif value is not None or key in ("video_360_id", "city", "image_url", "images", "video_url"):
            # video_360_id / city / image_url / images / video_url صریحاً
            # null هم قابل پاک‌شدن‌اند
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
