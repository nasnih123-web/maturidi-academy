"""خطاهای یکدست API — پاکت خطای قرارداد فاز ۰ §۱.

همهٔ خطاها (از جمله خطاهای اعتبارسنجی و 404) با همین پاکت برمی‌گردند:
{"error": {"code": "...", "message": "...", "details": {}}, "request_id": "..."}
"""
from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.context import request_id_var


class APIError(Exception):
    """خطای دامنه‌ای — همیشه با پاکت یکدست به کلاینت می‌رسد."""

    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def _envelope(code: str, message: str, details: dict, status_code: int) -> JSONResponse:
    rid = request_id_var.get() or str(uuid.uuid4())
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"code": code, "message": message, "details": details},
            "request_id": rid,
        },
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api_error(request: Request, exc: APIError):
        return _envelope(exc.code, exc.message, exc.details, exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        return _envelope("http_error", str(exc.detail), {}, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        return _envelope(
            "validation_error",
            "خطای اعتبارسنجی ورودی",
            {"errors": exc.errors()},
            422,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        return _envelope("internal_error", "خطای داخلی سرور", {}, 500)
