"""اسکیماهای فاز ۷ — Pydantic v2 (OpenAPI خودکار، §۱)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


# --- ورودی‌های محاسبه ---


class HeirIn(BaseModel):
    type: str = Field(min_length=1, description="نوع وارث — طبق کلیدهای rule_data")
    count: int = Field(ge=1, default=1)


class InheritanceCalcIn(BaseModel):
    madhab: str = Field(description="hanafi|maliki|shafii|hanbali")
    estate_value: Decimal = Field(gt=0, description="ارزش کل ترکه")
    heirs: list[HeirIn] = Field(min_length=1)


class ShareOut(BaseModel):
    heir_type: str
    count: int
    share_fraction: str
    amount: str
    per_person_amount: str


class InheritanceResultOut(BaseModel):
    shares: list[ShareOut]
    total_allocated_fraction: str
    notes: list[str]
    applied_rule_version: int


class InheritanceCalcOut(BaseModel):
    id: UUID
    madhab: str
    estate_value: str
    heirs: list[dict]
    result: dict
    rule_config_id: UUID | None
    created_at: datetime


class ZakatCalcIn(BaseModel):
    assets: dict[str, Decimal] = Field(
        description="دسته→مقدار؛ دسته‌های grams بر حسب گرم"
    )
    debts: Decimal = Field(ge=0, default=Decimal("0"))
    madhab: str | None = Field(default=None)


class ZakatCalcOut(BaseModel):
    id: UUID
    inputs: dict
    result: dict
    nisab_snapshot: dict
    rule_config_id: UUID | None
    created_at: datetime


class NisabRateOut(BaseModel):
    status: Literal["ok", "stale", "price_unavailable"]
    gold_per_gram: str | None
    silver_per_gram: str | None
    currency: str | None
    source: str
    fetched_at: str | None
    stale: bool


# --- rule_configs (ادمین) ---


class RuleCreateIn(BaseModel):
    kind: Literal["inheritance", "zakat"]
    madhab: str | None = Field(default=None)
    source: str = Field(min_length=1, description="مرجع فقهی قاعده")
    version: int = Field(ge=1)
    effective_from: datetime
    effective_to: datetime | None = Field(default=None)
    change_reason: str | None = Field(default=None)
    rule_data: dict = Field(default_factory=dict)
    asset_categories: dict | None = Field(default=None)


class RuleUpdateIn(BaseModel):
    source: str | None = Field(default=None)
    effective_from: datetime | None = Field(default=None)
    effective_to: datetime | None = Field(default=None)
    change_reason: str | None = Field(default=None)
    rule_data: dict | None = Field(default=None)
    asset_categories: dict | None = Field(default=None)


class RuleReviewIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, description="یادداشت عالم بازبین")


class RuleOut(BaseModel):
    id: UUID
    kind: str
    madhab: str | None
    source: str
    version: int
    status: str
    effective_from: datetime
    effective_to: datetime | None
    approved_by: UUID | None
    approved_at: datetime | None
    change_reason: str | None
    rule_data: dict
    asset_categories: dict
    created_at: datetime
    updated_at: datetime | None


def rule_out(data: dict[str, Any]) -> RuleOut:
    return RuleOut(**data)
