"""متغیرهای context مشترک (مثل request_id) برای لایه‌های پایین‌تر."""
from contextvars import ContextVar

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
