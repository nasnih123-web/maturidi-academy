"""سرویس CMS — فاز ۴ (قرارداد §۹.۵).

**اصل §۱۵:** روتر هرگز به دیتابیس دست نمی‌زند؛ همهٔ منطق اینجاست.

- هر شش منبع: CRUD + `transition` روی ماشین مشترک `app/core/workflow.py` (§۹).
- هر انتشار یک `domain_event` در outbox می‌نویسد (§۴) و یک audit log (§۱۴).
- پیش‌فرض distribution هنگام انتشار (تصمیم ADR-002): فقط `web=true`، بقیه
  surfaceها false — مگر اینکه هنگام ساخت صریحاً تنظیم شده باشند.
- خواندن‌های عمومی (`list_public_*`) فقط آیتم‌های published + درون پنجرهٔ
  زمانی + visible را برمی‌گردانند.
- `run_islamic_calendar_cycle`: کرون روزانهٔ تقویم اسلامی — انتشار خودکار
  رویدادهای امروزِ هجری + فعال‌سازی/بازگشت تم. «امروز» قابل تزریق است تا
  تست‌پذیر باشد.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.audit import log_audit
from app.core.database import ensure_aware
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.hijri import hijri_month_day, utc_today
from app.core.platform_settings import (
    bump_settings_version,
    get_setting,
    stage_setting,
)
from app.models.models import (
    Announcement,
    Banner,
    IslamicEvent,
    NavItem,
    Page,
    ScholarQuote,
    Theme,
)

# ---------------------------------------------------------------------------
# قراردادهای داخلی
# ---------------------------------------------------------------------------

DEFAULT_DISTRIBUTION: dict[str, bool] = {
    "web": True,
    "mobile": False,
    "desktop": False,
    "telegram": False,
    "ai_knowledge": False,
}

# کلیدهای platform_settings برای وضعیت تمِ فعالِ تقویم (ADR-002)
CALENDAR_ACTIVE_KEY = "cms.calendar.active"  # {"event_id","theme_id","activated_at"}
CALENDAR_DEFAULT_THEME_KEY = "cms.calendar.default_theme_id"

EVENT_PREFIX = {
    "events": "islamic_event",
    "quotes": "scholar_quote",
    "pages": "page",
    "nav": "nav_item",
    "banners": "banner",
    "announcements": "announcement",
}

_MODELS = {
    "events": IslamicEvent,
    "quotes": ScholarQuote,
    "pages": Page,
    "nav": NavItem,
    "banners": Banner,
    "announcements": Announcement,
}

# فیلترهای مجاز لیست ادمین به‌ازای هر منبع
_LIST_FILTERS = {
    "events": ("workflow_status",),
    "quotes": ("workflow_status",),
    "pages": ("workflow_status",),
    "nav": ("locale",),
    "banners": ("workflow_status", "placement"),
    "announcements": ("workflow_status", "placement"),
}

_WORKFLOW_MODELS = {"events", "quotes", "pages", "banners", "announcements"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime | None) -> datetime | None:
    """نرمال‌سازی ورودی زمان‌بندی به UTC آگاه (§۱: زمان در DB همیشه UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _in_window(
    starts_at: datetime | None, ends_at: datetime | None, now: datetime
) -> bool:
    """آیا now درون پنجرهٔ [starts_at, ends_at] است؟ None یعنی باز."""
    if starts_at is not None and ensure_aware(starts_at) > now:
        return False
    if ends_at is not None and ensure_aware(ends_at) < now:
        return False
    return True


def _to_dict(obj: Any) -> dict[str, Any]:
    """سریال‌سازی عمومی مدل → dict (UUID و تاریخ به رشته)."""
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        v = getattr(obj, col.name)
        if isinstance(v, uuid.UUID):
            v = str(v)
        elif isinstance(v, datetime):
            v = ensure_aware(v).isoformat()
        elif isinstance(v, date):
            v = v.isoformat()
        out[col.name] = v
    return out


def _dump_localized(value: Any) -> Any:
    """LocalizedText ورودی pydantic → dict قابل ذخیره."""
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value


def _prepare_create(resource: str, data: dict[str, Any]) -> dict[str, Any]:
    """نرمال‌سازی ورودی ساخت: LocalizedTextها، زمان‌ها، مقادیر پیش‌فرض."""
    prepared: dict[str, Any] = {}
    for key, value in data.items():
        if key in ("name", "text", "scholar", "title", "subtitle", "label", "message"):
            prepared[key] = _dump_localized(value)
        elif key in ("starts_at", "ends_at"):
            prepared[key] = _as_utc(value)
        elif key == "distribution":
            prepared[key] = value.model_dump() if value is not None else None
        elif key == "theme_id" and value is not None:
            prepared[key] = uuid.UUID(str(value))
        elif key == "parent_id" and value is not None:
            prepared[key] = uuid.UUID(str(value))
        else:
            prepared[key] = value
    return prepared


# ---------------------------------------------------------------------------
# CRUD عمومی
# ---------------------------------------------------------------------------


async def list_items(
    db: AsyncSession,
    resource: str,
    *,
    workflow_status: str | None = None,
    placement: str | None = None,
    locale: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    model = _MODELS[resource]
    stmt = select(model)
    if workflow_status and "workflow_status" in _LIST_FILTERS[resource]:
        if workflow_status not in workflow.STATUSES:
            raise APIError(422, "unknown_status", f"وضعیت ناشناخته: {workflow_status}")
        stmt = stmt.where(model.workflow_status == workflow_status)
    if placement and "placement" in _LIST_FILTERS[resource]:
        stmt = stmt.where(model.placement == placement)
    if locale and "locale" in _LIST_FILTERS[resource]:
        stmt = stmt.where(model.locale == locale)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    if resource == "nav":
        stmt = stmt.order_by(model.parent_id.is_(None).desc(), model.sort_order.asc())
    else:
        stmt = stmt.order_by(model.created_at.desc())
    rows = (await db.execute(stmt.limit(min(limit, 200)).offset(max(offset, 0)))).scalars().all()
    return [_to_dict(r) for r in rows], total


async def get_item(db: AsyncSession, resource: str, item_id: str) -> dict:
    model = _MODELS[resource]
    try:
        uid = uuid.UUID(item_id)
    except ValueError:
        raise APIError(404, "not_found", "آیتم یافت نشد")
    obj = await db.get(model, uid)
    if obj is None:
        raise APIError(404, "not_found", "آیتم یافت نشد")
    return _to_dict(obj)


async def create_item(
    db: AsyncSession, resource: str, data: dict[str, Any], *, actor_id: uuid.UUID
) -> dict:
    model = _MODELS[resource]
    if resource == "pages":
        exists = (
            await db.execute(select(Page.id).where(Page.slug == data.get("slug")))
        ).scalar_one_or_none()
        if exists:
            raise APIError(409, "slug_taken", "این slug قبلاً استفاده شده است")
    obj = model(**_prepare_create(resource, data))
    obj.created_by = actor_id
    db.add(obj)
    await db.flush()
    prefix = EVENT_PREFIX[resource]
    await emit_event(
        db,
        aggregate_type=prefix,
        aggregate_id=str(obj.id),
        event_type=f"{prefix}.created",
        payload={"workflow_status": obj.workflow_status, "version": obj.version}
        if hasattr(obj, "workflow_status")
        else {"id": str(obj.id)},
    )
    await log_audit(
        db,
        actor_id=actor_id,
        actor_type="admin",
        action=f"cms.{resource}.create",
        entity_type=prefix,
        entity_id=str(obj.id),
        new_values={"id": str(obj.id)},
    )
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)


async def update_item(
    db: AsyncSession, resource: str, item_id: str, data: dict[str, Any], *, actor_id: uuid.UUID
) -> dict:
    model = _MODELS[resource]
    obj = await db.get(model, _uuid_or_404(item_id))
    if obj is None:
        raise APIError(404, "not_found", "آیتم یافت نشد")
    if resource == "pages" and "slug" in data:
        raise APIError(422, "slug_immutable", "تغییر slug پس از ساخت مجاز نیست")
    prepared = _prepare_create(resource, data)
    old_status = getattr(obj, "workflow_status", None)
    for key, value in prepared.items():
        setattr(obj, key, value)
    if hasattr(obj, "version"):
        obj.version = (obj.version or 0) + 1
    db.add(obj)
    await db.flush()
    prefix = EVENT_PREFIX[resource]
    await emit_event(
        db,
        aggregate_type=prefix,
        aggregate_id=str(obj.id),
        event_type=f"{prefix}.updated",
        payload={"workflow_status": old_status, "version": obj.version}
        if old_status is not None
        else {"version": getattr(obj, "version", None)},
    )
    await log_audit(
        db,
        actor_id=actor_id,
        actor_type="admin",
        action=f"cms.{resource}.update",
        entity_type=prefix,
        entity_id=str(obj.id),
        new_values={"updated_fields": sorted(prepared.keys())},
    )
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)


