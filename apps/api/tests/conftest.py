"""فیکسچرهای تست — دیتابیس SQLite جدا، override کردن get_db، ضبط ایمیل/پیامک."""
from __future__ import annotations

import os

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB = os.environ.get("MATURIDI_TEST_DB", "/tmp/maturidi_test_phase1.db")
# نکتهٔ Track C (2026-10-19): مسیر از env قابل بازنویسی است تا چند اجرای
# هم‌زمان pytest (ترک‌های مختلف روی یک برنچ) دیتابیس مشترک همدیگر را پاک نکنند:
#   MATURIDI_TEST_DB=/tmp/maturidi_test_track_c.db pytest tests/ -q


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def tc():
    """کلاینت HTTP + دیتابیس تست تازه + ضبط ایمیل/پیامک."""
    import app.models
    from app.core.database import Base

    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{TEST_DB}", connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    from app.core.database import get_db
    from app.main import app

    async def _override():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _override

    import app.core.email as email_mod
    import app.core.sms as sms_mod

    sent: dict = {"emails": [], "sms": []}

    async def _fake_email(to, subject, body_text, body_html=None):
        sent["emails"].append({"to": to, "subject": subject, "body": body_text})
        return True

    async def _fake_sms(phone, message):
        sent["sms"].append({"phone": phone, "message": message})
        return True

    email_mod.send_email = _fake_email
    sms_mod.send_sms = _fake_sms

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield {"client": client, "sent": sent, "maker": maker}
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(tc):
    """دسترسی مستقیم به دیتابیس تست (برای seed نقش/مجوز در تست ادمین)."""
    maker = tc["maker"]
    async with maker() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(autouse=True)
async def _reset_distributed_rate_limiter():
    """ریست محدودکنندهٔ نرخ توزیع‌شده بین تست‌ها (remediation-pass-2 Track 1).

    auth service از get_rate_limiter()‎ استفاده می‌کند؛ بدون ریست، سقف‌های
    login/register بین تست‌های یک فایل/جلسه جمع می‌شدند و 429 کاذب می‌دادند.
    """
    from app.core.rate_limit import get_rate_limiter

    get_rate_limiter().reset_for_tests()
    yield
    get_rate_limiter().reset_for_tests()
