"""نگهبان استاتیک کالبک بیلد (FIX2-01، ادامهٔ B-01/ADR-0025).

باگ: در mobile.yml جاب build مقدار defaults.run.working-directory برابر
apps/mobile دارد، پس `bash tools/ci/build-callback.sh` و
`CB_ARTIFACT_DIR: apps/mobile/release-assets` هر دو نسبت به apps/mobile
resolve می‌شدند و کالبک هرگز به اسکریپت/آرتیفکت نمی‌رسید. الگوی درستِ
desktop.yml: مسیر مطلق اسکریپت با $GITHUB_WORKSPACE و CB_ARTIFACT_DIR
نسبت به working-directory جاب.

این تست‌ها هر دو workflow را parse می‌کنند و همان قرارداد را قفل می‌کنند
تا رگرسیون مسیر نسبی برنگردد. اجرای واقعی workflow (آپلود MinIO + ثبت
رلیز) به Secret/حساب مالک وابسته است و این‌جا ادعا نمی‌شود.
"""
from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

import yaml

REPO = Path(__file__).resolve().parents[3]

# workflow → (دایرکتوری آرتیفکتِ واقعی نسبت به ریشهٔ ریپو)
# مسیر تولید آرتیفکت در همان workflowها: upload-artifact از
# apps/<app>/release-assets می‌خواند.
EXPECTED_ARTIFACT_DIR = {
    "mobile.yml": "apps/mobile/release-assets",
    "desktop.yml": "apps/desktop/release-assets",
}


def _callback_steps(workflow_name: str):
    """(job, step)هایی که اسکریپت کالبک بیلد را صدا می‌زنند."""
    data = yaml.safe_load(
        (REPO / ".github" / "workflows" / workflow_name).read_text(encoding="utf-8")
    )
    found = []
    for job_name, job in (data.get("jobs") or {}).items():
        for step in job.get("steps") or []:
            run = step.get("run") or ""
            if "build-callback.sh" in run:
                found.append((job_name, job, step))
    return data, found


def test_callback_script_exists() -> None:
    assert (REPO / "tools" / "ci" / "build-callback.sh").is_file()


def test_callback_invoked_via_github_workspace_absolute_path() -> None:
    for name in EXPECTED_ARTIFACT_DIR:
        _, found = _callback_steps(name)
        assert found, f"{name}: هیچ گام کالبکی پیدا نشد"
        for job_name, _job, step in found:
            run = step["run"]
            assert re.search(
                r'bash\s+"\$GITHUB_WORKSPACE/tools/ci/build-callback\.sh"', run
            ), f"{name}:{job_name} — اسکریپت باید با مسیر مطلق $GITHUB_WORKSPACE صدا زده شود"
            assert not re.search(r"(?:^|\s)bash\s+tools/ci/", run), (
                f"{name}:{job_name} — فراخوانی با مسیر نسبی ممنوع است "
                "(working-directory جاب آن را خراب می‌کند)"
            )


def test_cb_artifact_dir_resolves_to_real_artifact_location() -> None:
    for name, expected in EXPECTED_ARTIFACT_DIR.items():
        data, found = _callback_steps(name)
        assert found, f"{name}: هیچ گام کالبکی پیدا نشد"
        for job_name, job, step in found:
            env = step.get("env") or {}
            cb_dir = env.get("CB_ARTIFACT_DIR")
            assert cb_dir, f"{name}:{job_name} — CB_ARTIFACT_DIR تعریف نشده"
            assert not PurePosixPath(cb_dir).is_absolute(), (
                f"{name}:{job_name} — CB_ARTIFACT_DIR نباید مطلق باشد؛ "
                "نسبت به working-directory جاب resolve می‌شود"
            )
            # working-directory مؤثر جاب: اول defaults جاب، بعد defaults سراسری
            wd = (
                ((job.get("defaults") or {}).get("run") or {}).get("working-directory")
                or ((data.get("defaults") or {}).get("run") or {}).get(
                    "working-directory"
                )
                or "."
            )
            resolved = PurePosixPath(wd) / cb_dir
            parts: list[str] = []
            for part in resolved.parts:
                if part == "..":
                    parts.pop()
                elif part != ".":
                    parts.append(part)
            normalized = str(PurePosixPath(*parts))
            assert normalized == expected, (
                f"{name}:{job_name} — CB_ARTIFACT_DIR={cb_dir!r} با "
                f"working-directory={wd!r} به {normalized!r} می‌رسد، "
                f"نه {expected!r} (جای واقعی آرتیفکت‌ها)"
            )