async def transition_item(
    db: AsyncSession, resource: str, item_id: str, to: str, *, actor_id: uuid.UUID
) -> dict:
    """گذار گردش‌کار روی ماشین مشترک §۹ — انتشار پیش‌فرض distribution را اعمال می‌کند."""
    if resource not in _WORKFLOW_MODELS:
        raise APIError(422, "no_workflow", "این منبع گردش‌کار ندارد")
    model = _MODELS[resource]
    obj = await db.get(model, _uuid_or_404(item_id))
    if obj is None:
        raise APIError(404, "not_found", "آیتم یافت نشد")
    current = obj.workflow_status
    workflow.validate_transition(current, to)  # نامعتبر → 422
    obj.workflow_status = to
    obj.version = (obj.version or 0) + 1
    if to == workflow.PUBLISHED:
        if resource == "pages" and obj.published_at is None:
            obj.published_at = _utcnow()
        if obj.distribution is None:
            obj.distribution = dict(DEFAULT_DISTRIBUTION)
    db.add(obj)
    await db.flush()
    prefix = EVENT_PREFIX[resource]
    await emit_event(
        db,
        aggregate_type=prefix,
        aggregate_id=str(obj.id),
        event_type=f"{prefix}.{to}",
        payload={
            "from": current,
            "to": to,
            "version": obj.version,
            "distribution": obj.distribution,
        },
    )
    await log_audit(
        db,
        actor_id=actor_id,
        actor_type="admin",
        action=f"cms.{resource}.transition",
        entity_type=prefix,
        entity_id=str(obj.id),
        old_values={"workflow_status": current},
        new_values={"workflow_status": to, "version": obj.version},
    )
    await db.commit()
    await db.refresh(obj)
    return _to_dict(obj)


