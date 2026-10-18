"""میدل‌ویرهای HTTP — فاز ۰/۲ (قرارداد §۱ و §۱۱).

- RequestIdMiddleware: هر درخواست یک request_id می‌گیرد (هدر ورودی یا UUID
  جدید)؛ در contextvar فاز ۱ قرار می‌گیرد و در هدر پاسخ برمی‌گردد.
- AccessLogMiddleware: لاگ دسترسی ساختاریافته (متد/مسیر/وضعیت/مدت/request_id)
  + ثبت در متریک‌های درون‌حافظه‌ای.
- SecurityHeadersMiddleware: هدرهای امنیتی پایه — فقط افزودنی است، هیچ تغییری
  در قرارداد API ایجاد نمی‌کند.

ترتیب اجرا (در main.py): RequestId → AccessLog → SecurityHeaders.
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
