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
    gateway: str = Field(default="zarinpal", pattern="^(zarinpal|idpay)$")
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


# ---------------------------------------------------------------------------
# روش‌های حمایت (عمومی) + حمایت دستی (کارت‌به‌کارت / کریپتو / PayPal)
# ---------------------------------------------------------------------------


class CryptoWalletOut(BaseModel):
    currency: str
    network: str = ""
    address: str


class DonationMethodOut(BaseModel):
    """یک روش پرداختِ قابل‌استفاده در صفحهٔ حمایت — فقط روش‌های فعال و
    کاملِ پیکربندی‌شده اینجا می‌آیند؛ روش خاموش اصلاً نمایش داده نمی‌شود."""

    method: str  # online | card | crypto | paypal
    title: LocalizedText
    instructions: LocalizedText | None = None
    currency: str | None = None  # ارز پیش‌فرض روش (کارت: IRR، پی‌پال: USD)
    gateways: list[str] = []  # فقط online: درگاه‌های پیکربندی‌شده
    card_number: str | None = None
    card_holder: str | None = None
    wallets: list[CryptoWalletOut] = []
    paypal_account: str | None = None


class DonationMethodsOut(BaseModel):
    methods: list[DonationMethodOut]


class ManualDonationOut(BaseModel):
    """پاسخ ثبت حمایت دستی — همیشه در وضعیت pending (در انتظار تأیید)."""

    id: UUID  # شناسهٔ رکورد اثبات (manual_donation_proofs)
    intent_id: UUID
    method: str
    status: str = "pending"
    amount: int
    currency: str
    created_at: datetime


class ManualDonationAdminOut(BaseModel):
    id: UUID
    intent_id: UUID
    method: str
    status: str  # از review_status رکورد اثبات: pending | approved | rejected
    amount: int
    currency: str
    campaign_id: UUID | None
    donor_name: str | None
    proof_text: str | None
    has_proof_image: bool
    wallet_label: str | None
    review_note: str | None
    reviewed_at: datetime | None
    created_at: datetime
    # تبدیل ارزی هنگام تأیید (فقط حمایت تأییدشده): معادل ریالیِ شمرده‌شده
    # در مجموع کمپین + نرخ و منبعش؛ برای ریالی‌ها amount_irr == amount.
    amount_irr: int | None = None
    fx_rate_irr: int | None = None
    fx_source: str | None = None


class ManualDonationPage(BaseModel):
    items: list[ManualDonationAdminOut]
    next_cursor: str | None


class ManualReviewIn(BaseModel):
    note: str | None = Field(default=None, max_length=512)
    # نرخ دستیِ هر واحد ارز به ریال — فقط تأییدِ حمایت ارزی: وقتی داده
    # شود بر نرخ لحظه‌ایِ خودکار مقدم است (منبع: manual).
    rate_irr: int | None = Field(default=None, gt=0, le=10**13)


class FxRateOut(BaseModel):
    """نرخ لحظه‌ای هر واحد ارز به ریال + منبع — نمایش پیش از تأیید در CRM."""

    currency: str
    rate_irr: int
    source: str  # wallex | coingecko | fixed
