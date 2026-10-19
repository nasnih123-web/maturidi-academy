"""تست‌های فاز ۱۷ (Track 2) — دسترس‌پذیری خودکار با axe-core.

خط لولهٔ مستند در apps/web/scripts/a11y/run.mjs:
next start (بیلد production) + API موقت → curl SSR → mirror دارایی‌های _next →
Chromium (CDP) روی file:// + تزریق axe-core → گزارش violations.

آستانه: صفر تخلف Critical. Serious/Moderate/Minor در گزارش ثبت و در
docs/testing/a11y-phase17.md مستند می‌شوند.

اگر chrome/node/بیلد وب در محیط موجود نباشد، تست با دلیل صریح skip می‌شود
(محدودیت محیطی، نه پنهان‌کردن خطا).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
WEB = os.path.join(REPO, "apps", "web")
RUN_MJS = os.path.join(WEB, "scripts", "a11y", "run.mjs")
CHROME = os.environ.get("CHROME_BIN", "/opt/meta-chromium/chrome")


def _skip_reason() -> str | None:
    if shutil.which("node") is None:
        return "node در محیط موجود نیست"
    if not (os.path.isfile(CHROME) and os.access(CHROME, os.X_OK)):
        return f"Chromium در {CHROME} موجود نیست"
    if not os.path.isfile(os.path.join(WEB, ".next", "BUILD_ID")):
        return "بیلد production وب موجود نیست (next build اجرا نشده)"
    if not os.path.isfile(os.path.join(WEB, "node_modules", "axe-core", "axe.min.js")):
        return "axe-core در node_modules وب نصب نیست"
    if not os.path.isfile(os.path.join(REPO, "apps", "api", ".venv", "bin", "python")):
        return "venv بک‌اند موجود نیست"
    return None


def test_axe_no_critical_violations(tmp_path):
    reason = _skip_reason()
    if reason:
        pytest.skip(f"a11y pipeline unavailable: {reason}")

    out = tmp_path / "a11y"
    out.mkdir()
    env = dict(os.environ, CHROME_BIN=CHROME)
    # پورت‌های جدا تا با اجراهای موازی تداخل نکند
    env["P17_A11Y_API_PORT"] = "18082"
    env["P17_A11Y_WEB_PORT"] = "13102"
    proc = subprocess.run(
        ["node", RUN_MJS, "--repo", REPO, "--out", str(out)],
        capture_output=True, text=True, timeout=900, env=env, cwd=WEB,
    )
    print(proc.stdout[-4000:])
    if proc.returncode == 3:
        pytest.fail(f"a11y infra failure:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}")
    assert proc.returncode in (0, 2), (
        f"a11y run failed rc={proc.returncode}\n{proc.stderr[-2000:]}"
    )

    summary_path = out / "summary.json"
    assert summary_path.is_file(), "summary.json ساخته نشد"
    summary = json.loads(summary_path.read_text())

    print("A11Y SUMMARY:", json.dumps(summary["totals"], ensure_ascii=False))
    for slug, page in summary["pages"].items():
        print(f"  {slug}: {page['violations']} violations "
              f"({', '.join(page['rules']) or 'none'})")

    criticals = [
        (slug, rule)
        for slug, page in summary["pages"].items()
        for rule in page["rules"]
        if rule.startswith("critical:")
    ]
    assert not criticals, f"Critical a11y violations: {criticals}"
