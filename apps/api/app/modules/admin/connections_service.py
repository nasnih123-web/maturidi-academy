"""سرویس داشبورد اتصالات بیرونی — فاز ۱۴.

- GET /status: وضعیت زندهٔ هر وابستگی بیرونی — فقط خوانش از
  platform_settings/env/جدول‌های موجود؛ هیچ secretای در پاسخ یا audit نیست (§۱۴).
- POST /test/{service}: «تست تماس» هر سرویس — نتیجه در audit لاگ می‌شود.
  در production تماس واقعی با timeout؛ در تست‌ها توابع TESTERS قابل
  monkeypatch‌اند (هیچ mockای در مسیر عملیاتی نیست — §۱۵.۹).
"""
from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import get_settings
from app.core.errors import APIError
from app.core.platform_settings import get_setting
from app.models.models import AIProviderConfig, User

SERVICES = ("ai", "sms", "telegram", "payment", "maps", "signing")


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# وضعیت
# ---------------------------------------------------------------------------


async def get_status(db: AsyncSession) -> dict:
    """وضعیت همهٔ وابستگی‌های بیرونی — بدون هیچ مقدار secret."""
    settings = get_settings()
    out: dict[str, Any] = {}

    # AI — کلید هرگز برنمی‌گردد، فقط «پیکربندی شده؟»
    ai_key = await get_setting(db, "ai.claude_api_key")
    ai_cfgs = (
        await db.execute(
            select(AIProviderConfig).where(AIProviderConfig.enabled.is_(True))
        )
    ).scalars().all()
    out["ai"] = {
        "configured": bool(ai_key and ai_key.strip()),
        "providers": [
            {"provider": c.provider, "model": c.model,
             "is_fallback": c.is_fallback}
            for c in ai_cfgs
        ],
        "model": await get_setting(db, "ai.claude_model")
        or await get_setting(db, "ai.model"),
    }

    # Embedding / جست‌وجوی معنایی (M-07) — هشدار صریح وقتی در عمل خاموش است
    from app.modules.fatwa.embeddings import semantic_search_status

    out["embeddings"] = await semantic_search_status(db)

    # SMS
    out["sms"] = {
        "configured": bool(settings.sms_api_key and settings.sms_api_key.strip()),
        "provider": settings.sms_provider or ("kavenegar" if settings.sms_api_key else None),
    }

    # Telegram — session در platform_settings (رمزنگاری‌شده)؛ فقط «متصل؟»
    tg_session = await get_setting(db, "telegram.session")
    tg_bot_token = await get_setting(db, "telegram.bot_token")
    out["telegram"] = {
        "connected": bool(tg_session and tg_session.strip()),
        "account": await get_setting(db, "telegram.phone_masked"),
        "bot_configured": bool(tg_bot_token and tg_bot_token.strip()),
        "channel": await get_setting(db, "telegram.channel"),
    }

    # پرداخت؛ صادقانه «پیکربندی نشده»
    out["payment"] = {
        "configured": False,
        "note": "درگاه پرداخت پیکربندی نشده است",
    }

    # نقشه
    neshan_key = await get_setting(db, "maps.neshan_api_key")
    out["maps"] = {
        "osm": {"available": True, "note": "بدون کلید — Nominatim"},
        "neshan": {"configured": bool(neshan_key and neshan_key.strip())},
    }

    # گواهی‌های امضا — کلیدهای signing.* در platform_settings
    signing: dict[str, dict] = {}
    for name, key, expiry_key in (
        ("apple_developer", "signing.apple_developer", "signing.apple_developer_expires_at"),
        ("google_play", "signing.google_play", "signing.google_play_expires_at"),
        ("cafebazaar", "signing.cafebazaar", "signing.cafebazaar_expires_at"),
        ("windows_cert", "signing.windows_cert", "signing.windows_cert_expires_at"),
        ("macos_cert", "signing.macos_cert", "signing.macos_cert_expires_at"),
    ):
        present = await get_setting(db, key)
        signing[name] = {
            "uploaded": bool(present and present.strip()),
            "expires_at": await get_setting(db, expiry_key),
        }
    out["signing"] = signing

    out["checked_at"] = _utcnow().isoformat()
    return out


# ---------------------------------------------------------------------------
# تست تماس — توابع واقعی (TESTERS برای monkeypatch در تست‌ها)
# ---------------------------------------------------------------------------


async def _test_ai(db: AsyncSession, params: dict) -> dict:
    """پینگ provider هوش مصنوعی — فراخوانی حداقلی با timeout."""
    from app.modules.fatwa import providers as ai_providers

    provider = await ai_providers.resolve_provider(db)
    if provider is None:
        return {"ok": False, "error": "ai_not_configured",
                "detail": "هیچ provider فعالی پیکربندی نشده است"}
    name = getattr(provider, "name", None) or type(provider).__name__
    model = getattr(provider, "_model", None)
    # فراخوانی حداقلی واقعی — generate کوتاه با timeout مشخص
    try:
        layers = ai_providers.PromptLayers(
            system="You are a connectivity probe. Reply with the single word: ok",
            safety="",
            context="",
            user_input="ping",
        )
        result = await provider.generate(layers, timeout_s=25.0, max_tokens=4)
        return {"ok": True, "provider": name, "model": model,
                "response_preview": str(getattr(result, "text", ""))[:120]}
    except Exception as exc:  # noqa: BLE001 — خطای provider صادقانه گزارش می‌شود
        return {"ok": False, "error": "ai_ping_failed", "detail": str(exc)[:300]}


