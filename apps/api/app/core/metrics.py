"""متریک‌های درون‌حافظه‌ای با خروجی متنی Prometheus (الگوی turbo، قرارداد §۱۱).

بدون وابستگی جدید: شمارندهٔ درخواست‌ها به‌تفکیک (متد، مسیر، وضعیت) + آپتایم.
مسیرها نرمال می‌شوند (UUID/عدد → ‎{id}‎) تا کاردینالیتی لیبل‌ها منفجر نشود —
یک قدم جلوتر از پیاده‌سازی مرجع.

این متریک مکمل OpenTelemetry است (tracing توزیع‌شده)، نه جایگزین آن.
"""
from __future__ import annotations

import re
import time
from collections import Counter

_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_INT_SEGMENT_RE = re.compile(r"/\d+(?=/|$)")


def normalize_path(path: str) -> str:
    """UUID و سگمنت‌های عددی را به ‎{id}‎ تبدیل می‌کند (کاهش کاردینالیتی)."""
    path = _UUID_RE.sub("{id}", path)
    return _INT_SEGMENT_RE.sub("/{id}", path)


class _Metrics:
    def __init__(self) -> None:
        self.counts: Counter[tuple[str, str, int]] = Counter()
        self.total_duration_ms = 0.0
        self.started_at = time.time()

    # وضعیت outbox (m-02): dispatcher هر دور این‌ها را تازه می‌کند تا
    # داشبورد صف‌ها و هشدار queue-lag روی دادهٔ واقعی سوار شوند.
    outbox_pending: int = 0
    outbox_oldest_age_s: float = 0.0
    outbox_dead_letter: int = 0

    def set_outbox_stats(self, pending: int, oldest_age_s: float, dead: int) -> None:
        self.outbox_pending = pending
        self.outbox_oldest_age_s = oldest_age_s
        self.outbox_dead_letter = dead

    def record(self, method: str, path: str, status: int, duration_ms: float) -> None:
        self.counts[(method, normalize_path(path), status)] += 1
        self.total_duration_ms += duration_ms

    def exposition(self) -> str:
        lines = [
            "# HELP http_requests_total Total HTTP requests",
            "# TYPE http_requests_total counter",
        ]
        for (method, path, status), count in sorted(self.counts.items()):
            lines.append(
                f'http_requests_total{{method="{method}",path="{path}",status="{status}"}} {count}'
            )
        total = sum(self.counts.values())
        avg = round(self.total_duration_ms / total, 2) if total else 0.0
        lines += [
            "# HELP http_request_duration_ms_avg Average request duration in ms",
            "# TYPE http_request_duration_ms_avg gauge",
            f"http_request_duration_ms_avg {avg}",
            "# HELP process_uptime_seconds Process uptime in seconds",
            "# TYPE process_uptime_seconds gauge",
            f"process_uptime_seconds {round(time.time() - self.started_at, 1)}",
            "# HELP outbox_pending_events Domain events waiting for dispatch",
            "# TYPE outbox_pending_events gauge",
            f"outbox_pending_events {self.outbox_pending}",
            "# HELP outbox_oldest_pending_age_seconds Age of the oldest undispatched event",
            "# TYPE outbox_oldest_pending_age_seconds gauge",
            f"outbox_oldest_pending_age_seconds {round(self.outbox_oldest_age_s, 1)}",
            "# HELP outbox_dead_letter_events Events that exhausted retries",
            "# TYPE outbox_dead_letter_events gauge",
            f"outbox_dead_letter_events {self.outbox_dead_letter}",
        ]
        return "\n".join(lines) + "\n"


METRICS = _Metrics()


def record_request(method: str, path: str, status: int, duration_ms: float) -> None:
    METRICS.record(method, path, status, duration_ms)
