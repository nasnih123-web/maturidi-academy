"""نقطهٔ ورود ورکرهای ARQ — فاز ۲.

اجرا:
    python -m app.worker <queue>     # مثلاً: python -m app.worker critical

هر صف ورکر جداگانه می‌خواهد (concurrency/retry جدا طبق قرارداد §۵).
اجرای واقعی ورکرها (systemd/docker compose) عملیات فاز ۲+ است؛
این فایل رجیستری + entrypoint است.
"""
from __future__ import annotations

import sys

from arq import run_worker

from app.core.queues import QUEUES, worker_settings_for


def _make_settings_class(queue_name: str) -> type:
    cfg = worker_settings_for(queue_name)

    class WorkerSettings:
        functions = cfg["functions"]
        redis_settings = cfg["redis_settings"]
        queue_name = cfg["queue_name"]
        max_jobs = cfg["max_jobs"]
        max_tries = cfg["max_tries"]
        job_timeout = cfg["job_timeout"]

    WorkerSettings.__name__ = f"{queue_name.capitalize()}WorkerSettings"
    return WorkerSettings


def main(argv: list[str] | None = None) -> None:
    args = argv if argv is not None else sys.argv[1:]
    queue_name = args[0] if args else "critical"
    if queue_name not in QUEUES:
        print(f"unknown queue: {queue_name} (available: {', '.join(QUEUES)})", file=sys.stderr)
        sys.exit(2)
    run_worker(_make_settings_class(queue_name))


if __name__ == "__main__":
    main()
