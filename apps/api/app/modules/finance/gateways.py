"""انتزاع درگاه پرداخت — فاز ۱۵ (ADR-0013).

- هیچ secreتی هاردکد نیست: merchant key همیشه از platform_settings می‌آید.
- ZarinPal: `request_payment` → authority + pay_url؛ `verify_payment` → ref_id.
  سندباکس: https://sandbox.zarinpal.com — پروداکشن: https://api.zarinpal.com
  (حالت از `payment.zarinpal_sandbox` خوانده می‌شود؛ پیش‌فرض: sandbox).
- httpx با timeout صریح؛ هر خطای حمل‌ونقل به GatewayError تبدیل می‌شود.
- امضای وبهوک: برای زرین‌پال وبهوک کلاسیک وجود ندارد — «تأیید»، همان فراخوان
  سمت‌سرورِ verify روی authority است (در ADR-0013 مستند شده). درگاه‌هایی که
  وبهوک امضاشده می‌فرستند (مثل IDPay) از HMAC-SHA256 روی بدنهٔ خام استفاده
  می‌کنند (کلید: `payment.webhook_secret`).
"""
from __future__ import annotations

import abc
import hashlib
import hmac
from dataclasses import dataclass

import httpx

ZARINPAL_SANDBOX_BASE = "https://sandbox.zarinpal.com"
ZARINPAL_PROD_BASE = "https://api.zarinpal.com"
ZARINPAL_SANDBOX_PAY = "https://sandbox.zarinpal.com/pg/StartPay"
ZARINPAL_PROD_PAY = "https://www.zarinpal.com/pg/StartPay"

_HTTP_TIMEOUT = httpx.Timeout(15.0, connect=8.0)


class GatewayError(Exception):
    """خطای درگاه — سرویس آن را به پاکت یکدست تبدیل می‌کند."""


@dataclass
class GatewayPaymentRequest:
    authority: str
    pay_url: str


@dataclass
class GatewayVerifyResult:
    ref_id: str
    card_pan: str | None = None


@dataclass
class GatewayReportEntry:
    ref_id: str
    amount: int
    status: str  # "succeeded" | "failed"


class PaymentGateway(abc.ABC):
    """قرارداد درگاه — پیاده‌سازی جدید فقط این متدها را پر می‌کند."""

    name: str

    @abc.abstractmethod
    async def request_payment(
        self,
        *,
        amount: int,
        description: str,
        callback_url: str,
        merchant_key: str,
    ) -> GatewayPaymentRequest: ...

    @abc.abstractmethod
    async def verify_payment(
        self,
        *,
        authority: str,
        amount: int,
        merchant_key: str,
    ) -> GatewayVerifyResult: ...

    def verify_webhook_signature(
        self, *, raw_body: bytes, signature: str | None, webhook_secret: str | None
    ) -> bool:
        """پیش‌فرض: HMAC-SHA256 روی بدنهٔ خام (درگاه‌های وبهوک‌دار).

        زرین‌پال این را override می‌کند: «تأیید»، همان verify سمت‌سرور است.
        """
        if not signature or not webhook_secret:
            return False
        expected = hmac.new(webhook_secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    async def fetch_report(self, *, merchant_key: str) -> list[GatewayReportEntry]:
        """گزارش تراکنش‌های درگاه برای reconciliation — پیش‌فرض: پشتیبانی‌نشده."""
        raise GatewayError(f"fetch_report not supported by gateway {self.name}")


class ZarinPalGateway(PaymentGateway):
    name = "zarinpal"

    def __init__(self, *, sandbox: bool = True, client: httpx.AsyncClient | None = None):
        self.sandbox = sandbox
        base = ZARINPAL_SANDBOX_BASE if sandbox else ZARINPAL_PROD_BASE
        pay = ZARINPAL_SANDBOX_PAY if sandbox else ZARINPAL_PROD_PAY
        self._api_base = base
        self._pay_base = pay
        self._client = client  # تزریق در تست

    def _http(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=_HTTP_TIMEOUT, trust_env=False)

    def verify_webhook_signature(self, *, raw_body: bytes, signature: str | None, webhook_secret: str | None) -> bool:
        # زرین‌پال وبهوک امضاشده نمی‌فرستد؛ اصالت پرداخت فقط با فراخوان
        # سمت‌سرور verify روی authority اثبات می‌شود (ADR-0013 §وبهوک).
        # این endpoint برای زرین‌پال فقط payloadهایی را می‌پذیرد که حاوی
        # authority معتبر باشند و سپس verify صدا زده شود.
        return False

    async def request_payment(
        self, *, amount: int, description: str, callback_url: str, merchant_key: str
    ) -> GatewayPaymentRequest:
        payload = {
            "merchant_id": merchant_key,
            "amount": amount,
            "description": description[:255],
            "callback_url": callback_url,
            "currency": "IRR",
        }
        client = self._http()
        close = self._client is None
        try:
            resp = await client.post(f"{self._api_base}/pg/v4/payment/request.json", json=payload)
            resp.raise_for_status()
            body = resp.json()
        except httpx.HTTPError as exc:
            raise GatewayError(f"zarinpal request failed: {exc}") from exc
        finally:
            if close:
                await client.aclose()
        data = (body or {}).get("data") or {}
        code = data.get("code")
        authority = data.get("authority")
        if code != 100 or not authority:
            errors = (body or {}).get("errors") or {}
            raise GatewayError(f"zarinpal request rejected: code={code} errors={errors}")
        return GatewayPaymentRequest(
            authority=str(authority),
            pay_url=f"{self._pay_base}/{authority}",
        )

    async def verify_payment(
        self, *, authority: str, amount: int, merchant_key: str
    ) -> GatewayVerifyResult:
        payload = {"merchant_id": merchant_key, "amount": amount, "authority": authority}
        client = self._http()
        close = self._client is None
        try:
            resp = await client.post(f"{self._api_base}/pg/v4/payment/verify.json", json=payload)
            resp.raise_for_status()
            body = resp.json()
        except httpx.HTTPError as exc:
            raise GatewayError(f"zarinpal verify failed: {exc}") from exc
        finally:
            if close:
                await client.aclose()
        data = (body or {}).get("data") or {}
        code = data.get("code")
        ref_id = data.get("ref_id")
        # 100 = موفق؛ 101 = قبلاً verify شده (idempotent در سمت درگاه)
        if code not in (100, 101) or not ref_id:
            errors = (body or {}).get("errors") or {}
            raise GatewayError(f"zarinpal verify rejected: code={code} errors={errors}")
        return GatewayVerifyResult(ref_id=str(ref_id), card_pan=data.get("card_pan"))


def build_gateway(
    name: str, *, sandbox: bool = True, client: httpx.AsyncClient | None = None
) -> PaymentGateway:
    """کارخانهٔ درگاه — نام ناشناس → GatewayError (نه fallback مخفی)."""
    if name == "zarinpal":
        return ZarinPalGateway(sandbox=sandbox, client=client)
    raise GatewayError(f"unknown gateway: {name}")
