"""پیامک — فاز ۱.

رابط provider با دو پیاده‌سازی:
- LogSmsProvider: حالت dev — فقط لاگ می‌کند (پیش‌فرض وقتی کلید تنظیم نشده).
- KavenegarProvider: ارسال واقعی با HTTP وقتی SMS_API_KEY تنظیم شده باشد.
افزودن Ghasedak یعنی یک کلاس دیگر با همین رابط — بدون تغییر کد مصرف‌کننده.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

import httpx

from app.core.config import get_settings

logger = logging.getLogger("maturidi.sms")


class SmsProvider(ABC):
    @abstractmethod
    async def send(self, phone: str, message: str) -> bool: ...


class LogSmsProvider(SmsProvider):
    async def send(self, phone: str, message: str) -> bool:
        logger.info("[DEV-SMS] to=%s message=%s", phone, message)
        return True


class KavenegarProvider(SmsProvider):
    """https://api.kavenegar.com/v1/{apikey}/sms/send.json"""

    def __init__(self, api_key: str, sender: str = ""):
        self.api_key = api_key
        self.sender = sender

    async def send(self, phone: str, message: str) -> bool:
        url = f"https://api.kavenegar.com/v1/{self.api_key}/sms/send.json"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                data={"receptor": phone, "sender": self.sender, "message": message},
            )
            resp.raise_for_status()
            return True


def get_sms_provider() -> SmsProvider:
    settings = get_settings()
    if settings.sms_api_key:
        return KavenegarProvider(api_key=settings.sms_api_key)
    return LogSmsProvider()


async def send_sms(phone: str, message: str) -> bool:
    return await get_sms_provider().send(phone, message)
