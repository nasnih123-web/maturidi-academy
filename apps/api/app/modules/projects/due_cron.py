"""کرون اعلان سررسید تسک‌ها — فاز ۱۶.

وظیفهٔ ARQ که هر ۶ ساعت اجرا می‌شود: تسک‌های با due_date در ۲۴ ساعت آینده
(وضعیت ≠ done) به محول‌شونده اعلان می‌دهد، با ضد-اسپم ۲۰ ساعته روی
due_notified_at. منطق اصلی در `service.run_task_due_soon_cycle` است تا با
«اکنونِ» تزریقی تست‌پذیر باشد؛ این فایل فقط پوستهٔ نازک ARQ است.

ثبت با @register_cron روی صف notifications (کار سبک، §۵)؛
worker.py آن را از رجیستری می‌خواند و به WorkerSettings اضافه می‌کند.
"""
from __future__ import annotations

from app.core.queues import register_cron


@register_cron("notifications", name="task-due-soon", hour={0, 6, 12, 18}, minute=0)
async def task_due_soon_cron(ctx: dict) -> dict:
    from app.core.database import SessionLocal
    from app.modules.projects import service

    async with SessionLocal() as db:
        out = await service.run_task_due_soon_cycle(db)
        return out.model_dump()