async def archive_item(db: AsyncSession, resource: str, item_id: str, *, actor_id: uuid.UUID) -> dict:
    """حذف = بایگانی — رکورد هرگز فیزیکی حذف نمی‌شود (§۹.۵).

    برای nav_items که گردش‌کار ندارند، بایگانی یعنی visible=false.
    """
    if resource == "nav":
        model = _MODELS["nav"]
        obj = await db.get(model, _uuid_or_404(item_id))
        if obj is None:
            raise APIError(404, "not_found", "آیتم یافت نشد")
        obj.visible = False
        db.add(obj)
        await db.flush()
        await emit_event(
            db,
            aggregate_type="nav_item",
            aggregate_id=str(obj.id),
            event_type="nav_item.archived",
            payload={"visible": False},
        )
        await log_audit(
            db,
            actor_id=actor_id,
            actor_type="admin",
            action="cms.nav.archive",
            entity_type="nav_item",
            entity_id=str(obj.id),
            old_values={"visible": True},
            new_values={"visible": False},
        )
        await db.commit()
        await db.refresh(obj)
        return _to_dict(obj)
    return await transition_item(db, resource, item_id, workflow.ARCHIVED, actor_id=actor_id)


def _uuid_or_404(item_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(item_id)
    except ValueError:
        raise APIError(404, "not_found", "آیتم یافت نشد")


# ---------------------------------------------------------------------------
# خواندن‌های عمومی — فقط published + درون پنجره + visible
# ---------------------------------------------------------------------------


async def list_public_nav(db: AsyncSession, locale: str | None = None) -> list[dict]:
    now = _utcnow()
    stmt = (
        select(NavItem)
        .where(NavItem.visible.is_(True))
        .order_by(NavItem.parent_id.is_(None).desc(), NavItem.sort_order.asc())
    )
    if locale:
        stmt = stmt.where((NavItem.locale.is_(None)) | (NavItem.locale == locale))
    rows = (await db.execute(stmt)).scalars().all()
    items = [
        _to_dict(r) for r in rows if _in_window(r.starts_at, r.ends_at, now)
    ]
    return _build_nav_tree(items)


def _build_nav_tree(items: list[dict]) -> list[dict]:
    by_id = {i["id"]: {**i, "children": []} for i in items}
    roots: list[dict] = []
    for i in items:
        node = by_id[i["id"]]
        parent = by_id.get(i.get("parent_id") or "")
        if parent is not None:
            parent["children"].append(node)
        else:
            roots.append(node)
    return roots


async def list_public_banners(
    db: AsyncSession, placement: str | None = None
) -> list[dict]:
    now = _utcnow()
    stmt = (
        select(Banner)
        .where(Banner.workflow_status == workflow.PUBLISHED)
        .order_by(Banner.priority.desc(), Banner.created_at.desc())
    )
    if placement:
        stmt = stmt.where(Banner.placement == placement)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(r) for r in rows if _in_window(r.starts_at, r.ends_at, now)]


