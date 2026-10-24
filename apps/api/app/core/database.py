"""اتصال async به دیتابیس — engine از settings.database_url.

بدون Docker/PostgreSQL: SQLite از طریق aiosqlite (dev/tests).
نوع ستون‌ها Postgres-سازگار انتخاب شده (Uuid، JSON) تا migration روی
PostgreSQL بدون تغییر کار کند.
"""
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

if TYPE_CHECKING:
    # فقط برای annotation رشته‌ای ensure_aware — ایمپورت runtime داخل خود تابع است
    from datetime import datetime

from datetime import UTC

from app.core.config import get_settings

settings = get_settings()

_connect_args: dict = {}
if settings.database_url.startswith("sqlite"):
    # timeout=30 (ثانیهٔ صبر روی قفل نوشتاری): پیش‌فرض sqlite پنج ثانیه
    # است و روی ماشین/رانر شلوغ، قفلِ یک تسک پس‌زمینه خطای
    # «database is locked» آبشاری می‌سازد (شاهد: CI run 167 روی
    # PR #16). sqlite فقط مسیر dev/test است (production روی
    # PostgreSQL است)؛ این سقف رفتار را فقط صبورتر می‌کند.
    _connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_async_engine(
    settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def ensure_aware(dt) -> "datetime":
    """SQLite tzinfo را دور می‌اندازد؛ برای مقایسهٔ امن با utcnow آن را aware می‌کنیم.

    روی PostgreSQL (مقصد production) مقادیر از قبل aware هستند و دست‌نخورده می‌مانند.
    """
    from datetime import datetime

    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt
