"""روتر فاز ۷ — ماشین‌حساب ارث و زکات.

فقط سیم‌کشی؛ منطق در service.py (§۱۵.۶).
- عمومی: محاسبهٔ ارث/زکات (ناشناس هم مجاز — user_id nullable)، تاریخچهٔ
  caseهای خودم، نرخ نصاب.
- ادمین: CRUD پیکربندی قواعد + submit/review با مجوزهای
  calculators.manage (مدیریت) و calculators.approve (تأیید عالم).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import (
    get_current_user,
    require_permission,
)

from . import schemas, service

calc_router = APIRouter(prefix="/api/v1/calculators", tags=["calculators"])
admin_calc_router = APIRouter(
    prefix="/api/v1/admin/calculators", tags=["admin-calculators"]
)

_can_manage = require_permission("calculators.manage")
_can_approve = require_permission("calculators.approve")

_optional_bearer = HTTPBearer(auto_error=False)


async def _optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials, db)
    except APIError:
        return None


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# --- عمومی: ارث ---


@calc_router.post("/inheritance", response_model=schemas.InheritanceCalcOut)
@calc_router.post("/inheritance/cases", response_model=schemas.InheritanceCalcOut)
async def inheritance_calculate(
    body: schemas.InheritanceCalcIn,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """محاسبهٔ ارث با جدیدترین قاعدهٔ تأییدشدهٔ مذهب.

    بدون config تأییدشده → ۴۲۲ rules_not_approved (نه حدس).
    """
    data = await service.calculate_inheritance(
        db,
        madhab=body.madhab,
        heirs=[h.model_dump() for h in body.heirs],
        estate_value=body.estate_value,
        user=user,
        idempotency_key=idempotency_key,
        ip=_client_ip(request),
    )
    return schemas.InheritanceCalcOut(**data)


@calc_router.get("/inheritance/cases", response_model=dict)
async def inheritance_cases_list(
    limit: int = Query(default=50, ge=1, le=100),
    after: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """تاریخچهٔ محاسبات ارث کاربر واردشده (cursor-based، §۱)."""
    items, next_cursor = await service.list_inheritance_cases(
        db, user, limit=limit, cursor=after
    )
    return {
        "items": [
            schemas.InheritanceCalcOut(**d).model_dump(mode="json") for d in items
        ],
        "next_cursor": next_cursor,
    }


# --- عمومی: زکات ---


@calc_router.post("/zakat", response_model=schemas.ZakatCalcOut)
async def zakat_calculate(
    body: schemas.ZakatCalcIn,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """محاسبهٔ زکات با جدیدترین قاعدهٔ تأییدشده + snapshot نرخ نصاب."""
    data = await service.calculate_zakat(
        db,
        assets={k: v for k, v in body.assets.items()},
        debts=body.debts,
        madhab=body.madhab,
        user=user,
        idempotency_key=idempotency_key,
        ip=_client_ip(request),
    )
    return schemas.ZakatCalcOut(**data)


@calc_router.get("/zakat/nisab-rate", response_model=schemas.NisabRateOut)
async def nisab_rate(db: AsyncSession = Depends(get_db)):
    """نرخ روز نصاب طلا/نقره از کش (پرچم stale افشا می‌شود).

    بدون منبع پیکربندی‌شده و بدون کش → status=price_unavailable.
    """
    return schemas.NisabRateOut(**await service.get_nisab_rate(db))


# --- عمومی: فاز ۴ (زکات توسعه‌یافته / فرائض / مُصَرِّف) ---
# هر سه Stateless هستند: ورودی مالی/خانوادگی کاربر هرگز ذخیره نمی‌شود.


@calc_router.post("/zakat/extended", response_model=schemas.ZakatExtendedOut)
async def zakat_extended(
    body: schemas.ZakatExtendedIn,
    db: AsyncSession = Depends(get_db),
):
    """زکات توسعه‌یافتهٔ منبع (پلکانی + چهارپایان + عشر + خمس).

    گیت فاز ۷ پابرجاست: فقط با config تأییدشدهٔ دارای بخش extended.
    """
    sections: dict = {}
    if body.money is not None:
        sections["money"] = {
            "amount": body.money.amount, "coin_price": body.money.coin_price,
        }
    if body.gold_grams is not None:
        sections["gold_grams"] = body.gold_grams
    if body.silver_grams is not None:
        sections["silver_grams"] = body.silver_grams
    if body.sheep is not None:
        sections["sheep"] = body.sheep
    if body.cows is not None:
        sections["cows"] = {
            "count": body.cows.count,
            "musinna_price": body.cows.musinna_price,
        }
    if body.camels is not None:
        sections["camels"] = body.camels
    if body.horses is not None:
        sections["horses"] = {
            "count": body.horses.count,
            "total_value": body.horses.total_value,
        }
    if body.oshr is not None:
        sections["oshr"] = {
            "amount_kg": body.oshr.amount_kg,
            "irrigation": body.oshr.irrigation,
        }
    if body.khoms is not None:
        sections["khoms"] = {"amount": body.khoms.amount}
    data = await service.calculate_zakat_extended(db, sections=sections)
    return schemas.ZakatExtendedOut(**data)


@calc_router.post("/inheritance/miras", response_model=schemas.MirasOut)
async def inheritance_miras(
    body: schemas.MirasIn,
    db: AsyncSession = Depends(get_db),
):
    """فرائض حنفی بر مبنای السراجیة (موتور miras فاز ۴).

    گیت فاز ۷ پابرجاست: فقط با config تأییدشدهٔ حنفی دارای بخش miras.
    توقف محاسبه با status=stopped برمی‌گردد، نه خطا.
    """
    data = await service.calculate_miras(db, payload=body.model_dump())
    return schemas.MirasOut(**data)


@calc_router.post("/mosaref", response_model=schemas.MosarefOut)
async def mosaref_conjugate(body: schemas.MosarefIn):
    """مُصَرِّف افعال عربی — عمومی و بدون گیت (زبان‌شناسی، نه فقه)."""
    data = service.conjugate_mosaref(
        root=body.root,
        bab=body.bab,
        transitivity=body.transitivity,
        harf_jar=body.harf_jar,
    )
    return schemas.MosarefOut(**data)


# --- ادمین: rule_configs ---


@admin_calc_router.get("/rules", response_model=dict)
async def rule_list(
    kind: str | None = Query(default=None, description="inheritance|zakat"),
    madhab: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    after: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    items, next_cursor = await service.rule_list(
        db, kind=kind, madhab=madhab, status=status,
        limit=limit, cursor=after,
    )
    return {
        "items": [
            schemas.rule_out(d).model_dump(mode="json") for d in items
        ],
        "next_cursor": next_cursor,
    }


@admin_calc_router.post("/rules", response_model=schemas.RuleOut, status_code=201)
async def rule_create(
    body: schemas.RuleCreateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    """ساخت نسخهٔ جدید قاعده — همیشه draft؛ فعال‌شدن فقط با approve."""
    data = await service.rule_create(
        db, user,
        kind=body.kind,
        madhab=body.madhab,
        source=body.source,
        version=body.version,
        effective_from=body.effective_from,
        effective_to=body.effective_to,
        change_reason=body.change_reason,
        rule_data=body.rule_data,
        asset_categories=body.asset_categories,
        ip=_client_ip(request),
    )
    return schemas.rule_out(data)


@admin_calc_router.get("/rules/{rule_id}", response_model=schemas.RuleOut)
async def rule_get(
    rule_id: UUID,
    kind: str = Query(description="inheritance|zakat"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    model, _ = service._model_for(kind)  # اعتبارسنجی kind
    rule = await service._rule_get_or_404(db, kind, rule_id)
    return schemas.rule_out(service._rule_to_dict(kind, rule))


@admin_calc_router.patch("/rules/{rule_id}", response_model=schemas.RuleOut)
async def rule_update(
    rule_id: UUID,
    body: schemas.RuleUpdateIn,
    request: Request,
    kind: str = Query(description="inheritance|zakat"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    """ویرایش — فقط draft/rejected؛ نسخهٔ approved قفل است."""
    data = await service.rule_update(
        db, user, kind, rule_id,
        body.model_dump(exclude_unset=True),
        ip=_client_ip(request),
    )
    return schemas.rule_out(data)


@admin_calc_router.post("/rules/{rule_id}/submit", response_model=schemas.RuleOut)
async def rule_submit(
    rule_id: UUID,
    request: Request,
    kind: str = Query(description="inheritance|zakat"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    """ارسال draft برای بازبینی عالم → pending_review."""
    data = await service.rule_submit(db, user, kind, rule_id, ip=_client_ip(request))
    return schemas.rule_out(data)


@admin_calc_router.post("/rules/{rule_id}/review", response_model=schemas.RuleOut)
async def rule_review(
    rule_id: UUID,
    body: schemas.RuleReviewIn,
    request: Request,
    kind: str = Query(description="inheritance|zakat"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_approve),
):
    """بازبینی عالم: approve → فعال در محاسبات عمومی (+approved_by/at)؛
    reject → برگشت با یادداشت."""
    data = await service.rule_review(
        db, user, kind, rule_id,
        decision=body.decision, note=body.note,
        ip=_client_ip(request),
    )
    return schemas.rule_out(data)


@admin_calc_router.get("/rules/{rule_id}/history", response_model=dict)
async def rule_history(
    rule_id: UUID,
    kind: str = Query(description="inheritance|zakat"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    """تاریخچهٔ نسخه‌های یک قاعده (همان kind+madhab، مرتب نزولی)."""
    items = await service.rule_history(db, kind, rule_id)
    return {
        "items": [
            schemas.rule_out(d).model_dump(mode="json") for d in items
        ],
        "next_cursor": None,
    }


@admin_calc_router.get("/audit", response_model=dict)
async def calculator_audit(
    limit: int = Query(default=50, ge=1, le=100),
    after: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_manage),
):
    """حسابرسی تغییرات قواعد ماشین‌حساب‌ها (§۱۴) — فقط خواندنی."""
    items, next_cursor = await service.calculator_audit_list(
        db, limit=limit, cursor=after
    )
    return {
        "items": [
            {
                "id": r.id,
                "actor_id": r.actor_id,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "created_at": r.created_at,
            }
            for r in items
        ],
        "next_cursor": next_cursor,
    }
