"""CORS محدود به ویجت‌ها — فاز ۱۱ (ADR-0008، §۹.۵).

- فقط مسیرهای زیر `/api/v1/widgets/` هدر `Access-Control-Allow-Origin: *`
  می‌گیرند؛ هیچ endpoint دیگری (مخصوصاً احرازهویت‌شده‌ها) wildcard ندارد.
- بدون credential/cookie: احراز هویت ویجت فقط با هدر X-API-Key یا
  ?api_key= است، پس `*` امن است.
- پیاده‌سازی middleware مسیر-مبنا (نه sub-app جدا) تا OpenAPI روی همان اپ
  اصلی بماند.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

WIDGETS_PREFIX = "/api/v1/widgets/"

_PREFLIGHT_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "X-API-Key, Content-Type",
    "Access-Control-Max-Age": "86400",
    # عمداً هیچ Access-Control-Allow-Credentials نیست
}


class WidgetCorsMiddleware(BaseHTTPMiddleware):
    """هدر CORS wildcard فقط برای /api/v1/widgets/*."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not request.url.path.startswith(WIDGETS_PREFIX):
            return await call_next(request)
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=dict(_PREFLIGHT_HEADERS))
        response = await call_next(request)
        # فقط wildcard؛ هرگز allow-credentials
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Vary"] = "Origin"
        return response
