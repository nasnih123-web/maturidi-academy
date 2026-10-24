"""seed پیکربندی‌های اولیهٔ ماشین‌حساب‌ها — فاز ۷.

⚠ قانون سخت (§۱۵.۵): نسخه‌های v1 هیچ جدول فرائض، نصاب یا نرخ زکاتی
وارد نمی‌کنند (rule_data خالیِ «در انتظار ورود عالم»). نسخه‌های v2
(فاز ۴) قواعد بازثبت‌شده از صفحات مرجع را فقط به‌صورت draft نگه
می‌دارند — بازپیاده‌سازی مستقل با ذکر منشأ، بدون کپی کد/متن منبع —
و محاسبهٔ عمومی تا approve توسط عالم همچنان خطای rules_not_approved
می‌دهد.

Idempotent: بر اساس (kind, madhab, version) upsert می‌شود.
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InheritanceRuleConfig, ZakatRuleConfig
from app.modules.calculators.source_rules import (
    MIRAS_SOURCE_RULE_DATA,
    SOURCE_ATTRIBUTION,
    ZAKAT_SOURCE_RULE_DATA,
)

_PENDING = {"status": "pending_scholar_entry"}
_PENDING_SOURCE = "pending scholar entry"
_MADHABS = ("hanafi", "maliki", "shafii", "hanbali")

# ---------------------------------------------------------------------------
# M-02 (ADR-0034): ساختار پیکربندی سه مذهب دیگر — فقط اسکلت قرارداد
# rule_data (ADR-0006) با مقادیر خالی/pending و منابع کلاسیکِ نام‌برده
# که عالم جداول را از آن‌ها پر می‌کند. هیچ مقدار فقهی‌ای این‌جا
# ساخته نمی‌شود؛ shares عمداً {} است و awl/radd نامشخص (None).
# ---------------------------------------------------------------------------

_MADHHAB_SOURCES: dict[str, dict] = {
    "maliki": {
        "works": [
            "المدونة الكبرى — سحنون عن ابن القاسم عن الإمام مالك",
            "مختصر خليل — خليل بن إسحاق، مع الشرح الكبير للدردير وحاشية الدسوقي",
            "الرسالة — ابن أبي زيد القيرواني",
        ],
        "faraid_section": "كتاب الفرائض في المدونة ومختصر خليل",
    },
    "shafii": {
        "works": [
            "الأم — الإمام الشافعي",
            "منهاج الطالبين — النووي، مع مغني المحتاج للخطيب الشربيني",
            "الرحبية في علم الفرائض — الرحبي، وشروحها",
        ],
        "faraid_section": "كتاب الفرائض في الأم والمنهاج",
    },
    "hanbali": {
        "works": [
            "المغني — ابن قدامة",
            "الإنصاف — المرداوي",
            "كشاف القناع — البهوتي، والروض المربع — البهوتي",
        ],
        "faraid_section": "كتاب الفرائض في المغني",
    },
}


def _inheritance_structure(madhab: str) -> dict:
    """اسکلت rule_data ارث برای یک مذهب — ساختار کامل، مقادیر خالی."""
    return {
        "status": "pending_scholar_entry",
        "structure": "inheritance_rule_data_v1",
        "shares": {},
        "awl": {"enabled": None},
        "radd": {"enabled": None, "excluded": []},
        "asaba_priority": [],
        "scholarly_sources": _MADHHAB_SOURCES[madhab],
    }

# فرادادهٔ منشأ قواعد فاز ۴ (در rule_data نسخه‌های v2 ثبت می‌شود)
_SOURCE_PROVENANCE = {
    "origin": "dl.ghadimyol.ir — calculator/zakat.html + calculator/miras.html",
    "attributed_author": "مهران ساعدی",
    "fetched": "2026-10-21",
    "transport": "http (https failed)",
    "sha256": {
        "zakat.html":
            "2a8e68cd4f3c3bada08511c8b93395e1b1ba01e87ececafe22e356d62addd4f8",
        "miras.html":
            "8cb9d11c5eb41f73612dd6abc43957e324a1ce5460304296d6281ae24c3dc8e6",
    },
    "license": "no explicit license in source — rules re-implemented, "
               "no code or prose copied",
    "review_status": "draft — pending scholar review",
}


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

    # --- فاز ۴: نسخه‌های v2 با قواعد بازثبت‌شده از صفحات مرجع ---
    # همچنان draft: گیت عمومی بسته می‌ماند تا عالم بازبینی و approve کند.
    miras_exists = (
        await db.execute(
            select(InheritanceRuleConfig).where(
                InheritanceRuleConfig.madhab == "hanafi",
                InheritanceRuleConfig.version == 2,
            )
        )
    ).scalar_one_or_none()
    if miras_exists is None:
        db.add(
            InheritanceRuleConfig(
                madhab="hanafi",
                source=SOURCE_ATTRIBUTION,
                version=2,
                effective_from=now,
                effective_to=None,
                approved_by=None,
                approved_at=None,
                change_reason=(
                    "فاز ۴ — قواعد فرائض حنفی (السراجیة) بازثبت‌شده از "
                    "صفحهٔ مرجع؛ در انتظار بازبینی عالم"
                ),
                rule_data={
                    "miras": MIRAS_SOURCE_RULE_DATA,
                    "provenance": _SOURCE_PROVENANCE,
                },
                status="draft",
            )
        )
        seeded.append("inheritance:hanafi:v2-source")

    # --- M-02: نسخه‌های v2 ساختاری برای سه مذهب دیگر (فقط ارث) ---
    # اسکلت قرارداد + منابع نام‌برده؛ status=draft و shares خالی، پس
    # گیت rules_not_approved دقیقاً مثل حنفیِ در انتظار تأیید می‌ماند.
    for madhab in ("maliki", "shafii", "hanbali"):
        struct_exists = (
            await db.execute(
                select(InheritanceRuleConfig).where(
                    InheritanceRuleConfig.madhab == madhab,
                    InheritanceRuleConfig.version == 2,
                )
            )
        ).scalar_one_or_none()
        if struct_exists is None:
            works = _MADHHAB_SOURCES[madhab]["works"]
            db.add(
                InheritanceRuleConfig(
                    madhab=madhab,
                    source="; ".join(works),
                    version=2,
                    effective_from=now,
                    effective_to=None,
                    approved_by=None,
                    approved_at=None,
                    change_reason=(
                        "M-02 — ساختار پیکربندی ارث (اسکلت ADR-0006) با "
                        "منابع کلاسیک نام‌برده؛ جداول در انتظار ورود و "
                        "تأیید عالم — هیچ مقداری ساخته نشده است"
                    ),
                    rule_data=_inheritance_structure(madhab),
                    status="draft",
                )
            )
            seeded.append(f"inheritance:{madhab}:v2-structure")

    zakat_v2_exists = (
        await db.execute(
            select(ZakatRuleConfig).where(ZakatRuleConfig.version == 2)
        )
    ).scalar_one_or_none()
    if zakat_v2_exists is None:
        db.add(
            ZakatRuleConfig(
                madhab=None,
                source=SOURCE_ATTRIBUTION,
                version=2,
                effective_from=now,
                effective_to=None,
                approved_by=None,
                approved_at=None,
                change_reason=(
                    "فاز ۴ — قواعد زکات (پلکانی + چهارپایان + عشر + خمس) "
                    "بازثبت‌شده از صفحهٔ مرجع؛ در انتظار بازبینی عالم"
                ),
                rule_data={
                    "extended": ZAKAT_SOURCE_RULE_DATA,
                    "provenance": _SOURCE_PROVENANCE,
                },
                asset_categories={},
                status="draft",
            )
        )
        seeded.append("zakat:v2-source")

    await db.flush()
    return {"seeded": seeded}
