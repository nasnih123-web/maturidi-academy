"""Remediation Pass 4 — B4: worker settings coverage for all six queues.

Before Pass 4, docker-compose.prod.yml defined six workers
(worker-critical/ai/media/telegram/notifications/analytics) but no CI
step ever constructed their settings: a typo in a queue name, a
missing task registration, or a broken entrypoint would only surface
at deploy time. These tests run inside the backend CI job (full pytest
suite), so they are CI coverage:

- The compose worker commands and the QUEUES registry agree exactly.
- worker_settings_for + the app.worker settings class build for every
  queue, with the registry's concurrency/retry/timeout values.
- The media worker carries its media-tools startup gate; others don't.
- An unknown queue exits 2 (worker.main) and raises from
  worker_settings_for — never a silent default worker.

Scope note (honest): this proves settings construction, not a live
boot against Redis — the backend CI job has no Redis service, and a
real `arq run_worker` boot is still only exercised by compose at
deploy time. That residual is stated, not hidden.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.core.queues import QUEUES, worker_settings_for
from app.worker import _make_settings_class, main

REPO = Path(__file__).resolve().parents[3]
EXPECTED_QUEUES = {
    "critical", "ai", "media", "telegram", "notifications", "analytics",
}


def _compose_worker_queues() -> set[str]:
    data = yaml.safe_load(
        (REPO / "docker-compose.prod.yml").read_text(encoding="utf-8")
    )
    queues = set()
    for name, svc in (data.get("services") or {}).items():
        if not name.startswith("worker-"):
            continue
        cmd = (svc or {}).get("command") or []
        assert cmd[:3] == ["python", "-m", "app.worker"], (
            f"{name}: unexpected worker command {cmd}"
        )
        queues.add(cmd[3])
    return queues


def test_b4_compose_workers_match_registry():
    assert _compose_worker_queues() == EXPECTED_QUEUES
    assert set(QUEUES) == EXPECTED_QUEUES


@pytest.mark.parametrize("queue", sorted(EXPECTED_QUEUES))
def test_b4_settings_build_for_every_queue(queue):
    cfg = worker_settings_for(queue)
    assert cfg["queue_name"] == queue
    assert cfg["max_jobs"] == QUEUES[queue]["max_jobs"]
    assert cfg["max_tries"] == QUEUES[queue]["max_tries"]
    assert cfg["job_timeout"] == QUEUES[queue]["job_timeout"]
    assert isinstance(cfg["functions"], list)
    assert cfg["redis_settings"] is not None
    cls = _make_settings_class(queue)
    assert cls.queue_name == queue
    assert cls.max_jobs == QUEUES[queue]["max_jobs"]
    if queue == "media":
        assert hasattr(cls, "on_startup")
    else:
        assert not hasattr(cls, "on_startup")


def test_b4_unknown_queue_is_rejected():
    with pytest.raises(ValueError, match="unknown queue"):
        worker_settings_for("nope")
    with pytest.raises(SystemExit) as excinfo:
        main(["nope"])
    assert excinfo.value.code == 2
