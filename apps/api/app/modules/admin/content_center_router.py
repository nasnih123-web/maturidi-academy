"""روتر صندوق واحد محتوا — فاز ۱۴.

فاز ۰ §۱۵ قانون ۶: روتر فقط سیم‌کشی است؛ منطق در content_center_service.py.
مجوز: `content.bulk` برای همهٔ endpointهای این مرکز.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.admin import content_center_service as svc
from app.modules.admin.control_registry import list_adapters
from app.modules.admin.control_schemas import (
    AdapterInfo,
    AiSourceOut,
    AuditEntryOut,
    BulkActionIn,
    BulkActionOut,
    CalendarOut,
    ContentDetailOut,
    ContentListOut,
    DistributionOut,
    DistributionPolicyIn,
    DistributionSetIn,
    MessageOut,
    PlacementIn,
    PlacementOut,
    ReorderPlacementsIn,
    TransitionIn,
)
from app.modules.auth.dependencies import require_permission

router = APIRouter(prefix="/api/v1/admin/content", tags=["admin-content"])
_perm = require_permission("content.bulk")


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        from app.core.errors import APIError

        raise APIError(422, "bad_datetime", f"قالب تاریخ نامعتبر: {value}")
    # §۱: زمان در DB همیشه UTC — ورودی naive به‌عنوان UTC تفسیر می‌شود
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


@router.get("/adapters", response_model=list[AdapterInfo])
async def get_adapters(user: User = Depends(_perm)):
    """دامنه‌های ثبت‌شده در صندوق واحد."""
    return [
        AdapterInfo(domain=a.domain, content_type=a.content_type,
                    label=a.label, supports_transition=a.transition_fn is not None)
        for a in list_adapters()
    ]


@router.get("/items", response_model=ContentListOut)
async def get_items(
    q: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    content_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    author_id: str | None = Query(default=None),
    visibility: str | None = Query(default=None),
    ai_scope: str | None = Query(default=None),
    distribution_channel: str | None = Query(default=None),
    placement: str | None = Query(default=None, description="فیلتر surface"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """صندوق واحد: یک اینباکس جست‌وجوپذیر روی همهٔ دامنه‌های محتوایی (§۹.۵)."""
    items, next_cursor = await svc.list_items(
        db, q=q, domain=domain, content_type=content_type, status=status,
        author_id=author_id, visibility=visibility, ai_scope=ai_scope,
        distribution_channel=distribution_channel, placement=placement,
        date_from=_parse_dt(date_from), date_to=_parse_dt(date_to),
        cursor=cursor, limit=limit,
    )
    return ContentListOut(items=items, next_cursor=next_cursor)


@router.get("/items/{domain}/{content_type}/{item_id}",
            response_model=ContentDetailOut)
async def get_item_detail(
    domain: str, content_type: str, item_id: str,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """جزئیات یکپارچه: پیش‌نمایش، گردش‌کار، placement، توزیع، SEO، audit."""
    return await svc.get_detail(db, domain, content_type, item_id)


@router.post("/bulk", response_model=BulkActionOut)
async def post_bulk(
    data: BulkActionIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """عملیات گروهی: transition | schedule | placement | distribution | export.

    حساس — RBAC (`content.bulk`) + audit به‌ازای هر آیتمِ تغییرکرده.
    Idempotent تا حد امکان (گذار به وضعیت فعلی = skipped؛ upsertها).
    """
    ip, ua = _client(request)
    return await svc.bulk_action(
        db, actor=user,
        items=[r.model_dump() for r in data.items],
        action=data.action, params=data.params, ip=ip, user_agent=ua,
    )


@router.get("/placements", response_model=list[PlacementOut])
async def get_placements(
    surface: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    content_type: str | None = Query(default=None),
    content_id: str | None = Query(default=None),
    active: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """فهرست placementها — محتوا ↔ surface/slot (§۹.۵)."""
    return await svc.list_placements(
        db, surface=surface, domain=domain, content_type=content_type,
        content_id=content_id, active=active, limit=limit,
    )


@router.put("/placements", response_model=PlacementOut)
async def put_placement(
    data: PlacementIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """ثبت/به‌روزرسانی placement (upsert — idempotent)."""
    ip, ua = _client(request)
    return await svc.upsert_placement(
        db, actor=user, domain=data.domain, content_type=data.content_type,
        content_id=data.content_id, surface=data.surface, slot=data.slot,
        sort_order=data.sort_order, audience=data.audience,
        starts_at=data.starts_at, ends_at=data.ends_at, locale=data.locale,
        active=data.active, ip=ip, user_agent=ua,
    )


@router.delete("/placements/{placement_id}", response_model=MessageOut)
async def delete_placement(
    placement_id: uuid.UUID,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client(request)
    await svc.delete_placement(db, placement_id, actor=user, ip=ip, user_agent=ua)
    return MessageOut(message="placement حذف شد")


@router.get("/distribution", response_model=DistributionOut)
async def get_distribution(
    domain: str = Query(...),
    content_type: str = Query(...),
    content_id: str = Query(..., alias="id"),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """وضعیت مؤثر توزیع هر کانال + منبع (explicit | native | default)."""
    return await svc.get_distribution(db, domain, content_type, content_id)


@router.put("/distribution", response_model=dict)
async def put_distribution(
    data: DistributionSetIn,
    request: Request,
    domain: str = Query(...),
    content_type: str = Query(...),
    content_id: str = Query(..., alias="id"),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """تنظیم توزیع یک کانال — مستقل از بقیه (§۹.۵)."""
    ip, ua = _client(request)
    return await svc.set_distribution(
        db, actor=user, domain=domain, content_type=content_type,
        content_id=content_id, channel=data.channel, enabled=data.enabled,
        scheduled_at=data.scheduled_at, schedule_tz=data.schedule_tz,
        until_at=data.until_at, ip=ip, user_agent=ua,
    )


@router.get("/calendar", response_model=CalendarOut)
async def get_calendar(
    date_from: str = Query(...),
    date_to: str = Query(...),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """تقویم یکپارچهٔ انتشار + تشخیص تعارض دو محتوا در یک slot."""
    return await svc.calendar_feed(
        db, _parse_dt(date_from) or datetime.now(), _parse_dt(date_to) or datetime.now()
    )


@router.post("/items/{domain}/{content_type}/{item_id}/transition",
            response_model=dict)
async def post_item_transition(
    domain: str, content_type: str, item_id: str,
    data: TransitionIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """گذار تکی گردش‌کار — تب Workflow (تأیید/انتشار/رد از صفحهٔ جزئیات)."""
    ip, ua = _client(request)
    return await svc.transition_item(
        db, actor=user, domain=domain, content_type=content_type,
        item_id=item_id, to=data.to, note=data.note, ip=ip, ua=ua,
    )


@router.post("/placements/reorder", response_model=dict)
async def post_placements_reorder(
    data: ReorderPlacementsIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """ترتیب مجدد placementها — جابه‌جایی بدون deploy."""
    ip, ua = _client(request)
    return await svc.reorder_placements(
        db, actor=user, ordered_ids=data.ordered_ids, ip=ip, ua=ua)


@router.patch("/items/{domain}/{content_type}/{item_id}/distribution",
             response_model=dict)
async def patch_item_distribution(
    domain: str, content_type: str, item_id: str,
    data: DistributionPolicyIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """تنظیم یکجای سیاست توزیع همهٔ کانال‌ها — تب Distribution."""
    ip, ua = _client(request)
    return await svc.set_distribution_policy(
        db, actor=user, domain=domain, content_type=content_type,
        content_id=item_id, policy=data.policy,
        scheduled_at=data.scheduled_at, until_at=data.until_at,
        ip=ip, ua=ua,
    )


@router.get("/audit", response_model=list[AuditEntryOut])
async def get_audit_feed(
    domain: str | None = Query(default=None),
    content_type: str | None = Query(default=None),
    item_id: str | None = Query(default=None, alias="id"),
    actor_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """فید audit — تب Audit Log (§۱۴)."""
    return await svc.query_audit(
        db, domain=domain, content_type=content_type, item_id=item_id,
        actor_id=actor_id, limit=limit,
    )


@router.get("/ai-sources", response_model=list[AiSourceOut])
async def get_ai_sources(
    scope: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """مرکز منابع AI — آیتم‌های دارای ai_scope با provenance."""
    return await svc.list_ai_sources(db, scope=scope, limit=limit)


@router.post("/ai-sources/{domain}/{content_type}/{item_id}/reindex",
            response_model=dict, status_code=202)
async def post_ai_reindex(
    domain: str, content_type: str, item_id: str,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """شروع دوبارهٔ ingestion یک منبع AI."""
    ip, ua = _client(request)
    return await svc.reindex_ai_source(
        db, actor=user, domain=domain, content_type=content_type,
        item_id=item_id, ip=ip, ua=ua,
    )


@router.patch("/placements/{placement_id}", response_model=PlacementOut)
async def patch_placement(
    placement_id: uuid.UUID,
    data: dict,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """به‌روزرسانی جزئی placement (اولویت، بازهٔ زمانی، locale، فعال)."""
    ip, ua = _client(request)
    return await svc.patch_placement(
        db, placement_id, data, actor=user, ip=ip, ua=ua)
