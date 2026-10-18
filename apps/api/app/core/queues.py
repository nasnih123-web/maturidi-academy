"""رجیستری صف‌های ARQ — فاز ۲ (قرارداد §۵).

شش صف جدا، هرکدام concurrency و retry جدا. اجرای واقعی ورکرها عملیات
فاز ۲+ است (systemd/docker)؛ این ماژول رجیستری + ساخت settings ورکر است.
نقطهٔ ورود: `app/worker.py`.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from arq.connections import RedisSettings

from app.core.config import get_settings

# نام صف → تنظیمات اجرا
QUEUES: dict[str, dict[str, Any]] = {
    "critical": {
        "description": "پرداخت — بالاترین اولویت",
        "max_jobs": 10,  # concurrency
        "max_tries": 5,
        "job_timeout": 300,
    },
    "ai": {
        "description": "فتوا/دستیار صوتی — محدودتر چون هزینه‌بر است",
        "max_jobs": 2,
        "max_tries": 3,
        "job_timeout": 600,
    },
    "media": {
        "description": "STT/TTS/OCR/تبدیل ویدیو",
        "max_jobs": 4,
        "max_tries": 3,
        "job_timeout": 1800,
    },
    "telegram": {
        "description": "بات تلگرام و درون‌ریزی",
        "max_jobs": 4,
        "max_tries": 5,
        "job_timeout": 300,
    },
    "notifications": {
        "description": "ایمیل/پیامک/پوش",
        "max_jobs": 8,
        "max_tries": 5,
        "job_timeout": 120,
    },
    "analytics": {
        "description": "رویدادهای تحلیلی",
        "max_jobs": 4,
        "max_tries": 3,
        "job_timeout": 120,
    },
}

# رجیستری توابع هر صف — ماژول‌های بعدی با @register_task ثبت می‌کنند
_TASK_REGISTRY: dict[str, list[Callable]] = {name: [] for name in QUEUES}


def register_task(queue_name: str) -> Callable:
    """دکوراتور ثبت یک کوروتین ARQ در صف مشخص."""
    if queue_name not in QUEUES:
        raise ValueError(f"unknown queue: {queue_name}")

    def decorator(fn: Callable) -> Callable:
        _TASK_REGISTRY[queue_name].append(fn)
        return fn

    return decorator


def tasks_for(queue_name: str) -> list[Callable]:
    return list(_TASK_REGISTRY[queue_name])


def get_arq_redis_settings() -> RedisSettings:
    """تنظیمات اتصال ARQ به Redis — از همان REDIS_URL مرکزی."""
    return RedisSettings.from_dsn(get_settings().redis_url)


def worker_settings_for(queue_name: str) -> dict[str, Any]:
    """ساخت dict تنظیمات WorkerSettings برای یک صف — ورودی app/worker.py."""
    if queue_name not in QUEUES:
        raise ValueError(f"unknown queue: {queue_name}")
    q = QUEUES[queue_name]
    return {
        "functions": tasks_for(queue_name),
        "redis_settings": get_arq_redis_settings(),
        "queue_name": queue_name,
        "max_jobs": q["max_jobs"],
        "max_tries": q["max_tries"],
        "job_timeout": q["job_timeout"],
    }