async def list_public_announcements(
    db: AsyncSession, placement: str | None = None
) -> list[dict]:
    now = _utcnow()
    stmt = (
        select(Announcement)
        .where(Announcement.workflow_status == workflow.PUBLISHED)
        .order_by(Announcement.created_at.desc())
    )
    if placement:
        stmt = stmt.where(Announcement.placement == placement)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(r) for r in rows if _in_window(r.starts_at, r.ends_at, now)]


async def get_public_page(db: AsyncSession, slug: str) -> dict:
    obj = (
        await db.execute(
            select(Page).where(
                Page.slug == slug, Page.workflow_status == workflow.PUBLISHED
            )
        )
    ).scalar_one_or_none()
    if obj is None:
        raise APIError(404, "page_not_found", "صفحه یافت نشد")
    return _to_dict(obj)


async def list_public_events(
    db: AsyncSession,
    hijri_month: int | None = None,
    hijri_day: int | None = None,
) -> list[dict]:
    stmt = (
        select(IslamicEvent)
        .where(IslamicEvent.workflow_status == workflow.PUBLISHED)
        .order_by(IslamicEvent.hijri_month.asc(), IslamicEvent.hijri_day.asc())
    )
    if hijri_month:
        stmt = stmt.where(IslamicEvent.hijri_month == hijri_month)
    if hijri_day:
        stmt = stmt.where(IslamicEvent.hijri_day == hijri_day)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(r) for r in rows]


async def list_public_quotes(
    db: AsyncSession, placement: str | None = None
) -> list[dict]:
    rows = (
        await db.execute(
            select(ScholarQuote)
            .where(ScholarQuote.workflow_status == workflow.PUBLISHED)
            .order_by(ScholarQuote.created_at.desc())
        )
    ).scalars().all()
    out = []
    for r in rows:
        placements = r.placements or []
        if placement and placement not in placements:
            continue
        out.append(_to_dict(r))
    return out


async def get_active_calendar_theme(db: AsyncSession) -> dict:
    """تمِ فعالِ امروزِ تقویم — مصرف‌کننده: وب/موبایل برای سوئیچ تم مناسبتی."""
    raw = await get_setting(db, CALENDAR_ACTIVE_KEY)
    active = json.loads(raw) if raw else {}
    month, day = hijri_month_day()
    return {
        "theme_id": active.get("theme_id"),
        "event_id": active.get("event_id"),
        "hijri": {"month": month, "day": day},
    }


