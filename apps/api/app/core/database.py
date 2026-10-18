"""اتصال async به دیتابیس — engine از settings.database_url.

بدون Docker/PostgreSQL: SQLite از طریق aiosqlite (dev/tests).
نوع ستون‌ها Postgres-سازگار انتخاب شده (Uuid، JSON) تا migration روی
PostgreSQL بدون تغییر کار کند.
"""
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

_connect_args: dict = {}
if settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

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
    from datetime import datetime, timezone

    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
