"""میدل‌ویرهای HTTP — فاز ۰/۲ (قرارداد §۱ و §۱۱).

- RequestIdMiddleware: هر درخواست یک request_id می‌گیرد (هدر ورودی یا UUID
  جدید)؛ در contextvar فاز ۱ قرار می‌گیرد و در هدر پاسخ برمی‌گردد.
- AccessLogMiddleware: لاگ دسترسی ساختاریافته (متد/مسیر/وضعیت/مدت/request_id)
  + ثبت در متریک‌های درون‌حافظه‌ای.
- SecurityHeadersMiddleware: هدرهای امنیتی پایه — فقط افزودنی است، هیچ تغییری
  در قرارداد API ایجاد نمی‌کند.
- BodySizeLimitMiddleware: سقف سراسری حجم body بر اساس هدر Content-Length
  (Track 2 / §۱۵) — آپلودهای فایل سقف دقیق‌تر خودشان را در
  read_capped_upload دارند؛ این میدل‌ویر سپر سراسریِ ارزان است.

ترتیب اجرا (در main.py): RequestId → BodySizeLimit → AccessLog → SecurityHeaders.
"""
from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.context import request_id_var
from app.core.logging import logger
from app.core.metrics import record_request


class RequestIdMiddleware(BaseHTTPMiddleware):
    """request_id در هدر پاسخ و context — پاکت خطا از همین context می‌خواند."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request_id_var.set(rid)
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response


class AccessLogMiddleware(BaseHTTPMiddleware):
    """لاگ دسترسی + متریک — مدت پاسخ و request_id (الگوی turbo، سازگار با §۱۱)."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        record_request(
            request.method, request.url.path, response.status_code, duration_ms
        )
        logger.info(
            "http_access method=%s path=%s status=%s duration_ms=%s request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id_var.get() or "-",
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """هدرهای امنیتی پایه برای همهٔ پاسخ‌ها.

    فقط هدر اضافه می‌کند؛ body/status/قرارداد دست‌نخورده می‌ماند.
    HSTS عمداً اضافه نشده — روی http توسعه می‌تواند دردسرساز شود؛
    در production پشت TLS توسط ingress/proxy تنظیم شود.
    """

    HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    }

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        for name, value in self.HEADERS.items():
            response.headers.setdefault(name, value)
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """سقف سراسری حجم بدنهٔ درخواست — Track 2 / §۱۵.

    اگر هدر Content-Length از سقف بیشتر باشد، بدون خواندن حتی یک بایت از
    body، 413 با پاکت خطای یکپارچه (§۱) برمی‌گرداند. برای bodyهای chunked
    بدون Content-Length، سقف‌های دقیق‌ترِ per-module (read_capped_upload در
    app/core/storage.py) اعمال می‌شود.
    """

    def __init__(self, app, max_bytes: int) -> None:
        super().__init__(app)
        self._max_bytes = max_bytes

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                size = int(declared)
            except ValueError:
                size = 0
            if size > self._max_bytes:
                from starlette.responses import JSONResponse

                return JSONResponse(
                    status_code=413,
                    content={
                        "error": {
                            "code": "request_body_too_large",
                            "message": "حجم درخواست بیش از سقف مجاز است",
                            "details": {"max_bytes": self._max_bytes},
                        },
                        "request_id": request_id_var.get(),
                    },
                )
        return await call_next(request)
