"""کپچای ثبت‌نام — Cloudflare Turnstile (C-02 — ADR-0029، قرارداد §۲).

راستی‌آزمایی سمت سرور با siteverify کلودفلر. ماشین وضعیت دقیق:

- CAPTCHA_ENABLED=false (صریح) → کپچا خاموش است (فقط dev)؛ ثبت‌نام
  بدون توکن می‌گذرد و این وضعیت در startup لاگ می‌شود.
- enabled + TURNSTILE_SECRET_KEY تنظیم‌شده → توکن الزامی است:
  نبود/نامعتبر → 403 captcha_failed.
- enabled + secret تنظیم‌نشده → fail-closed: 503
  captcha_not_configured (در هیچ محیطی «بی‌سکوت قبول» نداریم؛
  اپراتور یا secret می‌گذارد یا صریحاً خاموش می‌کند).
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import get_settings
from app.core.errors import APIError

logger = logging.getLogger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _make_client() -> httpx.AsyncClient:
    """فکتوری کلاینت — در تست‌ها با MockTransport جایگزین می‌شود."""
    return httpx.AsyncClient(timeout=10.0)


def captcha_state() -> str:
    """disabled | active | misconfigured — برای health/لاگ/تست."""
    s = get_settings()
    if not s.captcha_enabled:
        return "disabled"
    if not s.turnstile_secret_key.strip():
        return "misconfigured"
    return "active"


async def verify_turnstile(token: str, remote_ip: str | None) -> bool:
    """تماس واقعی siteverify — هر خطای شبکه/پاسخ بد = نامعتبر (False)."""
    s = get_settings()
    payload = {"secret": s.turnstile_secret_key, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    try:
        async with _make_client() as client:
            resp = await client.post(SITEVERIFY_URL, data=payload)
        if resp.status_code != 200:
            logger.warning("turnstile siteverify HTTP %s", resp.status_code)
            return False
        return bool(resp.json().get("success"))
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("turnstile siteverify failed: %s", type(exc).__name__)
        return False


async def enforce_captcha(token: str | None, remote_ip: str | None) -> None:
    """گیت ثبت‌نام — یا رد می‌کند یا بی‌صدا می‌گذرد (وقتی خاموش است)."""
    state = captcha_state()
    if state == "disabled":
        return
    if state == "misconfigured":
        logger.error(
            "captcha enabled but TURNSTILE_SECRET_KEY is not configured — "
            "registration rejected fail-closed (503)"
        )
        raise APIError(
            503,
            "captcha_not_configured",
            "کپچا فعال است ولی پیکربندی نشده است؛ ثبت‌نام موقتاً ممکن نیست",
        )
    if not token or not token.strip():
        raise APIError(
            403, "captcha_failed", "تکمیل کپچا برای ثبت‌نام الزامی است"
        )
    if not await verify_turnstile(token.strip(), remote_ip):
        raise APIError(
            403, "captcha_failed", "راستی‌آزمایی کپچا ناموفق بود؛ دوباره تلاش کنید"
        )
