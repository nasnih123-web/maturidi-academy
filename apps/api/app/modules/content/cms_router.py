"""روتر CMS — فاز ۴ (قرارداد §۹.۵).

دو دسته endpoint زیر یک prefix:
- مدیریتی (`/events` …): نیازمند احراز هویت؛ ساخت/ویرایش/بایگانی با مجوز
  `content.create`، انتشار (`transition` به `published`) با `content.publish`.
- عمومی (`/public/…`): بدون احراز هویت؛ فقط آیتم‌های published + درون پنجرهٔ
  زمانی + visible.

فقط سیم‌کشی؛ منطق در cms_service.py (§۱۵.۶).

نکته: این فایل عمداً `from __future__ import annotations` ندارد، چون
annotationهای body در _register_resource به متغیر closure (کلاس اسکیما)
ارجاع می‌دهند و FastAPI باید آن‌ها را در زمان تعریف resolve کند.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.content import cms_schemas as S
from app.modules.content import cms_service as service

router = APIRouter(prefix="/api/v1/content", tags=["cms"])

_can_create = require_permission("content.create")
_can_publish = require_permission("content.publish")


def _register_resource(
    resource: str,
    create_schema: type[BaseModel],
    update_schema: type[BaseModel],
    summary: str,
) -> None:
    """ثبت شش endpoint مدیریتی یک منبع CMS — الگوی یکدست برای هر شش جدول."""

    @router.get(
        f"/{resource}",
        response_model=S.ItemsOut,
        operation_id=f"cms_list_{resource}",
    )
    async def list_resource(
        workflow_status: str | None = Query(default=None, description="فیلتر وضعیت §۹"),
        placement: str | None = Query(default=None, description="فیلتر placement"),
        locale: str | None = Query(default=None, description="فیلتر locale"),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        cursor: str | None = Query(default=None, description="کرسر صفحه‌بندی (m-01) — بر offset مقدم است"),
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        """لیست مدیریتی منبع — همهٔ وضعیت‌ها؛ فیلتر workflow_status/placement/locale."""
        items, total, next_cursor = await service.list_items(
            db,
            resource,
            workflow_status=workflow_status,
            placement=placement,
            locale=locale,
            limit=limit,
            offset=offset,
            cursor=cursor,
        )
        return S.ItemsOut(items=items, total=total, next_cursor=next_cursor)

    @router.post(f"/{resource}", operation_id=f"cms_create_{resource}", status_code=201)
    async def create_resource(
        body: create_schema,  # type: ignore[valid-type]
        user: User = Depends(_can_create),
        db: AsyncSession = Depends(get_db),
    ):
        """ساخت آیتم جدید — نیازمند مجوز content.create."""
        # body نمونهٔ create_schema (زیرکلاس BaseModel) است؛ چون annotation
        # داینامیک است، model_dump از خود BaseModel صدا زده می‌شود.
        return await service.create_item(
            db, resource, BaseModel.model_dump(body), actor_id=user.id
        )

    @router.get(f"/{resource}/{{item_id}}", operation_id=f"cms_get_{resource}")
    async def get_resource(
        item_id: str,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        """جزئیات آیتم — هر وضعیتی (مدیریتی)."""
        return await service.get_item(db, resource, item_id)

    @router.patch(f"/{resource}/{{item_id}}", operation_id=f"cms_update_{resource}")
    async def update_resource(
        item_id: str,
        body: update_schema,  # type: ignore[valid-type]
        user: User = Depends(_can_create),
        db: AsyncSession = Depends(get_db),
    ):
        """ویرایش جزئی — نیازمند مجوز content.create."""
        return await service.update_item(
            db,
            resource,
            item_id,
            BaseModel.model_dump(body, exclude_unset=True),
            actor_id=user.id,
        )

    @router.delete(f"/{resource}/{{item_id}}", operation_id=f"cms_delete_{resource}")
    async def delete_resource(
        item_id: str,
        user: User = Depends(_can_create),
        db: AsyncSession = Depends(get_db),
    ):
        """حذف = بایگانی (گذار به archived) — رکورد فیزیکی حذف نمی‌شود (§۹.۵)."""
        return await service.archive_item(db, resource, item_id, actor_id=user.id)

    @router.post(
        f"/{resource}/{{item_id}}/transition",
        operation_id=f"cms_transition_{resource}",
    )
    async def transition_resource(
        item_id: str,
        body: S.TransitionIn,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        """گذار گردش‌کار §۹ — انتشار (to=published) نیازمند content.publish است،
        بقیهٔ گذارها نیازمند content.create. گذار نامعتبر → 422."""
        checker = _can_publish if body.to == "published" else _can_create
        await checker(user=user, db=db)
        return await service.transition_item(db, resource, item_id, body.to, actor_id=user.id)

    for fn, doc in (
        (list_resource, f"لیست مدیریتی {summary}"),
        (create_resource, f"ساخت {summary} جدید"),
        (get_resource, f"جزئیات {summary}"),
        (update_resource, f"ویرایش {summary}"),
        (delete_resource, f"بایگانی {summary}"),
        (transition_resource, f"گذار گردش‌کار {summary}"),
    ):
        fn.__doc__ = doc


_register_resource("events", S.IslamicEventCreate, S.IslamicEventUpdate, "رویداد اسلامی")
_register_resource("quotes", S.ScholarQuoteCreate, S.ScholarQuoteUpdate, "نقل‌قول علما")
_register_resource("pages", S.PageCreate, S.PageUpdate, "صفحهٔ CMS")
_register_resource("nav", S.NavItemCreate, S.NavItemUpdate, "آیتم ناوبری")
_register_resource("banners", S.BannerCreate, S.BannerUpdate, "بنر")
_register_resource(
    "announcements", S.AnnouncementCreate, S.AnnouncementUpdate, "اعلان"
)


# ---------------------------------------------------------------------------
# خواندن‌های عمومی — published + درون پنجره + visible
# ---------------------------------------------------------------------------


@router.get("/public/nav", response_model=list[S.NavItemOut])
async def public_nav(
    locale: str | None = Query(default=None, description="fa | ar | en — خالی یعنی همه"),
    db: AsyncSession = Depends(get_db),
):
    """درخت ناوبری عمومی — فقط آیتم‌های visible و درون پنجرهٔ زمانی."""
    return await service.list_public_nav(db, locale)


@router.get("/public/banners")
async def public_banners(
    placement: str | None = Query(default=None, description="مثل homepage"),
    db: AsyncSession = Depends(get_db),
):
    """بنرهای عمومی — فقط published و درون پنجره، به‌ترتیب priority."""
    return await service.list_public_banners(db, placement)


@router.get("/public/announcements")
async def public_announcements(
    placement: str | None = Query(default=None, description="مثل global"),
    db: AsyncSession = Depends(get_db),
):
    """اعلان‌های عمومی — فقط published و درون پنجره."""
    return await service.list_public_announcements(db, placement)


@router.get("/public/pages/slug/{slug}")
async def public_page(slug: str, db: AsyncSession = Depends(get_db)):
    """صفحهٔ منتشرشده بر اساس slug — مثل terms و privacy."""
    return await service.get_public_page(db, slug)


@router.get("/public/events")
async def public_events(
    hijri_month: int | None = Query(default=None, ge=1, le=12),
    hijri_day: int | None = Query(default=None, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """رویدادهای منتشرشدهٔ تقویم — فیلتر اختیاری ماه/روز هجری."""
    return await service.list_public_events(db, hijri_month, hijri_day)


@router.get("/public/quotes")
async def public_quotes(
    placement: str | None = Query(default=None, description="مثل homepage"),
    db: AsyncSession = Depends(get_db),
):
    """نقل‌قول‌های منتشرشده — فیلتر اختیاری placement."""
    return await service.list_public_quotes(db, placement)


@router.get("/public/calendar/theme")
async def public_calendar_theme(db: AsyncSession = Depends(get_db)):
    """تمِ فعالِ امروزِ تقویم اسلامی + (ماه، روز) هجری — مصرف وب/موبایل."""
    return await service.get_active_calendar_theme(db)
