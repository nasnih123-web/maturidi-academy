"""FIX2-09 — نگهبان استاتیک پوشش CI موبایل و دسکتاپ.

قراردادهایی که این تست قفل می‌کند:
- ci.yml یک job `mobile` دارد: working-directory روی apps/mobile،
  npm ci از lockfile خودش، typecheck و چک headless کانفیگ Expo.
- desktop.yml یک job `verify-unsigned` دارد که روی pull_request
  (با paths دسکتاپ) و workflow_dispatch قابل‌اجراست، روی هر سه OS
  بیلد واقعی Tauri می‌گیرد و هیچ secretی نمی‌خواند — نبود secret
  امضا نباید جلوی بیلد بدون امضا را بگیرد.
- jobهای release دسکتاپ (resolve/build) روی pull_request اجرا
  نمی‌شوند.

اجرای واقعی این jobها روی GitHub فقط بعد از آپلود workflowها توسط
مالک ممکن است؛ این تست فقط قرارداد فایل‌ها را قفل می‌کند.
"""
from __future__ import annotations

from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[3]


def _load(name: str) -> dict:
    return yaml.safe_load(
        (REPO / ".github" / "workflows" / name).read_text(encoding="utf-8")
    )


def _triggers(data: dict) -> dict:
    # PyYAML (YAML 1.1) کلید `on` را به True بولی تبدیل می‌کند
    return data.get("on") or data.get(True) or {}


def _run_lines(job: dict) -> list[str]:
    lines: list[str] = []
    for step in job.get("steps") or []:
        run = step.get("run") or ""
        lines.extend(run.splitlines())
    return [line.strip() for line in lines]


def test_ci_has_mobile_job_with_lockfile_typecheck_and_expo_config():
    data = _load("ci.yml")
    jobs = data.get("jobs") or {}
    assert "mobile" in jobs, "job موبایل در ci.yml نیست"
    job = jobs["mobile"]
    assert job["defaults"]["run"]["working-directory"] == "apps/mobile"
    runs = _run_lines(job)
    assert "npm ci" in runs
    assert "npm run typecheck" in runs
    assert any("expo config" in line for line in runs)
    setup = next(
        s for s in job["steps"] if str(s.get("uses", "")).startswith("actions/setup-node")
    )
    assert setup["with"]["cache-dependency-path"] == "apps/mobile/package-lock.json"


def test_ci_compose_smoke_scope_is_documented():
    text = (REPO / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "FIX2-10" in text
    smoke_py = (REPO / "tools" / "ci" / "compose_smoke.py").read_text(encoding="utf-8")
    assert "EICAR" in smoke_py and "file_infected" in smoke_py


def test_desktop_verify_unsigned_job_is_secret_free_and_pr_triggered():
    data = _load("desktop.yml")
    triggers = _triggers(data)
    pr = triggers.get("pull_request") or {}
    assert "apps/desktop/**" in (pr.get("paths") or [])

    jobs = data.get("jobs") or {}
    assert "verify-unsigned" in jobs
    job = jobs["verify-unsigned"]
    condition = str(job.get("if") or "")
    assert "pull_request" in condition

    runs = _run_lines(job)
    assert "npm ci" in runs
    assert any("tauri build" in line for line in runs)
    # ماتریس هر سه OS هدف
    oses = {
        entry.get("os")
        for entry in (job.get("strategy") or {}).get("matrix", {}).get("include", [])
    }
    assert oses == {"windows-latest", "macos-latest", "ubuntu-latest"}
    # هیچ secreتی در این job خوانده نمی‌شود (متن خام job را می‌گردیم)
    import io

    buf = io.StringIO()
    yaml.safe_dump(job, buf)
    assert "secrets." not in buf.getvalue()


def test_desktop_release_jobs_never_run_on_pull_request():
    data = _load("desktop.yml")
    jobs = data.get("jobs") or {}
    for name in ("resolve", "build"):
        condition = str((jobs.get(name) or {}).get("if") or "")
        assert "pull_request" in condition and "!=" in condition, (
            f"job {name} باید صریحاً روی pull_request غیرفعال باشد"
        )
