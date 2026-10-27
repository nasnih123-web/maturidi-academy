"""روتر فاز ۱۵ — مالی، اهدا و درگاه پرداخت.

§۱۵.۶: روتر هرگز مستقیم به دیتابیس دسترسی ندارد — فقط service صدا زده می‌شود.
عمومی `/api/v1/finance` + ادمین `/api/v1/admin/finance` (مجوز finance.manage).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

from . import schemas, service

finance_router = APIRouter(prefix="/api/v1/finance", tags=["finance"])
admin_finance_router = APIRouter(prefix="/api/v1/admin/finance", tags=["admin-finance"])

_finance_admin = require_permission("finance.manage")
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


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


# ---------------------------------------------------------------------------
# عمومی
# ---------------------------------------------------------------------------


@finance_router.post("/donate", response_model=schemas.DonateOut)
async def donate(
    request: Request,
    response: Response,
    body: schemas.DonateIn,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    """ایجاد نیت پرداخت — هدر Idempotency-Key اجباری (§۱).

    کلید تکراری → همان نیتِ موجود برمی‌گردد؛ بدون تراکنش/درخواست جدید.
    نیتِ جدید → ۲۰۱؛ نیتِ موجود → ۲۰۰.
    """
    out, created = await service.create_donation_intent(
        db,
        idempotency_key=idempotency_key or "",
        body=body,
        user=user,
        ip=_client_ip(request),
        ua=_ua(request),
    )
    response.status_code = 201 if created else 200
    return out


@finance_router.get("/callback")
async def payment_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authority: str = Query(alias="Authority"),
    status: str = Query(default="", alias="Status"),
):
    """مقصد redirect زرین‌پال (?Authority=&Status=OK). Re-entrant و امن."""
    return await service.handle_callback(
        db,
        authority=authority,
        status=status,
        ip=_client_ip(request),
        ua=_ua(request),
    )


@finance_router.post("/webhook/{gateway}", response_model=schemas.WebhookOut)
async def payment_webhook(
    gateway: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """وبهوک درگاه — احراز امضا + پردازش idempotent.

    replay تکراری → ۲۰۰ با already_processed=true، بدون اثر دوم (§۴، ADR-0013).
    """
    raw_body = await request.body()
    return await service.handle_webhook(
        db,
        gateway_name=gateway,
        raw_body=raw_body,
        headers=dict(request.headers),
        ip=_client_ip(request),
    )


@finance_router.get("/campaigns", response_model=list[schemas.CampaignOut])
async def list_campaigns(db: AsyncSession = Depends(get_db)):
    return await service.list_campaigns(db, active_only=True)


@finance_router.get("/campaigns/{campaign_id}", response_model=schemas.CampaignOut)
async def get_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.get_campaign(db, campaign_id)


@finance_router.get("/receipts/{donation_id}")
async def get_receipt(
    donation_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """رسید PDF سه‌زبانه — دسترسی: مالک اهدا یا finance.manage."""
    pdf, filename = await service.get_receipt_pdf(
        db, donation_id=donation_id, requester=user
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@finance_router.post("/recurring", response_model=schemas.RecurringOut, status_code=201)
async def create_recurring(
    request: Request,
    body: schemas.RecurringIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ثبت اهدای مکرر — اجرای شارژ دوره‌ای با فاز ۱۶ (صف ARQ)."""
    return await service.create_recurring(
        db, body=body, user=user, ip=_client_ip(request), ua=_ua(request)
    )


# ---------------------------------------------------------------------------
# ادمین
# ---------------------------------------------------------------------------


@admin_finance_router.post("/campaigns", response_model=schemas.CampaignOut, status_code=201)
async def admin_create_campaign(
    request: Request,
    body: schemas.CampaignIn,
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_campaign(
        db, body=body, admin=user, ip=_client_ip(request), ua=_ua(request)
    )


@admin_finance_router.get("/campaigns", response_model=list[schemas.CampaignOut])
async def admin_list_campaigns(
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_campaigns(db, active_only=False)


@admin_finance_router.put("/campaigns/{campaign_id}", response_model=schemas.CampaignOut)
@admin_finance_router.patch("/campaigns/{campaign_id}", response_model=schemas.CampaignOut)
async def admin_update_campaign(
    campaign_id: UUID,
    request: Request,
    body: schemas.CampaignIn,
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_campaign(
        db, campaign_id=campaign_id, body=body, admin=user,
        ip=_client_ip(request), ua=_ua(request),
    )


@admin_finance_router.delete("/campaigns/{campaign_id}", status_code=204)
async def admin_delete_campaign(
    campaign_id: UUID,
    request: Request,
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    await service.delete_campaign(
        db, campaign_id=campaign_id, admin=user,
        ip=_client_ip(request), ua=_ua(request),
    )


@admin_finance_router.get("/donations", response_model=schemas.DonationPage)
async def admin_list_donations(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    items, next_cursor = await service.list_donations(db, cursor=cursor, limit=limit)
    return {"items": items, "next_cursor": next_cursor}


@admin_finance_router.get("/ledger", response_model=schemas.LedgerPage)
async def admin_list_ledger(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    items, next_cursor = await service.list_ledger(db, cursor=cursor, limit=limit)
    return {"items": items, "next_cursor": next_cursor}


@admin_finance_router.get("/reconcile", response_model=schemas.ReconcileOut)
async def admin_reconcile(
    gateway: str = Query(default="zarinpal"),
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    """تطبیق نیت‌های موفق داخلی با گزارش درگاه — لیست مغایرت‌ها."""
    return await service.reconcile(db, gateway_name=gateway)


@admin_finance_router.get("/gateways", response_model=schemas.GatewayStatusOut)
async def admin_gateway_status(
    user: User = Depends(_finance_admin),
    db: AsyncSession = Depends(get_db),
):
    """وضعیت اتصال درگاه‌ها — فقط configured، هرگز مقدار secret (§۳)."""
    return await service.gateway_statuses(db)
