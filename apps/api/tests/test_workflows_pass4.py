"""Remediation Pass 4 — static workflow guards (B1/B3/B5/B6/B7/B8).

Workflows cannot be executed in this sandbox (and the GitHub App
cannot push them — the owner uploads them via the web UI), so these
tests parse the YAML and lock the contracts that the Pass 4 fixes
establish. A future edit that reintroduces a hardcoded poll, drops
setup-java, or adds a SIGNING string the callback cannot map fails
here before it ever reaches a runner.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[3]


def _load(name: str) -> dict:
    return yaml.safe_load(
        (REPO / ".github" / "workflows" / name).read_text(encoding="utf-8")
    )


def _steps(job: dict) -> list[dict]:
    return job.get("steps") or []


def _find_step(job: dict, needle: str) -> dict | None:
    for step in _steps(job):
        run = step.get("run") or ""
        if needle in run:
            return step
    return None


def _mobile() -> dict:
    return _load("mobile.yml")


def _mobile_build_job() -> dict:
    return _mobile()["jobs"]["build"]


# ---------------------------------------------------------------- B1
def test_b1_every_signing_string_maps_to_cb_signed():
    """هر رشتهٔ SIGNINGای که گام validate می‌سازد باید در case
    گام callback به CB_SIGNED=true برسد، وگرنه بیلد امضاشده با
    signed=false ثبت می‌شود (باگ اصلی B1)."""
    data = _mobile()
    build = data["jobs"]["build"]
    validate = next(
        s for s in _steps(build) if s.get("id") == "validate"
    )
    signing_strings = re.findall(r'SIGNING="([^"]+)"', validate["run"])
    assert len(signing_strings) >= 3, signing_strings
    callback = _find_step(build, "build-callback.sh")
    assert callback is not None
    case_block = callback["run"]
    m = re.search(r"case \"\$SIGNING\" in(.*?)esac", case_block, re.DOTALL)
    assert m, "callback must map $SIGNING with a case statement"
    patterns = m.group(1)
    true_branch = re.search(r"([^;]+)\)\s*export CB_SIGNED=true", patterns)
    assert true_branch, "no CB_SIGNED=true branch in callback"
    true_patterns = true_branch.group(1)
    for s in signing_strings:
        # الگوی globای case باید رشته را بپوشاند: تبدیل سادهٔ glob به regex
        covered = any(
            re.fullmatch(
                re.escape(p).replace(r"\*", ".*").replace(r"\?", "."),
                s,
            )
            for p in true_patterns.split("|")
        )
        assert covered, (
            f"SIGNING string {s!r} is not mapped to CB_SIGNED=true "
            f"(patterns: {true_patterns.strip()})"
        )


# ---------------------------------------------------------------- B3
def test_b3_ci_docker_job_builds_all_three_images():
    docker = _load("ci.yml")["jobs"]["docker"]
    runs = "\n".join(s.get("run") or "" for s in _steps(docker))
    assert "docker build ./apps/api" in runs
    assert "docker build -f apps/web/Dockerfile" in runs
    assert "NEXT_PUBLIC_API_URL=" in runs
    assert "docker build -f apps/crm/Dockerfile" in runs
    assert "VITE_API_URL=" in runs


# ---------------------------------------------------------------- B5
def test_b5_eas_poll_ceiling_is_configurable_not_hardcoded():
    data = _mobile()
    build = _mobile_build_job()
    eas = next(s for s in _steps(build) if s.get("id") == "eas")
    assert "seq 1 55" not in eas["run"], "hardcoded 55-minute poll is back"
    assert "EAS_POLL_MINUTES" in eas["run"]
    assert "seq 1 \"$POLL_MIN\"" in eas["run"]
    assert "480" in eas["run"], "finite clamp must survive"
    # سقف از متغیر مخزن می‌آید چون workflow_dispatch حداکثر ۱۰ ورودی
    # دارد و این workflow از قبل ۱۰ ورودی دارد.
    # نکتهٔ YAML: کلید `on` با PyYAML به True پارس می‌شود.
    on_block = data.get("on") or data.get(True)
    assert len(on_block["workflow_dispatch"]["inputs"]) <= 10
    assert "EAS_POLL_MINUTES" in (eas.get("env") or {})


# ---------------------------------------------------------------- B6
def test_b6_setup_java_before_aab_validation():
    build = _mobile_build_job()
    steps = _steps(build)
    java_idx = next(
        i for i, s in enumerate(steps)
        if (s.get("uses") or "").startswith("actions/setup-java")
    )
    validate_idx = next(
        i for i, s in enumerate(steps) if s.get("id") == "validate"
    )
    assert java_idx < validate_idx
    java = steps[java_idx]
    assert java["with"]["distribution"] == "temurin"
    assert str(java["with"]["java-version"]) == "17"


# ---------------------------------------------------------------- B7
def test_b7_lint_workflows_job_exists_and_is_pinned():
    jobs = _load("ci.yml")["jobs"]
    assert "lint-workflows" in jobs
    runs = jobs["lint-workflows"]["steps"]
    actionlint = next(
        s for s in runs if "actionlint" in (s.get("uses") or "")
    )
    assert "1.7.7" in actionlint["uses"], "actionlint must be pinned"
    shellcheck = next(s for s in runs if "shellcheck" in (s.get("run") or ""))
    assert "tools/ci/*.sh" in shellcheck["run"]


# ---------------------------------------------------------------- B8
def test_b8_desktop_tag_must_match_embedded_version():
    resolve = _load("desktop.yml")["jobs"]["resolve"]
    meta = next(s for s in _steps(resolve) if s.get("id") == "meta")
    run = meta["run"]
    assert "META_VERSION" in run
    assert 'TAG_VERSION="${TAG#v}"' in run
    assert "does not match embedded" in run


def test_b8_mobile_release_tag_and_embedded_version_checked():
    build = _mobile_build_job()
    meta = next(s for s in _steps(build) if s.get("id") == "meta")
    assert "IN_RELEASE_TAG" in (meta.get("env") or {})
    assert "does not match this build's version" in meta["run"]
    validate = next(s for s in _steps(build) if s.get("id") == "validate")
    assert "WANT_VN" in (validate.get("env") or {})
    assert "versionName mismatch" in validate["run"]
