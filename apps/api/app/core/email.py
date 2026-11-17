"""ایمیل تراکنشی — فاز ۱.

ترتیب انتخاب مسیر ارسال:
۱) اگر RESEND_API_KEY ست باشد، با HTTPS API ریسند — روی بعضی هاست‌ها
   (Railway) پورت‌های SMTP بسته‌اند و اتصال TCP تایم‌اوت می‌خورد.
۲) وگرنه اگر SMTP پیکربندی شده باشد، با SMTP.
۳) وگرنه (حالت dev) پیام فقط لاگ می‌شود تا جریان بازیابی رمز/تأیید
   ایمیل بدون سرویس واقعی هم قابل تست باشد.
کلید در platform_settings نگه‌داری می‌شود (فاز ۲ به بعد)؛ فعلاً از env.
"""
from __future__ import annotations

import asyncio
import logging
import re
import smtplib
from email.message import EmailMessage as StdEmailMessage

import httpx

from app.core.config import get_settings

logger = logging.getLogger("maturidi.email")

RESEND_API_URL = "https://api.resend.com/emails"


# remediation-pass-2 Track 1 (§۸): توکن/OTP هرگز در لاگ نمی‌آید — حتی در dev.
# الگوهای رایج حامل secret در بدنهٔ پیام (لینک بازیابی/تأیید، کد عددی) ماسک می‌شوند.
_SECRET_PATTERNS = (
    re.compile(r"([?&]token=|token[=:]\s*)([^\s&\"'<>]+)", re.IGNORECASE),
    re.compile(r"\b\d{6}\b"),  # کدهای تأیید عددی
)


def redact_secrets(text: str) -> str:
    redacted = _SECRET_PATTERNS[0].sub(r"\1[REDACTED]", text)
    return _SECRET_PATTERNS[1].sub("[CODE]", redacted)


def _make_client() -> httpx.AsyncClient:
    """فکتوری کلاینت — در تست‌ها با MockTransport جایگزین می‌شود."""
    return httpx.AsyncClient(timeout=15.0)


async def _send_via_resend(
    to: str, subject: str, body_text: str, body_html: str | None
) -> bool:
    settings = get_settings()
    payload: dict[str, object] = {
        "from": settings.smtp_from,
        "to": [to],
        "subject": subject,
        "text": body_text,
    }
    if body_html:
        payload["html"] = body_html
    async with _make_client() as client:
        resp = await client.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json=payload,
        )
    # §۸: کلید و بدنهٔ پاسخ هرگز در خطا/لاگ نمی‌آید — فقط کد وضعیت.
    if not 200 <= resp.status_code < 300:
        raise RuntimeError(f"resend delivery failed: http={resp.status_code}")
    return True


async def send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    settings = get_settings()
    if settings.resend_api_key:
        return await _send_via_resend(to, subject, body_text, body_html)
    if not settings.smtp_host:
        logger.info(
            "[DEV-EMAIL] to=%s subject=%s\n%s", to, subject, redact_secrets(body_text)
        )
        return True
    msg = StdEmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    def _send() -> None:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password or "")
            s.send_message(msg)

    await asyncio.to_thread(_send)
    return True
