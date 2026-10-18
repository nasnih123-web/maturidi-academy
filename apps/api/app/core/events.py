"""انتشار رویداد دامنه (الگوی outbox) — فاز ۰ §۴.

رویداد در همان تراکنشِ تغییر، در جدول domain_events ثبت می‌شود؛
dispatcher (فاز ۲) بعداً رویدادهای پردازش‌نشده را از دیتابیس می‌خواند.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import DomainEvent


async def emit_event(
    db: AsyncSession,
    *,
    aggregate_type: str,
    aggregate_id: str,
    event_type: str,
    payload: dict,
    source_client: str = "api",
    idempotency_key: str | None = None,
    schema_version: int = 1,
) -> DomainEvent:
    event = DomainEvent(
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=event_type,
        payload=payload,
        schema_version=schema_version,
        source_client=source_client,
        idempotency_key=idempotency_key,
    )
    db.add(event)
    await db.flush()
    return event