# ---------------------------------------------------------------------------
# کرون روزانهٔ تقویم اسلامی
# ---------------------------------------------------------------------------


async def run_islamic_calendar_cycle(
    db: AsyncSession, today: date | None = None
) -> dict[str, Any]:
    """یک چرخهٔ روزانه: انتشار خودکار + فعال‌سازی/بازگشت تم.

    - رویدادهای auto_publish که (ماه، روز) هجری‌شان با امروز می‌خواند:
      اگر needs_admin_confirmation=False باشند از هر وضعیتی (draft/in_review)
      منتشر می‌شوند؛ اگر True باشند فقط وقتی قبلاً approved شده‌اند (تأیید ادمین).
    - اگر رویدادی با theme_id برای امروز فعال باشد، تمش در platform_settings
      (کلید cms.calendar.active) ثبت می‌شود؛ وقتی پنجره تمام شد یا رویدادی
      برای امروز نیست، به تم پیش‌فرض (cms.calendar.default_theme_id) برمی‌گردیم.
    - idempotent است: اجرای دوباره در یک روز «unchanged» برمی‌گرداند.
    """
    today = today or utc_today()
    now = _utcnow()
    month, day = hijri_month_day(today)
    result: dict[str, Any] = {
        "date": today.isoformat(),
        "hijri": {"month": month, "day": day},
        "published": [],
        "theme": None,
    }

    # ۱) انتشار خودکار رویدادهای امروز
    candidates = (
        await db.execute(
            select(IslamicEvent).where(
                IslamicEvent.hijri_month == month,
                IslamicEvent.hijri_day == day,
                IslamicEvent.auto_publish.is_(True),
                IslamicEvent.workflow_status.in_(
                    [workflow.DRAFT, workflow.IN_REVIEW, workflow.APPROVED]
                ),
            )
        )
    ).scalars().all()
    # گام‌های باقی‌ماندهٔ زنجیرهٔ §۹ از وضعیت فعلی (بدون جهش)
    _REMAINING_STEPS = {
        workflow.DRAFT: (workflow.IN_REVIEW, workflow.APPROVED, workflow.PUBLISHED),
        workflow.IN_REVIEW: (workflow.APPROVED, workflow.PUBLISHED),
        workflow.APPROVED: (workflow.PUBLISHED,),
    }
    for ev in candidates:
        if ev.needs_admin_confirmation and ev.workflow_status != workflow.APPROVED:
            continue  # منتظر تأیید ادمین از CRM
        # انتشار خودکارِ سیستمی: ادامهٔ زنجیره از وضعیت فعلی
        for step in _REMAINING_STEPS[ev.workflow_status]:
            workflow.validate_transition(ev.workflow_status, step)
            ev.workflow_status = step
        ev.version = (ev.version or 0) + 1
        if ev.distribution is None:
            ev.distribution = dict(DEFAULT_DISTRIBUTION)
        db.add(ev)
        await emit_event(
            db,
            aggregate_type="islamic_event",
            aggregate_id=str(ev.id),
            event_type="islamic_event.auto_published",
            payload={
                "hijri_month": month,
                "hijri_day": day,
                "theme_id": str(ev.theme_id) if ev.theme_id else None,
            },
            source_client="cron",
        )
        result["published"].append(str(ev.id))

    # ۲) تم مناسبتی: نامزدِ امروز = رویداد published امروز که پنجره‌اش باز است
    themed = (
        await db.execute(
            select(IslamicEvent).where(
                IslamicEvent.hijri_month == month,
                IslamicEvent.hijri_day == day,
                IslamicEvent.workflow_status == workflow.PUBLISHED,
                IslamicEvent.theme_id.is_not(None),
            ).order_by(IslamicEvent.created_at.asc())
        )
    ).scalars().all()
    candidate = next(
        (e for e in themed if _in_window(e.starts_at, e.ends_at, now)), None
    )

    raw = await get_setting(db, CALENDAR_ACTIVE_KEY)
    active = json.loads(raw) if raw else {}
    active_event_id = active.get("event_id")

    if candidate is not None and str(candidate.id) != active_event_id:
        new_active = {
            "event_id": str(candidate.id),
            "theme_id": str(candidate.theme_id),
            "activated_at": now.isoformat(),
        }
        await stage_setting(db, CALENDAR_ACTIVE_KEY, json.dumps(new_active))
        await emit_event(
            db,
            aggregate_type="islamic_event",
            aggregate_id=str(candidate.id),
            event_type="islamic_event.theme_activated",
            payload={"theme_id": str(candidate.theme_id)},
            source_client="cron",
        )
        result["theme"] = {"action": "activated", **new_active}
    elif candidate is None and active_event_id:
        default_theme_id = await get_setting(db, CALENDAR_DEFAULT_THEME_KEY)
        new_active = {
            "event_id": None,
            "theme_id": default_theme_id or None,
            "activated_at": None,
        }
        await stage_setting(db, CALENDAR_ACTIVE_KEY, json.dumps(new_active))
        await emit_event(
            db,
            aggregate_type="islamic_event",
            aggregate_id=active_event_id,
            event_type="islamic_event.theme_reverted",
            payload={"theme_id": default_theme_id},
            source_client="cron",
        )
        result["theme"] = {"action": "reverted", **new_active}
    else:
        result["theme"] = {"action": "unchanged", "event_id": active_event_id}

    bump_settings_version([CALENDAR_ACTIVE_KEY])
    await db.commit()
    return result


