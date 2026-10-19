"""اسکیماهای فاز ۱۵ — مالی، اهدا و درگاه پرداخت.

همهٔ متن‌های قابل‌مشاهدهٔ کاربر LocalizedText (§۱۵.۴).
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class LocalizedText(BaseModel):
    """متن قابل‌مشاهدهٔ کاربر — همیشه هر سه زبان (§۱۵.۴)."""

    fa: str
    ar: str
    en: str


# ---------------------------------------------------------------------------
# اهدا
# ---------------------------------------------------------------------------


class DonateIn(BaseModel):
    amount: int = Field(gt=0, description="مبلغ به ریال (IRR)")
    currency: str = Field(default="IRR", pattern="^IRR$")
    campaign_id: UUID | None = None
    donor_name: str | None = Field(default=None, max_length=256)
    gateway: str = Field(default="zarinpal", pattern="^zarinpal$")
    callback_url: str | None = Field(
        default=None, max_length=1024, description="callback سفارشی؛ پیش‌فرض از تنظیمات"
    )


class DonateOut(BaseModel):
    intent_id: UUID
    authority: str
    pay_url: str
    status: str
    amount: int
    currency: str


class DonationOut(BaseModel):
    id: UUID
    intent_id: UUID
    gateway: str
    gateway_reference: str
    status: str
    amount: int
    currency: str
    campaign_id: UUID | None
    donor_name: str | None
    created_at: datetime


class WebhookOut(BaseModel):
    already_processed: bool
    status: str


# ---------------------------------------------------------------------------
# کمپین‌ها
# ---------------------------------------------------------------------------


class CampaignIn(BaseModel):
    title: LocalizedText
    description: LocalizedText | None = None
    goal_amount: int = Field(ge=0)
    status: str = Field(default="active", pattern="^(active|draft|archived)$")
    cover: str | None = Field(default=None, max_length=1024)


class CampaignOut(BaseModel):
    id: UUID
    title: LocalizedText
    description: LocalizedText | None
    goal_amount: int
    raised_amount: int
    progress: float
    status: str
    cover: str | None
    created_at: datetime


class CampaignPage(BaseModel):
    items: list[CampaignOut]
    next_cursor: str | None


# ---------------------------------------------------------------------------
# دفتر و ادمین
# ---------------------------------------------------------------------------


class LedgerOut(BaseModel):
    id: UUID
    entry_type: str
    amount: int
    currency: str
    reference: str | None
    donation_id: UUID | None
    created_at: datetime


class LedgerPage(BaseModel):
    items: list[LedgerOut]
    next_cursor: str | None


class DonationPage(BaseModel):
    items: list[DonationOut]
    next_cursor: str | None


class ReconcileMismatch(BaseModel):
    kind: str  # internal_without_gateway | gateway_without_internal | amount_mismatch
    intent_id: UUID | None
    gateway_reference: str | None
    internal_amount: int | None
    gateway_amount: int | None
    detail: LocalizedText


class ReconcileOut(BaseModel):
    gateway: str
    internal_succeeded: int
    gateway_succeeded: int
    mismatches: list[ReconcileMismatch]


class RecurringIn(BaseModel):
    amount: int = Field(gt=0)
    currency: str = Field(default="IRR", pattern="^IRR$")
    campaign_id: UUID | None = None
    interval: str = Field(default="monthly", pattern="^(weekly|monthly|yearly)$")


class RecurringOut(BaseModel):
    id: UUID
    amount: int
    currency: str
    campaign_id: UUID | None
    interval: str
    status: str
    next_charge_at: datetime | None


class GatewayStatus(BaseModel):
    """وضعیت یک درگاه — فقط configured، هرگز مقدار secret (§۳)."""

    configured: bool
    sandbox: bool = True


class GatewayStatusOut(BaseModel):
    zarinpal: GatewayStatus
    idpay: GatewayStatus
