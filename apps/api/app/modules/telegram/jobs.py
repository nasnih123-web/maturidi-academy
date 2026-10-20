"""جاب‌های ARQ صف telegram — فاز ۱۱.

ثبت در worker.py انجام می‌شود (import side-effect آگاهانه در entrypoint).
"""
from __future__ import annotations

import uuid

from app.core.queues import register_task


@register_task("telegram")
async def telegram_import_channel(
    ctx, *, channel: str, limit: int, actor_id: str
) -> dict:
    """درون‌ریزی آرشیو کانال — بدنهٔ اصلی در import_service.run_import."""
    from app.core.database import SessionLocal
    from app.modules.telegram import import_service

    _ = ctx
    async with SessionLocal() as db:
        return await import_service.run_import(
            db, channel=channel, limit=limit, actor_id=uuid.UUID(actor_id)
        )


@register_task("telegram")
async def telegram_publish_message(ctx, *, published_id: str) -> dict:
    """ارسال یک رکورد انتشار pending — idempotent."""
    from app.core.database import SessionLocal
    from app.modules.telegram import distribute_service

    _ = ctx
    async with SessionLocal() as db:
        return await distribute_service.send_pending(db, uuid.UUID(published_id))
