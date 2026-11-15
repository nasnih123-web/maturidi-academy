"""انتزاع درگاه پرداخت — فاز ۱۵ (ADR-0013).

- هیچ secreتی هاردکد نیست: merchant key همیشه از platform_settings می‌آید.
- ZarinPal: `request_payment` → authority + pay_url؛ `verify_payment` → ref_id.
  سندباکس: https://sandbox.zarinpal.com — پروداکشن: https://api.zarinpal.com
  (حالت از `payment.zarinpal_sandbox` خوانده می‌شود؛ پیش‌فرض: sandbox).
- IDPay: `request_payment` → ساخت تراکنش (POST /v1.1/payment) و لینک پرداخت؛
  `verify_payment` → POST /v1.1/payment/verify (وضعیت ۱۰۰/۱۰۱ = موفق).
  سندباکس با هدر X-SANDBOX کنترل می‌شود (`payment.idpay_sandbox`؛ پیش‌فرض: روشن).
  نکتهٔ قراردادی: verify آیدی‌پی علاوه بر شناسهٔ تراکنش، `order_id` ساخت را
  هم می‌خواهد؛ order_id در خود authority نگه داشته می‌شود (قالب
  «<tx_id>:<order_id>») تا هیچ ستون/وضعیت اضافه‌ای لازم نباشد.
- httpx با timeout صریح؛ هر خطای حمل‌ونقل به GatewayError تبدیل می‌شود.
- امضای وبهوک: برای زرین‌پال وبهوک کلاسیک وجود ندارد — «تأیید»، همان فراخوان
  سمت‌سرورِ verify روی authority است (در ADR-0013 مستند شده). درگاه‌هایی که
  وبهوک امضاشده می‌فرستند از HMAC-SHA256 روی بدنهٔ خام استفاده
  می‌کنند (کلید: `payment.webhook_secret`). آیدی‌پی هم امضا نمی‌فرستد؛
  اصالت اعلان آن هم با verify سمت‌سرور اثبات می‌شود (مثل زرین‌پال).
"""
from __future__ import annotations

import abc
import hashlib
import hmac
import uuid
from dataclasses import dataclass

import httpx

ZARINPAL_SANDBOX_BASE = "https://sandbox.zarinpal.com"
ZARINPAL_PROD_BASE = "https://api.zarinpal.com"
ZARINPAL_SANDBOX_PAY = "https://sandbox.zarinpal.com/pg/StartPay"
ZARINPAL_PROD_PAY = "https://www.zarinpal.com/pg/StartPay"

IDPAY_BASE = "https://api.idpay.ir/v1.1"
IDPAY_PAY = "https://idpay.ir/p/ws"
IDPAY_SANDBOX_PAY = "https://idpay.ir/p/ws-sandbox"

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


class IdpayGateway(PaymentGateway):
    """درگاه آیدی‌پی (API v1.1) — هدر X-API-KEY + X-SANDBOX.

    authority ذخیره‌شده قالب «<tx_id>:<order_id>» دارد: verify آیدی‌پی هر
    دو را می‌خواهد و order_id هنگام ساخت تولید می‌شود؛ این قالب آن را بدون
    ستون اضافه کنار شناسهٔ تراکنش نگه می‌دارد. `pay_url_for` بخش order را
    جدا می‌کند (لینک پرداخت فقط با tx_id ساخته می‌شود).
    """

    name = "idpay"

    def __init__(self, *, sandbox: bool = True, client: httpx.AsyncClient | None = None):
        self.sandbox = sandbox
        self._client = client  # تزریق در تست

    def _http(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=_HTTP_TIMEOUT, trust_env=False)

    def _headers(self, merchant_key: str) -> dict[str, str]:
        return {
            "X-API-KEY": merchant_key,
            "X-SANDBOX": "1" if self.sandbox else "0",
            "Content-Type": "application/json",
        }

    @staticmethod
    def split_authority(authority: str) -> tuple[str, str]:
        """(tx_id, order_id) — authority بدون «:» → order_id همان tx_id."""
        tx_id, sep, order_id = authority.partition(":")
        return tx_id, (order_id if sep and order_id else tx_id)

    def pay_url_for(self, authority: str) -> str:
        tx_id, _ = self.split_authority(authority)
        base = IDPAY_SANDBOX_PAY if self.sandbox else IDPAY_PAY
        return f"{base}/{tx_id}"

    def verify_webhook_signature(self, *, raw_body: bytes, signature: str | None, webhook_secret: str | None) -> bool:
        # آیدی‌پی اعلان امضاشده نمی‌فرستد؛ اصالت پرداخت فقط با فراخوان
        # سمت‌سرور verify اثبات می‌شود (همان الگوی زرین‌پال، ADR-0013).
        return False

    async def request_payment(
        self, *, amount: int, description: str, callback_url: str, merchant_key: str
    ) -> GatewayPaymentRequest:
        order_id = uuid.uuid4().hex
        payload = {
            "order_id": order_id,
            "amount": amount,
            "desc": description[:255],
            "callback": callback_url,
        }
        client = self._http()
        close = self._client is None
        try:
            resp = await client.post(
                f"{IDPAY_BASE}/payment", json=payload, headers=self._headers(merchant_key)
            )
            status_code = resp.status_code
            body = resp.json() if resp.content else {}
        except httpx.HTTPError as exc:
            raise GatewayError(f"idpay request failed: {exc}") from exc
        finally:
            if close:
                await client.aclose()
        tx_id = (body or {}).get("id")
        link = (body or {}).get("link")
        if status_code != 201 or not tx_id:
            raise GatewayError(
                f"idpay request rejected: status={status_code} "
                f"error_code={(body or {}).get('error_code')} "
                f"error_message={(body or {}).get('error_message')}"
            )
        return GatewayPaymentRequest(
            authority=f"{tx_id}:{order_id}",
            pay_url=str(link) if link else self.pay_url_for(str(tx_id)),
        )

    async def verify_payment(
        self, *, authority: str, amount: int, merchant_key: str
    ) -> GatewayVerifyResult:
        tx_id, order_id = self.split_authority(authority)
        payload = {"id": tx_id, "order_id": order_id}
        client = self._http()
        close = self._client is None
        try:
            resp = await client.post(
                f"{IDPAY_BASE}/payment/verify",
                json=payload,
                headers=self._headers(merchant_key),
            )
            body = resp.json() if resp.content else {}
        except httpx.HTTPError as exc:
            raise GatewayError(f"idpay verify failed: {exc}") from exc
        finally:
            if close:
                await client.aclose()
        status = (body or {}).get("status")
        track_id = (body or {}).get("track_id")
        # ۱۰۰ = تأییدشده؛ ۱۰۱ = قبلاً تأیید شده (idempotent در سمت درگاه)
        if status not in (100, 101) or track_id is None:
            raise GatewayError(
                f"idpay verify rejected: status={status} "
                f"error_code={(body or {}).get('error_code')} "
                f"error_message={(body or {}).get('error_message')}"
            )
        payment = (body or {}).get("payment") or {}
        return GatewayVerifyResult(
            ref_id=str(track_id), card_pan=payment.get("card_no")
        )


def build_gateway(
    name: str, *, sandbox: bool = True, client: httpx.AsyncClient | None = None
) -> PaymentGateway:
    """کارخانهٔ درگاه — نام ناشناس → GatewayError (نه fallback مخفی)."""
    if name == "zarinpal":
        return ZarinPalGateway(sandbox=sandbox, client=client)
    if name == "idpay":
        return IdpayGateway(sandbox=sandbox, client=client)
    raise GatewayError(f"unknown gateway: {name}")
