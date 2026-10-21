"""همگام‌سازی وضعیت بیلدها با GitHub — کرون ARQ (F-05 remediation).

هر ۲ دقیقه روی صف analytics (کار سبک دوره‌ای، قرارداد §۵): وضعیت
درخواست‌های dispatchشده (`provider=github_actions`، وضعیت queued/running)
از روی workflow run واقعی گیت‌هاب به‌روز می‌شود — run URL، وضعیت نهایی و
نام artifact. منطق در `builds_service.sync_build_requests` است تا با
«کلاینت تزریقی» تست‌پذیر باشد؛ این فایل فقط پوستهٔ نازک ARQ است.

هیچ shell/دستور خارجی‌ای اجرا نمی‌شود و هیچ ورودی کاربر به فرمانی نمی‌رسد؛
تنها فراخوانی‌ها قالب‌های ثابت GitHub REST API با توکن env هستند.
ثبت با @register_cron؛ worker.py آن را از رجیستری می‌خواند.
"""
from __future__ import annotations

from app.core.queues import register_cron


@register_cron(
    "analytics", name="build-status-sync", minute=set(range(0, 60, 2))
)
async def build_status_sync_cron(ctx: dict) -> dict:
    from app.core.database import SessionLocal
    from app.modules.admin import builds_service

    async with SessionLocal() as db:
        return await builds_service.sync_build_requests(db)
