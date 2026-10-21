"""سرویس صندوق واحد محتوا — فاز ۱۴ (ADR-0011).

- صندوق واحد (`list_items`): تجمیع روی adapterهای `control_registry` — بدون
  جدول generic (§۹.۵). صفحه‌بندی cursor-based روی کلید
  (created_at نزولی، domain، content_type، id).
- جزئیات یکپارچه (`get_detail`): پیش‌نمایش، گردش‌کار، تاریخچهٔ نسخه،
  placementها، محتوای مرتبط، scopeهای AI، توزیع، زمان‌بندی، SEO، audit.
- عملیات گروهی (`bulk_action`): گذار/زمان‌بندی/placement/توزیع/export —
  با RBAC (`content.bulk`) و audit به‌ازای هر آیتمِ تغییرکرده.
- توزیع (`is_channel_allowed`): گیت serve-time — ردیف صریح جدول
  `content_distributions`، بعد distribution بومی دامنه، بعد پیش‌فرض ADR-002.
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.audit import log_audit
from app.core.database import ensure_aware
from app.core.errors import APIError
from app.models.models import (
    AuditLog,
    ContentDistribution,
    ContentPlacement,
    User,
)
from app.modules.admin.control_registry import (
    ListFilters,
    get_adapter,
    list_adapters,
    resolve_author_names,
)

CHANNELS: tuple[str, ...] = (
    "web", "mobile", "desktop", "telegram", "ai_knowledge", "search", "embed",
)

BULK_ACTIONS = ("transition", "schedule", "placement", "distribution", "export")


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


# ---------------------------------------------------------------------------
# کرسر صفحه‌بندی
# ---------------------------------------------------------------------------


def _encode_cursor(created_at: datetime, domain: str,
                   content_type: str, item_id: str) -> str:
    raw = json.dumps({
        "t": ensure_aware(created_at).isoformat(),
        "d": domain, "ct": content_type, "id": item_id,
    })
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, str, str, str]:
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        ts = datetime.fromisoformat(raw["t"])
        return ensure_aware(ts), raw["d"], raw["ct"], raw["id"]
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


# ---------------------------------------------------------------------------
# صندوق واحد
# ---------------------------------------------------------------------------


async def list_items(
    db: AsyncSession,
    *,
    q: str | None = None,
    domain: str | None = None,
    content_type: str | None = None,
    status: str | None = None,
    author_id: str | None = None,
    visibility: str | None = None,
    ai_scope: str | None = None,
    distribution_channel: str | None = None,
    placement: str | None = None,  # surface
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> tuple[list[dict], str | None]:
    """تجمیع آیتم‌ها از همهٔ adapterها با فیلترهای صندوق واحد."""
    limit = min(max(limit, 1), 100)
    cursor_ts: datetime | None = None
    cursor_key: tuple | None = None
    if cursor:
        ts, d, ct, iid = _decode_cursor(cursor)
        cursor_ts = ts
        cursor_key = (ts, d, ct, iid)

    if distribution_channel and distribution_channel not in CHANNELS:
        raise APIError(422, "bad_channel", f"کانال نامعتبر: {distribution_channel}")

    adapters = list_adapters(domain=domain, content_type=content_type)
    # اعتبارسنجی زودهنگام ترکیب نامعتبر
    if (domain or content_type) and not adapters:
        raise APIError(
            404, "adapter_not_found",
            f"آداپتر محتوا یافت نشد: {domain}/{content_type}",
        )

    filters = ListFilters(
        q=q, status=status, author_id=author_id, visibility=visibility,
        ai_scope=ai_scope, date_from=date_from, date_to=date_to,
        cursor_ts=cursor_ts, limit=limit,
    )
    merged: list[dict] = []
    for adapter in adapters:
        try:
            items = await adapter.list_fn(db, filters)
        except APIError:
            raise
        except Exception:  # noqa: BLE001 — یک دامنهٔ خراب، کل صندوق را نمی‌شکند
            from app.core.logging import logger

            logger.exception("content adapter failed: %s/%s",
                             adapter.domain, adapter.content_type)
            continue
        merged.extend(items[: limit + 1])

    # placement filter: فقط آیتم‌های دارای placement فعال روی surface خواسته‌شده
    if placement:
        pset = await _placement_content_set(db, surface=placement)
        merged = [
            it for it in merged
            if (it["domain"], it["content_type"], it["id"]) in pset
        ]

    # distribution filter: گیت کانال (ردیف صریح → بومی → پیش‌فرض)
    if distribution_channel:
        kept = []
        for it in merged:
            if await is_channel_allowed(
                db, it["domain"], it["content_type"], it["id"], distribution_channel
            ):
                kept.append(it)
        merged = kept

    merged.sort(key=lambda it: (
        -ensure_aware(it["created_at"]).timestamp(),
        it["domain"], it["content_type"], it["id"],
    ))
    if cursor_key is not None:
        # آیتم‌های «بعد از کرسر» در ترتیب صفحه: قدیمی‌تر، یا هم‌زمان ولی
        # با (domain, content_type, id) بزرگ‌تر
        cts, cd, cct, cid = cursor_key

        def _after_cursor(it: dict) -> bool:
            ts = ensure_aware(it["created_at"])
            if ts < cts:
                return True
            if ts > cts:
                return False
            return (it["domain"], it["content_type"], it["id"]) > (cd, cct, cid)

        merged = [it for it in merged if _after_cursor(it)]

    page = merged[:limit]
    next_cursor = None
    if len(merged) > limit:
        last = page[-1]
        next_cursor = _encode_cursor(
            last["created_at"], last["domain"], last["content_type"], last["id"]
        )

    names = await resolve_author_names(db, [it.get("author_id") for it in page])
    for it in page:
        it["author_name"] = names.get(it.get("author_id") or "")
        # datetime → ISO برای خروجی JSON
        for k in ("created_at", "updated_at", "published_at"):
            v = it.get(k)
            it[k] = ensure_aware(v).isoformat() if v is not None else None
    return page, next_cursor


async def _placement_content_set(db: AsyncSession, *, surface: str) -> set[tuple]:
    rows = (
        await db.execute(
            select(ContentPlacement.domain, ContentPlacement.content_type,
                   ContentPlacement.content_id)
            .where(ContentPlacement.surface == surface,
                   ContentPlacement.active.is_(True))
        )
    ).all()
    return {(d, ct, cid) for d, ct, cid in rows}


# ---------------------------------------------------------------------------
# جزئیات یکپارچه
# ---------------------------------------------------------------------------


async def get_detail(
    db: AsyncSession, domain: str, content_type: str, item_id: str
) -> dict:
    adapter = get_adapter(domain, content_type)
    detail = await adapter.get_fn(db, item_id)
    if detail is None:
        raise APIError(404, "not_found", "محتوا یافت نشد")
    raw = detail.pop("raw", None)

    status = detail.get("status")
    allowed = workflow.next_allowed(status) if status in workflow.STATUSES else []

    # placementهای این محتوا
    placements = (
        await db.execute(
            select(ContentPlacement)
            .where(ContentPlacement.domain == domain,
                   ContentPlacement.content_type == content_type,
                   ContentPlacement.content_id == item_id)
            .order_by(ContentPlacement.sort_order.asc())
        )
    ).scalars().all()

    # توزیع مؤثر هر کانال
    distribution = await get_distribution(db, domain, content_type, item_id)

    # زمان‌بندی‌های آینده
    schedules = (
        await db.execute(
            select(ContentDistribution)
            .where(ContentDistribution.domain == domain,
                   ContentDistribution.content_type == content_type,
                   ContentDistribution.content_id == item_id,
                   ContentDistribution.scheduled_at.is_not(None),
                   ContentDistribution.scheduled_at > _utcnow())
            .order_by(ContentDistribution.scheduled_at.asc())
        )
    ).scalars().all()

    # محتوای مرتبط: ۵ آیتم اخیر هم‌نوع (به‌جز خودش)
    related: list[dict] = []
    try:
        others = await adapter.list_fn(db, ListFilters(limit=6))
        for o in others:
            if o["id"] != item_id:
                related.append({
                    "id": o["id"], "title": o["title"], "status": o["status"],
                    "created_at": ensure_aware(o["created_at"]).isoformat(),
                })
            if len(related) >= 5:
                break
    except Exception:  # noqa: BLE001 — مرتبط‌ها اختیاری‌اند
        pass

    # audit trail
    audits = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == adapter.audit_entity_type,
                   AuditLog.entity_id == item_id)
            .order_by(AuditLog.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    # تاریخچهٔ نسخه (اگر دامنه جدول نسخه دارد — library)
    versions: list[dict] = []
    if (domain, content_type) == ("library", "library_item"):
        from app.models.models import LibraryItemVersion

        vrows = (
            await db.execute(
                select(LibraryItemVersion)
                .where(LibraryItemVersion.item_id == uuid.UUID(item_id))
                .order_by(LibraryItemVersion.version.desc())
                .limit(20)
            )
        ).scalars().all()
        versions = [{
            "version": v.version,
            "created_at": ensure_aware(v.created_at).isoformat(),
            "created_by": str(v.created_by) if v.created_by else None,
            "note": v.note,
        } for v in vrows]

    seo = None
    if raw is not None and hasattr(raw, "seo_meta"):
        seo = raw.seo_meta or {}

    author_name = await resolve_author_names(
        db, [detail.get("author_id")]
    ) if detail.get("author_id") else {}

    return {
        "domain": domain,
        "content_type": content_type,
        "id": item_id,
        "preview": {
            "title": detail.get("title"),
            "excerpt": detail.get("excerpt"),
        },
        "workflow": {
            "status": status,
            "allowed_transitions": allowed,
            "version": detail.get("version"),
        },
        "author": {
            "id": detail.get("author_id"),
            "name": author_name.get(detail.get("author_id") or ""),
        },
        "timestamps": {
            k: (ensure_aware(detail[k]).isoformat() if detail.get(k) else None)
            for k in ("created_at", "updated_at", "published_at")
        },
        "visibility": detail.get("visibility"),
        "ai_scopes": detail.get("ai_scopes") or [],
        "placements": [_placement_out(p) for p in placements],
        "distribution": distribution,
        "schedules": [{
            "channel": s.channel, "enabled": s.enabled,
            "scheduled_at": ensure_aware(s.scheduled_at).isoformat(),
            "schedule_tz": s.schedule_tz,
            "until_at": ensure_aware(s.until_at).isoformat() if s.until_at else None,
        } for s in schedules],
        "related": related,
        "versions": versions,
        "seo": seo,
        "audit": [{
            "id": str(a.id), "actor_id": str(a.actor_id) if a.actor_id else None,
            "actor_type": a.actor_type, "action": a.action,
            "old_values": a.old_values, "new_values": a.new_values,
            "created_at": ensure_aware(a.created_at).isoformat(),
        } for a in audits],
    }


# ---------------------------------------------------------------------------
# عملیات گروهی
# ---------------------------------------------------------------------------


async def bulk_action(
    db: AsyncSession,
    *,
    actor: User,
    items: list[dict],
    action: str,
    params: dict,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """اجرای عملیات گروهی — idempotent تا حد امکان؛ audit به‌ازای هر آیتم تغییرکرده."""
    # نام‌های مستعار سازگار با CRM (set_placement/set_distribution)
    _ALIASES = {"set_placement": "placement", "set_distribution": "distribution"}
    action = _ALIASES.get(action, action)
    if action not in BULK_ACTIONS:
        raise APIError(422, "bad_bulk_action", f"عملیات نامعتبر: {action}")
    if not items:
        raise APIError(422, "empty_bulk", "فهرست آیتم‌ها خالی است")
    if len(items) > 200:
        raise APIError(422, "bulk_too_large", "حداکثر ۲۰۰ آیتم در هر درخواست")

    results: list[dict] = []
    export_rows: list[dict] = []
    for ref in items:
        domain = ref.get("domain")
        content_type = ref.get("content_type")
        item_id = ref.get("id")
        entry: dict[str, Any] = {
            "domain": domain, "content_type": content_type, "id": item_id,
            "ok": False,
        }
        try:
            adapter = get_adapter(domain or "", content_type or "")
        except APIError as exc:
            entry["error"] = {"code": exc.code, "message": exc.message}
            results.append(entry)
            continue
        try:
            if action == "transition":
                entry.update(await _bulk_transition(
                    db, adapter, item_id, params, actor, ip, user_agent))
            elif action == "schedule":
                entry.update(await _bulk_schedule(
                    db, adapter, item_id, params, actor, ip, user_agent))
            elif action == "placement":
                entry.update(await _bulk_placement(
                    db, adapter, item_id, params, actor, ip, user_agent))
            elif action == "distribution":
                entry.update(await _bulk_distribution(
                    db, adapter, item_id, params, actor, ip, user_agent))
            elif action == "export":
                detail = await adapter.get_fn(db, item_id or "")
                if detail is None:
                    raise APIError(404, "not_found", "محتوا یافت نشد")
                export_rows.append({
                    "domain": domain, "content_type": content_type, "id": item_id,
                    "title": detail.get("title"), "status": detail.get("status"),
                    "author_id": detail.get("author_id"),
                    "created_at": (ensure_aware(detail["created_at"]).isoformat()
                                   if detail.get("created_at") else None),
                })
                entry["ok"] = True
        except APIError as exc:
            entry["error"] = {"code": exc.code, "message": exc.message}
        results.append(entry)

    if action == "export":
        await log_audit(
            db, actor_id=actor.id, actor_type="admin", action="content.bulk.export",
            entity_type="content_bulk", entity_id=None,
            new_values={"count": len(export_rows)}, ip=ip, user_agent=user_agent,
        )
        await db.commit()

    ok = sum(1 for r in results if r.get("ok"))
    skipped = sum(1 for r in results if r.get("skipped"))
    failed = sum(1 for r in results if "error" in r)
    out: dict[str, Any] = {
        "action": action, "total": len(results),
        "succeeded": ok, "skipped": skipped, "failed": failed,
        "results": results,
    }
    if action == "export":
        out["export"] = export_rows
    return out


async def _bulk_transition(db, adapter, item_id, params, actor, ip, ua) -> dict:
    to = params.get("to")
    if not to:
        raise APIError(422, "missing_target", "پارامتر to الزامی است")
    if adapter.transition_fn is None:
        raise APIError(422, "transition_unsupported",
                       f"نوع {adapter.content_type} گردش‌کار §۹ ندارد")
    detail = await adapter.get_fn(db, item_id)
    if detail is None:
        raise APIError(404, "not_found", "محتوا یافت نشد")
    current = detail.get("status")
    if current == to:
        return {"ok": True, "skipped": True, "reason": "already_in_target_status"}
    workflow.validate_transition(current, to)  # نامعتبر → 422
    out = await adapter.transition_fn(db, item_id, to, actor)
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.bulk.transition",
        entity_type=adapter.audit_entity_type, entity_id=item_id,
        old_values={"workflow_status": current},
        new_values={"workflow_status": out.get("workflow_status", to)},
        ip=ip, user_agent=ua,
    )
    await db.commit()
    return {"ok": True, "from": current, "to": out.get("workflow_status", to)}


async def _bulk_schedule(db, adapter, item_id, params, actor, ip, ua) -> dict:
    channels = params.get("channels") or ["web"]
    bad = [c for c in channels if c not in CHANNELS]
    if bad:
        raise APIError(422, "bad_channel", f"کانال نامعتبر: {bad}")
    scheduled_at = _as_utc(_parse_dt(params.get("scheduled_at")))
    until_at = _as_utc(_parse_dt(params.get("until_at")))
    schedule_tz = params.get("schedule_tz")
    for ch in channels:
        await set_distribution(
            db, actor=actor, domain=adapter.domain,
            content_type=adapter.content_type, content_id=item_id,
            channel=ch, enabled=params.get("enabled", True),
            scheduled_at=scheduled_at, schedule_tz=schedule_tz,
            until_at=until_at, ip=ip, user_agent=ua, _commit=False,
        )
    await db.commit()
    return {"ok": True, "channels": channels,
            "scheduled_at": scheduled_at.isoformat() if scheduled_at else None}


async def _bulk_placement(db, adapter, item_id, params, actor, ip, ua) -> dict:
    await upsert_placement(
        db, actor=actor, domain=adapter.domain,
        content_type=adapter.content_type, content_id=item_id,
        surface=params.get("surface"), slot=params.get("slot"),
        sort_order=int(params.get("sort_order", 0)),
        audience=params.get("audience") or {},
        starts_at=_as_utc(_parse_dt(params.get("starts_at"))),
        ends_at=_as_utc(_parse_dt(params.get("ends_at"))),
        locale=params.get("locale"),
        active=bool(params.get("active", True)),
        ip=ip, user_agent=ua, _commit=False,
    )
    await db.commit()
    return {"ok": True, "surface": params.get("surface")}


async def _bulk_distribution(db, adapter, item_id, params, actor, ip, ua) -> dict:
    channels = params.get("channels") or {}
    if not isinstance(channels, dict) or not channels:
        raise APIError(422, "bad_channels", "channels باید دیکشنری غیرخالی باشد")
    for ch, cfg in channels.items():
        if ch not in CHANNELS:
            raise APIError(422, "bad_channel", f"کانال نامعتبر: {ch}")
        cfg = cfg or {}
        await set_distribution(
            db, actor=actor, domain=adapter.domain,
            content_type=adapter.content_type, content_id=item_id,
            channel=ch, enabled=bool(cfg.get("enabled", False)),
            scheduled_at=_as_utc(_parse_dt(cfg.get("scheduled_at"))),
            schedule_tz=cfg.get("schedule_tz"),
            until_at=_as_utc(_parse_dt(cfg.get("until_at"))),
            ip=ip, user_agent=ua, _commit=False,
        )
    await db.commit()
    return {"ok": True, "channels": sorted(channels)}


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        raise APIError(422, "bad_datetime", f"قالب تاریخ نامعتبر: {value}")


# ---------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------


def _placement_out(p: ContentPlacement) -> dict:
    return {
        "id": str(p.id), "domain": p.domain, "content_type": p.content_type,
        "content_id": p.content_id, "surface": p.surface, "slot": p.slot,
        "sort_order": p.sort_order, "audience": p.audience or {},
        "starts_at": ensure_aware(p.starts_at).isoformat() if p.starts_at else None,
        "ends_at": ensure_aware(p.ends_at).isoformat() if p.ends_at else None,
        "locale": p.locale, "active": p.active,
        "created_at": ensure_aware(p.created_at).isoformat(),
    }


async def list_placements(
    db: AsyncSession,
    *,
    surface: str | None = None,
    domain: str | None = None,
    content_type: str | None = None,
    content_id: str | None = None,
    active: bool | None = None,
    limit: int = 100,
) -> list[dict]:
    stmt = select(ContentPlacement).order_by(
        ContentPlacement.surface.asc(), ContentPlacement.sort_order.asc()
    )
    if surface:
        stmt = stmt.where(ContentPlacement.surface == surface)
    if domain:
        stmt = stmt.where(ContentPlacement.domain == domain)
    if content_type:
        stmt = stmt.where(ContentPlacement.content_type == content_type)
    if content_id:
        stmt = stmt.where(ContentPlacement.content_id == content_id)
    if active is not None:
        stmt = stmt.where(ContentPlacement.active.is_(active))
    rows = (await db.execute(stmt.limit(min(limit, 500)))).scalars().all()
    return [_placement_out(p) for p in rows]


async def upsert_placement(
    db: AsyncSession,
    *,
    actor: User,
    domain: str,
    content_type: str,
    content_id: str,
    surface: str | None,
    slot: str | None = None,
    sort_order: int = 0,
    audience: dict | None = None,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    locale: str | None = None,
    active: bool = True,
    ip: str | None = None,
    user_agent: str | None = None,
    _commit: bool = True,
) -> dict:
    if not surface:
        raise APIError(422, "missing_surface", "surface الزامی است")
    get_adapter(domain, content_type)  # اعتبارسنجی دامنه/نوع — نامعتبر → 404
    if starts_at and ends_at and starts_at >= ends_at:
        raise APIError(422, "bad_window", "starts_at باید قبل از ends_at باشد")

    stmt = select(ContentPlacement).where(
        ContentPlacement.surface == surface,
        ContentPlacement.slot.is_(None) if slot is None
        else ContentPlacement.slot == slot,
        ContentPlacement.domain == domain,
        ContentPlacement.content_type == content_type,
        ContentPlacement.content_id == content_id,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    old = _placement_out(row) if row else None
    if row is None:
        row = ContentPlacement(
            domain=domain, content_type=content_type, content_id=content_id,
            surface=surface, slot=slot, created_by=actor.id,
        )
        db.add(row)
    row.sort_order = sort_order
    row.audience = audience or {}
    row.starts_at = starts_at
    row.ends_at = ends_at
    row.locale = locale
    row.active = active
    row.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.placement.upsert",
        entity_type="content_placement", entity_id=str(row.id),
        old_values=old, new_values=_placement_out(row), ip=ip, user_agent=user_agent,
    )
    if _commit:
        await db.commit()
        await db.refresh(row)
    return _placement_out(row)


async def delete_placement(
    db: AsyncSession, placement_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> None:
    row = await db.get(ContentPlacement, placement_id)
    if row is None:
        raise APIError(404, "not_found", "placement یافت نشد")
    old = _placement_out(row)
    await db.delete(row)
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.placement.delete",
        entity_type="content_placement", entity_id=str(placement_id),
        old_values=old, ip=ip, user_agent=user_agent,
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Distribution — گیت serve-time
# ---------------------------------------------------------------------------


async def _explicit_distribution_map(
    db: AsyncSession, keys: list[tuple[str, str, str]], channel: str
) -> dict[tuple[str, str, str], ContentDistribution]:
    if not keys:
        return {}
    ors = [
        and_(ContentDistribution.domain == d,
             ContentDistribution.content_type == ct,
             ContentDistribution.content_id == cid,
             ContentDistribution.channel == channel)
        for d, ct, cid in keys
    ]
    rows = (await db.execute(
        select(ContentDistribution).where(or_(*ors)))).scalars().all()
    return {(r.domain, r.content_type, r.content_id): r for r in rows}


async def is_channel_allowed(
    db: AsyncSession,
    domain: str,
    content_type: str,
    content_id: str,
    channel: str,
    *,
    at: datetime | None = None,
) -> bool:
    """آیا این محتوا هم‌اکنون روی این کانال مجاز به سرو است؟

    ترتیب اولویت (ADR-0011):
    ۱) ردیف صریح content_distributions — بالاترین اولویت (override)؛
    ۲) distribution بومی دامنه (ستون JSONB، پیش‌فرض ADR-002 هنگام انتشار)؛
    ۳) هیچ اطلاعاتی نیست → مجاز (حفظ رفتار موجود؛ سیاست‌های قبلی مثل
       TelegramDistributionPolicy مرجع می‌مانند).
    """
    now = ensure_aware(at) if at else _utcnow()
    row = (
        await db.execute(
            select(ContentDistribution).where(
                ContentDistribution.domain == domain,
                ContentDistribution.content_type == content_type,
                ContentDistribution.content_id == content_id,
                ContentDistribution.channel == channel,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return not (
            not row.enabled
            or (row.scheduled_at and ensure_aware(row.scheduled_at) > now)
            or (row.until_at and ensure_aware(row.until_at) <= now)
        )
    # fallback بومی
    try:
        adapter = get_adapter(domain, content_type)
    except APIError:
        return True
    native: dict | None = None
    if adapter.native_distribution_fn is not None:
        try:
            detail = await adapter.get_fn(db, content_id)
            if detail and detail.get("raw") is not None:
                native = adapter.native_distribution_fn(detail["raw"])
        except Exception:  # noqa: BLE001 — fallback امن: مجاز
            native = None
    if isinstance(native, dict) and channel in native:
        return bool(native[channel])
    return True


async def get_distribution(
    db: AsyncSession, domain: str, content_type: str, content_id: str
) -> dict:
    """وضعیت مؤثر هر کانال + منبع آن (explicit | native | default)."""
    get_adapter(domain, content_type)  # 404 اگر نامعتبر
    rows = (
        await db.execute(
            select(ContentDistribution).where(
                ContentDistribution.domain == domain,
                ContentDistribution.content_type == content_type,
                ContentDistribution.content_id == content_id,
            )
        )
    ).scalars().all()
    explicit = {r.channel: r for r in rows}
    native: dict | None = None
    adapter = get_adapter(domain, content_type)
    if adapter.native_distribution_fn is not None:
        try:
            detail = await adapter.get_fn(db, content_id)
            if detail and detail.get("raw") is not None:
                native = adapter.native_distribution_fn(detail["raw"])
        except Exception:  # noqa: BLE001
            native = None
    out: dict[str, dict] = {}
    for ch in CHANNELS:
        if ch in explicit:
            r = explicit[ch]
            out[ch] = {
                "enabled": r.enabled,
                "scheduled_at": ensure_aware(r.scheduled_at).isoformat()
                if r.scheduled_at else None,
                "schedule_tz": r.schedule_tz,
                "until_at": ensure_aware(r.until_at).isoformat()
                if r.until_at else None,
                "source": "explicit",
            }
        elif isinstance(native, dict) and ch in native:
            out[ch] = {"enabled": bool(native[ch]), "source": "native",
                       "scheduled_at": None, "schedule_tz": None, "until_at": None}
        else:
            # هیچ overrideای نیست — رفتار موجود دامنه اعمال می‌شود
            out[ch] = {"enabled": True, "source": "default",
                       "scheduled_at": None, "schedule_tz": None, "until_at": None,
                       "note": "no override — existing domain behavior applies"}
    return {"domain": domain, "content_type": content_type, "id": content_id,
            "channels": out}


async def set_distribution(
    db: AsyncSession,
    *,
    actor: User,
    domain: str,
    content_type: str,
    content_id: str,
    channel: str,
    enabled: bool,
    scheduled_at: datetime | None = None,
    schedule_tz: str | None = None,
    until_at: datetime | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    _commit: bool = True,
) -> dict:
    if channel not in CHANNELS:
        raise APIError(422, "bad_channel", f"کانال نامعتبر: {channel}")
    get_adapter(domain, content_type)  # 404 اگر نامعتبر
    if scheduled_at and until_at and scheduled_at >= until_at:
        raise APIError(422, "bad_window", "scheduled_at باید قبل از until_at باشد")
    row = (
        await db.execute(
            select(ContentDistribution).where(
                ContentDistribution.domain == domain,
                ContentDistribution.content_type == content_type,
                ContentDistribution.content_id == content_id,
                ContentDistribution.channel == channel,
            )
        )
    ).scalar_one_or_none()
    old = None
    if row is None:
        row = ContentDistribution(
            domain=domain, content_type=content_type, content_id=content_id,
            channel=channel,
        )
        db.add(row)
    else:
        old = {"enabled": row.enabled,
               "scheduled_at": row.scheduled_at.isoformat() if row.scheduled_at else None,
               "until_at": row.until_at.isoformat() if row.until_at else None}
    row.enabled = enabled
    row.scheduled_at = scheduled_at
    row.schedule_tz = schedule_tz
    row.until_at = until_at
    row.updated_by = actor.id
    row.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.distribution.set",
        entity_type="content_distribution", entity_id=str(row.id),
        old_values=old,
        new_values={"channel": channel, "enabled": enabled,
                    "scheduled_at": scheduled_at.isoformat() if scheduled_at else None,
                    "until_at": until_at.isoformat() if until_at else None,
                    "content": f"{domain}/{content_type}/{content_id}"},
        ip=ip, user_agent=user_agent,
    )
    if _commit:
        await db.commit()
        await db.refresh(row)
    return {
        "channel": channel, "enabled": row.enabled,
        "scheduled_at": ensure_aware(row.scheduled_at).isoformat()
        if row.scheduled_at else None,
        "schedule_tz": row.schedule_tz,
        "until_at": ensure_aware(row.until_at).isoformat() if row.until_at else None,
        "source": "explicit",
    }


# ---------------------------------------------------------------------------
# تقویم انتشار یکپارچه + تشخیص تعارض
# ---------------------------------------------------------------------------


async def calendar_feed(
    db: AsyncSession, date_from: datetime, date_to: datetime
) -> dict:
    """فید تقویم: انتشارهای انجام‌شده + زمان‌بندی‌شده در بازه + تعارض‌های slot."""
    date_from = _as_utc(date_from) or _utcnow()
    date_to = _as_utc(date_to) or _utcnow()
    items: list[dict] = []
    for adapter in list_adapters():
        try:
            rows = await adapter.list_fn(
                db, ListFilters(date_from=date_from, date_to=date_to, limit=200)
            )
        except Exception:  # noqa: BLE001
            continue
        for it in rows:
            pub = it.get("published_at")
            if pub and date_from <= ensure_aware(pub) <= date_to:
                items.append({
                    "kind": "published",
                    "domain": it["domain"], "content_type": it["content_type"],
                    "id": it["id"], "title": it["title"], "status": it["status"],
                    "at": ensure_aware(pub).isoformat(),
                })
    # زمان‌بندی‌های توزیع
    sched_rows = (
        await db.execute(
            select(ContentDistribution)
            .where(ContentDistribution.enabled.is_(True),
                   ContentDistribution.scheduled_at.is_not(None),
                   ContentDistribution.scheduled_at >= date_from,
                   ContentDistribution.scheduled_at <= date_to)
            .order_by(ContentDistribution.scheduled_at.asc())
            .limit(500)
        )
    ).scalars().all()
    for s in sched_rows:
        items.append({
            "kind": "scheduled",
            "domain": s.domain, "content_type": s.content_type, "id": s.content_id,
            "title": None, "status": None, "channel": s.channel,
            "at": ensure_aware(s.scheduled_at).isoformat(),
        })
    items.sort(key=lambda x: x["at"])

    conflicts = await _detect_placement_conflicts(db)
    return {
        "from": date_from.isoformat(), "to": date_to.isoformat(),
        "items": items, "conflicts": conflicts,
    }


async def _detect_placement_conflicts(db: AsyncSession) -> list[dict]:
    """دو محتوای هم‌زمان در یک slot — فقط placementهای فعال با پنجرهٔ مشخص."""
    rows = (
        await db.execute(
            select(ContentPlacement)
            .where(ContentPlacement.active.is_(True),
                   ContentPlacement.starts_at.is_not(None),
                   ContentPlacement.ends_at.is_not(None))
            .order_by(ContentPlacement.surface.asc(), ContentPlacement.slot.asc())
        )
    ).scalars().all()
    by_slot: dict[tuple, list] = {}
    for p in rows:
        by_slot.setdefault((p.surface, p.slot), []).append(p)
    conflicts: list[dict] = []
    for (surface, slot), plist in by_slot.items():
        for i in range(len(plist)):
            for j in range(i + 1, len(plist)):
                a, b = plist[i], plist[j]
                if a.id == b.id:
                    continue
                if _windows_overlap(a.starts_at, a.ends_at, b.starts_at, b.ends_at):
                    conflicts.append({
                        "surface": surface, "slot": slot,
                        "a": _placement_out(a), "b": _placement_out(b),
                    })
    return conflicts


def _windows_overlap(s1: datetime, e1: datetime, s2: datetime, e2: datetime) -> bool:
    s1, e1, s2, e2 = (ensure_aware(x) for x in (s1, e1, s2, e2))
    return s1 < e2 and s2 < e1


# ---------------------------------------------------------------------------
# افزوده‌های یکپارچه‌سازی فاز ۱۴ — عملیات تکی، فید audit، منابع AI، ترتیب placement
# ---------------------------------------------------------------------------

async def transition_item(
    db: AsyncSession,
    *,
    actor: User,
    domain: str,
    content_type: str,
    item_id: str,
    to: str,
    note: str | None,
    ip: str | None,
    ua: str | None,
) -> dict:
    """گذار تکی گردش‌کار یک آیتم — تب Workflow صفحهٔ جزئیات (تأیید/انتشار/رد).

    همان منطق `_bulk_transition` بدون bulk؛ audit با action تکی ثبت می‌شود.
    """
    adapter = get_adapter(domain, content_type)
    if not to:
        raise APIError(422, "missing_target", "پارامتر to الزامی است")
    if adapter.transition_fn is None:
        raise APIError(422, "transition_unsupported",
                       f"نوع {adapter.content_type} گردش‌کار §۹ ندارد")
    detail = await adapter.get_fn(db, item_id)
    if detail is None:
        raise APIError(404, "not_found", "محتوا یافت نشد")
    current = detail.get("status")
    if current == to:
        return {"ok": True, "skipped": True, "reason": "already_in_target_status",
                "from": current, "to": to}
    workflow.validate_transition(current, to)  # نامعتبر → 422
    out = await adapter.transition_fn(db, item_id, to, actor)
    new_status = out.get("workflow_status", to) if isinstance(out, dict) else to
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.transition",
        entity_type=adapter.audit_entity_type, entity_id=item_id,
        old_values={"workflow_status": current},
        new_values={"workflow_status": new_status, **({"note": note} if note else {})},
        ip=ip, user_agent=ua,
    )
    await db.commit()
    return {"ok": True, "from": current, "to": new_status}


async def reorder_placements(
    db: AsyncSession,
    *,
    actor: User,
    ordered_ids: list[str],
    ip: str | None,
    ua: str | None,
) -> dict:
    """تنظیم sort_order placementها بر اساس ترتیب داده‌شده — جابه‌جایی بدون deploy."""
    if not ordered_ids:
        raise APIError(422, "empty_order", "ordered_ids خالی است")
    if len(ordered_ids) > 200:
        raise APIError(422, "too_many", "حداکثر ۲۰۰ placement در هر درخواست")
    updated = 0
    for idx, raw in enumerate(ordered_ids):
        try:
            pid = uuid.UUID(str(raw))
        except (ValueError, AttributeError):
            raise APIError(422, "bad_placement_id", f"شناسه نامعتبر: {raw}")
        p = await db.get(ContentPlacement, pid)
        if p is None:
            raise APIError(404, "placement_not_found", f"یافت نشد: {raw}")
        p.sort_order = idx
        updated += 1
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.placements.reorder",
        entity_type="content_placement", entity_id=None,
        new_values={"ordered_count": updated}, ip=ip, user_agent=ua,
    )
    await db.commit()
    return {"updated": updated}


async def set_distribution_policy(
    db: AsyncSession,
    *,
    actor: User,
    domain: str,
    content_type: str,
    content_id: str,
    policy: dict[str, bool],
    scheduled_at=None,
    until_at=None,
    ip: str | None = None,
    ua: str | None = None,
) -> dict:
    """تنظیم یکجای سیاست توزیع همهٔ کانال‌ها — تب Distribution."""
    bad = [c for c in policy if c not in CHANNELS]
    if bad:
        raise APIError(422, "bad_channel", f"کانال نامعتبر: {bad}")
    results: dict[str, Any] = {}
    for channel, enabled in policy.items():
        results[channel] = await set_distribution(
            db, actor=actor, domain=domain, content_type=content_type,
            content_id=content_id, channel=channel, enabled=bool(enabled),
            scheduled_at=scheduled_at, until_at=until_at, ip=ip, user_agent=ua,
        )
    return {"policy": results}


async def query_audit(
    db: AsyncSession,
    *,
    domain: str | None = None,
    content_type: str | None = None,
    item_id: str | None = None,
    actor_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """فید audit — تب Audit Log. فیلتر اختیاری روی دامنه/آیتم/کنشگر."""
    limit = min(max(limit, 1), 200)
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if domain:
        adapter = get_adapter(domain, content_type or "")
        stmt = stmt.where(AuditLog.entity_type == adapter.audit_entity_type)
    if item_id:
        stmt = stmt.where(AuditLog.entity_id == item_id)
    if actor_id:
        try:
            stmt = stmt.where(AuditLog.actor_id == uuid.UUID(str(actor_id)))
        except ValueError:
            raise APIError(422, "bad_actor_id", "actor_id نامعتبر است")
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "id": str(a.id), "actor_id": str(a.actor_id) if a.actor_id else None,
        "actor_type": a.actor_type, "action": a.action,
        "entity_type": a.entity_type, "entity_id": a.entity_id,
        "old_values": a.old_values, "new_values": a.new_values,
        "ip": a.ip, "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in rows]


async def list_ai_sources(
    db: AsyncSession,
    *,
    scope: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """مرکز منابع AI — آیتم‌هایی که حداقل یک ai_scope دارند، با provenance."""
    limit = min(max(limit, 1), 200)
    out: list[dict] = []
    for adapter in list_adapters():
        try:
            items = await adapter.list_fn(db, ListFilters(limit=50))
        except Exception:  # noqa: BLE001 — یک دامنهٔ خراب، مرکز را خراب نکند
            continue
        if not isinstance(items, list):
            continue
        for it in items:
            scopes = it.get("ai_scopes") or []
            if not scopes:
                continue
            if scope and scope not in scopes:
                continue
            out.append({
                "domain": adapter.domain, "content_type": adapter.content_type,
                "id": str(it.get("id")), "title": it.get("title"),
                "status": it.get("status"), "author_id": it.get("author_id"),
                "ai_scopes": scopes,
                "updated_at": it.get("updated_at").isoformat() if hasattr(it.get("updated_at"), "isoformat") else it.get("updated_at"),
                "reindex_supported": (adapter.domain, adapter.content_type)
                                     == ("library", "library_item"),
            })
            if len(out) >= limit:
                return out
    return out


async def reindex_ai_source(
    db: AsyncSession,
    *,
    actor: User,
    domain: str,
    content_type: str,
    item_id: str,
    ip: str | None,
    ua: str | None,
) -> dict:
    """شروع دوبارهٔ ingestion یک منبع AI — فعلاً فقط library_item (فاز ۶/۹)."""
    if (domain, content_type) != ("library", "library_item"):
        raise APIError(422, "reindex_unsupported",
                       f"re-index برای {domain}/{content_type} پشتیبانی نمی‌شود")
    adapter = get_adapter(domain, content_type)
    detail = await adapter.get_fn(db, item_id)
    if detail is None:
        raise APIError(404, "not_found", "محتوا یافت نشد")
    scopes = detail.get("ai_scopes") or ["fatwa"]
    from app.modules.fatwa import service as fatwa_svc
    run = await fatwa_svc.trigger_ingestion(
        db, actor, source_type="file",
        payload={"library_item_id": item_id},
        topic_category=None, madhab_scope=None,
        ai_scopes=[s for s in scopes if s in
                   ("fatwa", "assistant", "quiz", "verification", "semantic_search")] or ["fatwa"],
        source_citation={"type": "library_item", "id": item_id},
    )
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.ai.reindex",
        entity_type=adapter.audit_entity_type, entity_id=item_id,
        new_values={"run_id": str(run.id)}, ip=ip, user_agent=ua,
    )
    await db.commit()
    return {"run_id": str(run.id), "status": run.status}


_PLACEMENT_PATCHABLE = {"surface", "slot", "sort_order", "audience",
                        "starts_at", "ends_at", "locale", "active"}


async def patch_placement(
    db: AsyncSession,
    placement_id: uuid.UUID,
    patch: dict,
    *,
    actor: User,
    ip: str | None,
    ua: str | None,
) -> dict:
    """به‌روزرسانی جزئی placement."""
    p = await db.get(ContentPlacement, placement_id)
    if p is None:
        raise APIError(404, "placement_not_found", "placement یافت نشد")
    bad = [k for k in patch if k not in _PLACEMENT_PATCHABLE]
    if bad:
        raise APIError(422, "bad_patch_field", f"فیلد نامعتبر: {bad}")
    old = {k: getattr(p, k) for k in patch if k in _PLACEMENT_PATCHABLE}
    for k, v in patch.items():
        if k in _PLACEMENT_PATCHABLE:
            setattr(p, k, v)
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="content.placement.patch",
        entity_type="content_placement", entity_id=str(placement_id),
        old_values={k: str(v) for k, v in old.items()},
        new_values={k: str(v) for k, v in patch.items() if k in _PLACEMENT_PATCHABLE},
        ip=ip, user_agent=ua,
    )
    await db.commit()
    await db.refresh(p)
    return _placement_out(p)
