#!/usr/bin/env python3
"""Ruff baseline gate — آکادمی ماتریدی.

بدهی لینت قدیمی (قبل از پین‌کردن ruff) در tools/ruff_baseline.json به‌صورت
شمارش per (file, rule) ثبت شده است. این اسکریپت ruff را با همان نسخهٔ
پین‌شده (apps/api/requirements.txt: ruff==0.17.1) اجرا می‌کند و:

- هر افزایش شمارش در یک (file, rule) یا هر (file, rule) جدید → FAIL
- کاهش شمارش → PASS با پیام «baseline را regenerate کن» (بدهی کمتر شده)
- برابر → PASS

هیچ suppressionای وجود ندارد: baseline فقط سقف مجاز فعلی است، نه ignore.
بازسازی baseline (فقط وقتی عمداً بدهی کم/زیاد شد و در commit توضیح دارد):
    python3 tools/check_ruff_baseline.py --update
"""
import json
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = Path(__file__).resolve().parent / "ruff_baseline.json"
TARGET = "apps/api"


def find_ruff() -> list[str]:
    venv_ruff = REPO_ROOT / "apps/api/.venv/bin/ruff"
    if venv_ruff.exists():
        return [str(venv_ruff)]
    if shutil.which("ruff"):
        return ["ruff"]
    return [sys.executable, "-m", "ruff"]


def current_counts() -> Counter:
    cmd = find_ruff() + ["check", TARGET, "--output-format", "json"]
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    # ruff exit=1 یعنی خطا پیدا شده — خروجی JSON همچنان معتبر است.
    try:
        findings = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        raise SystemExit("ruff خروجی JSON نداد — نسخهٔ ruff را بررسی کن (پین: 0.17.1)")
    counts: Counter = Counter()
    for f in findings:
        rel = str(Path(f["filename"]).relative_to(REPO_ROOT))
        counts[(rel, f["code"])] += 1
    return counts


def load_baseline() -> Counter:
    data = json.loads(BASELINE_PATH.read_text())
    return Counter({(k.rsplit("::", 1)[0], k.rsplit("::", 1)[1]): v for k, v in data["counts"].items()})


def write_baseline(counts: Counter) -> None:
    data = {
        "ruff_version": "0.17.1",
        "target": TARGET,
        "total": sum(counts.values()),
        "counts": {f"{f}::{r}": n for (f, r), n in sorted(counts.items())},
    }
    BASELINE_PATH.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")


def main() -> int:
    counts = current_counts()
    if "--update" in sys.argv:
        write_baseline(counts)
        print(f"baseline بازسازی شد: {sum(counts.values())} خطا در {len(counts)} جفت (file, rule)")
        return 0

    baseline = load_baseline()
    increased = {k: (baseline.get(k, 0), v) for k, v in counts.items() if v > baseline.get(k, 0)}
    decreased = {k: (n, counts.get(k, 0)) for k, n in baseline.items() if counts.get(k, 0) < n}

    if increased:
        print("FAIL — خطاهای ruff نسبت به baseline افزایش یافته‌اند:")
        for (f, r), (old, new) in sorted(increased.items()):
            print(f"  {f} [{r}]: {old} -> {new}")
        print("رفع کنید، یا اگر افزایش عمدی است با توضیح در commit، baseline را --update کنید.")
        return 1
    total = sum(counts.values())
    base_total = sum(baseline.values())
    if decreased:
        print(f"PASS — بدون افزایش؛ بدهی از {base_total} به {total} کم شده است.")
        print("baseline را با --update بازسازی کنید تا سقف جدید ثبت شود:")
        for (f, r), (old, new) in sorted(decreased.items()):
            print(f"  {f} [{r}]: {old} -> {new}")
        return 0
    print(f"PASS — دقیقاً روی baseline ({total} خطای شناخته‌شده، بدون افزایش).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
