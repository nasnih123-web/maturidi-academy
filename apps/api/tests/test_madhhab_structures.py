"""تست‌های M-02 (ADR-0034): ساختار قواعد سه مذهب دیگر.

اثبات‌ها:
- seed برای maliki/shafii/hanbali یک config ارثِ v2 می‌سازد که
  اسکلت کامل قرارداد rule_data (ADR-0006) + منابع کلاسیک نام‌برده
  دارد ولی shares آن خالی است (هیچ جدول ساخته‌شده‌ای نیست).
- seed idempotent است.
- موتور برای هر سه مذهب — حتی با حضور همین config ساختاری —
  rules_not_approved می‌دهد (گیت دقیقاً مثل حنفیِ در انتظار تأیید).

نکتهٔ زیرساختی: این تست‌ها روی دیتابیس جدا اجرا می‌شوند، چون seed
واقعیِ ماشین‌حساب ردیف‌های v1/v2 می‌سازد و فایل‌های دیگر (فاز ۷)
همان نسخه‌ها را خودشان از مسیر API می‌سازند — DB اشتراکی نباید
آلوده شود.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — ثبت همهٔ مدل‌ها روی Base
from app.core.database import Base
from app.core.errors import APIError
from app.models.models import InheritanceRuleConfig
from app.modules.calculators import service
from app.seed_calculators import seed_calculator_rules

pytestmark = pytest.mark.asyncio

OTHER_MADHABS = ("maliki", "shafii", "hanbali")


@pytest_asyncio.fixture()
async def calc_db(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path}/calc.db",
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def _v2(db, madhab: str) -> InheritanceRuleConfig | None:
    return (
        await db.execute(
            select(InheritanceRuleConfig).where(
                InheritanceRuleConfig.madhab == madhab,
                InheritanceRuleConfig.version == 2,
            )
        )
    ).scalar_one_or_none()


async def test_structures_seeded_empty_with_named_sources(calc_db):
    await seed_calculator_rules(calc_db)
    await calc_db.commit()
    for madhab in OTHER_MADHABS:
        cfg = await _v2(calc_db, madhab)
        assert cfg is not None, madhab
        assert cfg.status == "draft"
        assert cfg.approved_by is None and cfg.approved_at is None
        data = cfg.rule_data
        assert data["structure"] == "inheritance_rule_data_v1"
        assert data["status"] == "pending_scholar_entry"
        # اسکلت کامل قرارداد — ولی هیچ مقداری ساخته نشده است
        assert data["shares"] == {}
        assert data["awl"] == {"enabled": None}
        assert data["radd"]["enabled"] is None
        assert data["asaba_priority"] == []
        # منابع کلاسیک نام‌برده حضور دارند (منشأ ورود عالم)
        works = data["scholarly_sources"]["works"]
        assert len(works) >= 2 and all(isinstance(w, str) and w for w in works)
        assert cfg.source and cfg.source != "pending scholar entry"


async def test_seed_idempotent_for_structures(calc_db):
    await seed_calculator_rules(calc_db)
    await calc_db.commit()
    again = await seed_calculator_rules(calc_db)
    await calc_db.commit()
    assert not any("structure" in s for s in again["seeded"])
    rows = (
        await calc_db.execute(
            select(InheritanceRuleConfig).where(
                InheritanceRuleConfig.version == 2,
                InheritanceRuleConfig.madhab.in_(OTHER_MADHABS),
            )
        )
    ).scalars().all()
    assert len(rows) == 3


@pytest.mark.parametrize("madhab", OTHER_MADHABS)
async def test_engine_refuses_other_madhhabs(calc_db, madhab):
    await seed_calculator_rules(calc_db)
    await calc_db.commit()
    with pytest.raises(APIError) as exc:
        await service.calculate_inheritance(
            calc_db,
            madhab=madhab,
            heirs=[{"type": "son", "count": 1}],
            estate_value=Decimal(1000),
        )
    assert exc.value.status_code == 422
    assert exc.value.code == "rules_not_approved"
