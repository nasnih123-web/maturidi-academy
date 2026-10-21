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
    debts: Decimal = Field(ge=0, default=Decimal(0))
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


# --- فاز ۴: محاسبه‌گرهای منبع (Stateless؛ ورودی کاربر ذخیره نمی‌شود) ---


class ZakatMoneyIn(BaseModel):
    amount: Decimal = Field(ge=0, description="ارزش اموال به واحد پول")
    coin_price: Decimal = Field(gt=0, description="قیمت روز یک سکه")


class ZakatCowIn(BaseModel):
    count: int = Field(ge=0, le=1_000_000)
    musinna_price: Decimal | None = Field(
        default=None, gt=0,
        description="قیمت یک گاو دوساله — فقط برای کسرِ چهلمِ بازهٔ ۴۰–۵۹",
    )


class ZakatHorseIn(BaseModel):
    count: int = Field(ge=0, le=1_000_000)
    total_value: Decimal | None = Field(default=None, ge=0)


class ZakatOshrIn(BaseModel):
    amount_kg: Decimal = Field(ge=0)
    irrigation: Literal["rain_fed", "irrigated"]


class ZakatKhomsIn(BaseModel):
    amount: Decimal = Field(ge=0)


class ZakatExtendedIn(BaseModel):
    money: ZakatMoneyIn | None = Field(default=None)
    gold_grams: Decimal | None = Field(default=None, ge=0)
    silver_grams: Decimal | None = Field(default=None, ge=0)
    sheep: int | None = Field(default=None, ge=0, le=1_000_000)
    cows: ZakatCowIn | None = Field(default=None)
    camels: int | None = Field(default=None, ge=0, le=1_000_000)
    horses: ZakatHorseIn | None = Field(default=None)
    oshr: ZakatOshrIn | None = Field(default=None)
    khoms: ZakatKhomsIn | None = Field(default=None)


class ZakatExtendedOut(BaseModel):
    sections: dict
    applied_rule_version: int


class MirasImpedimentsIn(BaseModel):
    religion_mixed: bool = False
    killer: bool = False
    simultaneous_death: bool = False
    slavery: bool = False


class MirasIn(BaseModel):
    """خانواده و ترکه برای موتور فرائض حنفی (miras_engine)."""

    gender: Literal["male", "female"]
    husband: bool = False
    father: bool = False
    mother: bool = False
    grandfather: bool = False
    mgm: bool = False
    pgm: bool = False
    wives: int = Field(default=0, ge=0, le=4)
    sons: int = Field(default=0, ge=0, le=99)
    daughters: int = Field(default=0, ge=0, le=99)
    son_sons: int = Field(default=0, ge=0, le=99)
    son_daughters: int = Field(default=0, ge=0, le=99)
    brothers: int = Field(default=0, ge=0, le=99)
    sisters: int = Field(default=0, ge=0, le=99)
    paternal_brothers: int = Field(default=0, ge=0, le=99)
    paternal_sisters: int = Field(default=0, ge=0, le=99)
    uterine_brothers: int = Field(default=0, ge=0, le=99)
    uterine_sisters: int = Field(default=0, ge=0, le=99)
    full_brother_sons: int = Field(default=0, ge=0, le=99)
    paternal_brother_sons: int = Field(default=0, ge=0, le=99)
    full_uncles: int = Field(default=0, ge=0, le=99)
    paternal_uncles: int = Field(default=0, ge=0, le=99)
    full_uncle_sons: int = Field(default=0, ge=0, le=99)
    paternal_uncle_sons: int = Field(default=0, ge=0, le=99)
    daughter_sons: int = Field(default=0, ge=0, le=99)
    daughter_daughters: int = Field(default=0, ge=0, le=99)
    son_daughter_sons: int = Field(default=0, ge=0, le=99)
    son_daughter_daughters: int = Field(default=0, ge=0, le=99)
    maternal_grandfather: int = Field(default=0, ge=0, le=99)
    remote_grandmothers: int = Field(default=0, ge=0, le=99)
    sister_sons: int = Field(default=0, ge=0, le=99)
    sister_daughters: int = Field(default=0, ge=0, le=99)
    full_brother_daughters: int = Field(default=0, ge=0, le=99)
    paternal_brother_daughters: int = Field(default=0, ge=0, le=99)
    uterine_brother_children: int = Field(default=0, ge=0, le=99)
    uterine_sister_children: int = Field(default=0, ge=0, le=99)
    maternal_uncles: int = Field(default=0, ge=0, le=99)
    maternal_aunts: int = Field(default=0, ge=0, le=99)
    maternal_paternal_uncles: int = Field(default=0, ge=0, le=99)
    paternal_aunts: int = Field(default=0, ge=0, le=99)
    paternal_uncle_daughters: int = Field(default=0, ge=0, le=99)
    estate_value: Decimal = Field(ge=0)
    funeral: Decimal = Field(default=Decimal(0), ge=0)
    debt: Decimal = Field(default=Decimal(0), ge=0)
    will: Decimal = Field(default=Decimal(0), ge=0)
    will_for_heir: bool = False
    will_approved: bool = False
    impediments: MirasImpedimentsIn = Field(
        default_factory=MirasImpedimentsIn)


class MirasRowOut(BaseModel):
    key: str
    count: int
    share: str
    amount: str
    per_person_amount: str
    asaba_part: str | None = None


class MirasOut(BaseModel):
    status: Literal["computed", "stopped"]
    stop_code: str | None = None
    estate_value: str | None = None
    funeral: str | None = None
    debt: str | None = None
    will_applied: str | None = None
    net_estate: str | None = None
    awl: bool = False
    radd: bool = False
    rows: list[MirasRowOut] = []
    blocked: list[str] = []
    notes: list[str] = []
    applied_rule_version: int


class MosarefIn(BaseModel):
    root: str = Field(min_length=1, max_length=12)
    bab: str = Field(min_length=1, max_length=32)
    transitivity: Literal["mutaadi", "laazim"]
    harf_jar: Literal["bi", "li", "an", "min", "ila", "ala", "fi"] = "bi"


class MosarefTableOut(BaseModel):
    key: str
    columns: dict[str, list[str]]


class MosarefOut(BaseModel):
    root: str
    bab: str
    transitivity: str
    harf_jar: str
    verb_class: str
    tables: list[MosarefTableOut]
    flags: dict[str, bool]
