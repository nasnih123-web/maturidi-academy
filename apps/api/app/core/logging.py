"""لاگ ساختاریافته — فاز ۲ §۱۱.

- پیش‌فرض: لاگ متنی (dev).
- با `LOG_FORMAT=json`: هر رکورد یک خط JSON با فیلدهای
  timestamp/level/logger/message/request_id — آمادهٔ ارسال به Loki.
- request_id از contextvar فاز ۱ خوانده می‌شود؛ هیچ‌وقت secret لاگ نکنید.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.context import request_id_var


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> None:
    """پیکربندی یک‌بارهٔ لاگ — در main.py قبل از ساخت app صدا زده می‌شود."""
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_format.strip().lower() == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    # نویز کتابخانه‌های شخص ثالث کمتر شود
    for noisy in ("uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


logger = logging.getLogger("maturidi")
