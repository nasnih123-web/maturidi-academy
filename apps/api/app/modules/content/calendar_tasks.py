"""کرون روزانهٔ تقویم اسلامی — فاز ۴.

وظیفهٔ ARQ که هر روز اجرا می‌شود: انتشار خودکار رویدادهای امروزِ هجری و
فعال‌سازی/بازگشت تم مناسبتی. منطق اصلی در
`app.modules.content.cms_service.run_islamic_calendar_cycle` است تا با
«امروزِ» تزریقی تست‌پذیر باشد؛ این فایل فقط پوستهٔ نازک ARQ است
(ساخت session خودش + فراخوانی سرویس).

ثبت با @register_cron روی صف notifications (کار سبک، §۵)؛
worker.py آن را از رجیستری می‌خواند و به WorkerSettings اضافه می‌کند.
"""
from __future__ import annotations

from app.core.queues import register_cron


@register_cron("notifications", name="islamic-calendar-daily", hour=0, minute=5)
async def islamic_calendar_daily(ctx: dict) -> dict:
    from app.core.database import SessionLocal
    from app.modules.content import cms_service

    async with SessionLocal() as db:
        return await cms_service.run_islamic_calendar_cycle(db)
