"""seed پیکربندی‌های اولیهٔ ماشین‌حساب‌ها — فاز ۷.

⚠ قانون سخت (§۱۵.۵): این seed هیچ جدول فرائض، هیچ نصاب و هیچ نرخ زکاتی
وارد نمی‌کند. هر ۵ رکورد با وضعیت draft و rule_data خالیِ «در انتظار ورود
عالم» ساخته می‌شوند؛ محاسبهٔ عمومی تا approve توسط عالم، خطای
rules_not_approved می‌دهد.

Idempotent: بر اساس (kind, madhab, version) upsert می‌شود.
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InheritanceRuleConfig, ZakatRuleConfig

_PENDING = {"status": "pending_scholar_entry"}
_PENDING_SOURCE = "pending scholar entry"
_MADHABS = ("hanafi", "maliki", "shafii", "hanbali")


def _utcnow():
    return datetime.now(UTC)


async def seed_calculator_rules(db: AsyncSession) -> dict:
    seeded: list[str] = []
    now = _utcnow()

    for madhab in _MADHABS:
        exists = (
            await db.execute(
                select(InheritanceRuleConfig).where(
                    InheritanceRuleConfig.madhab == madhab,
                    InheritanceRuleConfig.version == 1,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            db.add(
                InheritanceRuleConfig(
                    madhab=madhab,
                    source=_PENDING_SOURCE,
                    version=1,
                    effective_from=now,
                    effective_to=None,
                    approved_by=None,
                    approved_at=None,
                    change_reason=(
                        "پیکربندی اولیه — در انتظار ورود جدول فرائض توسط عالم"
                    ),
                    rule_data=dict(_PENDING),
                    status="draft",
                )
            )
            seeded.append(f"inheritance:{madhab}:v1")

    zakat_exists = (
        await db.execute(
            select(ZakatRuleConfig).where(ZakatRuleConfig.version == 1)
        )
    ).scalar_one_or_none()
    if zakat_exists is None:
        db.add(
            ZakatRuleConfig(
                madhab=None,
                source=_PENDING_SOURCE,
                version=1,
                effective_from=now,
                effective_to=None,
                approved_by=None,
                approved_at=None,
                change_reason=(
                    "پیکربندی اولیه — در انتظار ورود نصاب/نرخ توسط عالم"
                ),
                rule_data=dict(_PENDING),
                asset_categories=dict(_PENDING),
                status="draft",
            )
        )
        seeded.append("zakat:v1")

    await db.flush()
    return {"seeded": seeded}