async def _test_sms(db: AsyncSession, params: dict) -> dict:
    """ارسال پیامک تست به شماره‌ای که super_admin داده است."""
    phone = (params.get("phone") or "").strip()
    if not phone:
        raise APIError(422, "missing_phone", "شمارهٔ مقصد (phone) الزامی است")
    settings = get_settings()
    if not (settings.sms_api_key and settings.sms_api_key.strip()):
        return {"ok": False, "error": "sms_not_configured",
                "detail": "کلید پیامک پیکربندی نشده است"}
    from app.core import sms as sms_mod

    try:
        sent = await sms_mod.send_sms(
            phone, "تست اتصال پیامک آکادمی ماتریدی — این پیام آزمایشی است.")
        return {"ok": bool(sent), "to": phone}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": "sms_send_failed", "detail": str(exc)[:300]}


async def _test_telegram(db: AsyncSession, params: dict) -> dict:
    """ارسال پیام تست تلگرام."""
    from app.modules.telegram import bot_service

    chat_id = params.get("chat_id") or await bot_service.default_channel(db)
    if not chat_id:
        return {"ok": False, "error": "telegram_no_target",
                "detail": "کانال مقصد پیکربندی نشده است"}
    message_id = await bot_service.send_message(
        db, chat_id, "تست اتصال تلگرام آکادمی ماتریدی ✅")
    if message_id is None:
        return {"ok": False, "error": "telegram_send_failed",
                "detail": "بات غیرفعال است یا ارسال ناموفق بود"}
    return {"ok": True, "chat_id": str(chat_id), "message_id": message_id}


async def _test_payment(db: AsyncSession, params: dict) -> dict:
    """تراکنش آزمایشی — صادقانه: در دسترس نیست (درگاه پیکربندی نشده است)."""
    return {"ok": False, "error": "payment_not_available",
            "detail": "درگاه پرداخت پیکربندی نشده است"}


async def _test_maps(db: AsyncSession, params: dict) -> dict:
    """تست اتصال نقشه — OSM Nominatim (بدون کلید) یا Neshan (با کلید)."""
    import httpx

    neshan_key = await get_setting(db, "maps.neshan_api_key")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if neshan_key and neshan_key.strip():
                resp = await client.get(
                    "https://api.neshan.org/v1/search",
                    params={"term": "تهران", "lat": 35.7, "lng": 51.4},
                    headers={"Api-Key": neshan_key.strip()},
                )
                return {"ok": resp.status_code < 400, "provider": "neshan",
                        "http_status": resp.status_code}
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": "Tehran", "format": "json", "limit": 1},
                headers={"User-Agent": "maturidi-academy/1.0"},
            )
            return {"ok": resp.status_code < 400, "provider": "osm",
                    "http_status": resp.status_code}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": "maps_ping_failed", "detail": str(exc)[:300]}


async def _test_signing(db: AsyncSession, params: dict) -> dict:
    """بررسی گواهی‌های امضا — فقط حضور و تاریخ انقضا، بدون آپلود/تغییر."""
    status = await get_status(db)
    signing = status["signing"]
    missing = [k for k, v in signing.items() if not v["uploaded"]]
    return {"ok": not missing, "uploaded": [k for k in signing if signing[k]["uploaded"]],
            "missing": missing}


# نگاشت سرویس → تابع تست؛ تست‌ها می‌توانند جایگزین کنند (monkeypatch)
TESTERS: dict[str, Callable[[AsyncSession, dict], Awaitable[dict]]] = {
    "ai": _test_ai,
    "sms": _test_sms,
    "telegram": _test_telegram,
    "payment": _test_payment,
    "maps": _test_maps,
    "signing": _test_signing,
}


async def test_service(
    db: AsyncSession,
    service: str,
    params: dict,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """اجرای تست یک سرویس + ثبت نتیجه در audit (بدون هیچ secret)."""
    if service not in TESTERS:
        raise APIError(404, "unknown_service", f"سرویس ناشناخته: {service}")
    started = time.monotonic()
    try:
        result = await TESTERS[service](db, params or {})
    except APIError:
        raise
    except Exception as exc:  # noqa: BLE001 — هر خطای پیش‌بینی‌نشده هم audit می‌شود
        result = {"ok": False, "error": "test_crashed", "detail": str(exc)[:300]}
    latency_ms = int((time.monotonic() - started) * 1000)
    result = {**result, "service": service, "latency_ms": latency_ms,
              "tested_at": _utcnow().isoformat()}
    # §۱۴: فقط وضعیت و خطا — هرگز مقدار secret یا شمارهٔ کامل مقصد
    safe_params = {k: v for k, v in (params or {}).items() if k != "phone"}
    if (params or {}).get("phone"):
        safe_params["phone_masked"] = "****" + str(params["phone"])[-4:]
    await log_audit(
        db, actor_id=actor.id, actor_type="admin",
        action=f"connections.test.{service}",
        entity_type="external_connection", entity_id=service,
        new_values={"ok": result.get("ok"), "error": result.get("error"),
                    "latency_ms": latency_ms, "params": safe_params},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    return result