async def ensure_calendar_settings(db: AsyncSession) -> None:
    """مقداردهی اولیهٔ idempotent کلیدهای تقویم — از seed صدا زده می‌شود."""
    if await get_setting(db, CALENDAR_ACTIVE_KEY) is None:
        await stage_setting(db, CALENDAR_ACTIVE_KEY, json.dumps({}))
    if await get_setting(db, CALENDAR_DEFAULT_THEME_KEY) is None:
        active_theme = (
            await db.execute(select(Theme).where(Theme.is_active.is_(True)))
        ).scalar_one_or_none()
        await stage_setting(
            db,
            CALENDAR_DEFAULT_THEME_KEY,
            str(active_theme.id) if active_theme else "",
        )
    bump_settings_version([CALENDAR_ACTIVE_KEY, CALENDAR_DEFAULT_THEME_KEY])
    await db.commit()


# ---------------------------------------------------------------------------
# seed صفحه‌های حقوقی
# ---------------------------------------------------------------------------


async def seed_legal_pages(db: AsyncSession) -> None:
    """ساخت/به‌روزرسانی idempotent صفحه‌های terms و privacy (وضعیت published).

    از seed.py صدا زده می‌شود. نسخهٔ متن در legal.LEGAL_TEXT_VERSION است —
    همان مقداری که register() در ردیف‌های user_consent ثبت می‌کند.
    """
    from .legal import PRIVACY_BLOCKS, PRIVACY_TITLE, TERMS_BLOCKS, TERMS_TITLE

    now = _utcnow()
    for slug, title, blocks in (
        ("terms", TERMS_TITLE, TERMS_BLOCKS),
        ("privacy", PRIVACY_TITLE, PRIVACY_BLOCKS),
    ):
        obj = (
            await db.execute(select(Page).where(Page.slug == slug))
        ).scalar_one_or_none()
        if obj is None:
            obj = Page(
                slug=slug,
                title=dict(title),
                blocks=[dict(b) for b in blocks],
                seo_meta={"robots": "index,follow"},
                content_type="page",
                workflow_status=workflow.PUBLISHED,
                published_at=now,
                distribution=dict(DEFAULT_DISTRIBUTION),
                created_by=None,  # سیستمی
            )
            db.add(obj)
        else:
            obj.title = dict(title)
            obj.blocks = [dict(b) for b in blocks]
            obj.workflow_status = workflow.PUBLISHED
            if obj.published_at is None:
                obj.published_at = now
            obj.version = (obj.version or 0) + 1
        await db.flush()
    await db.commit()
