#!/usr/bin/env python3
"""مولد دو ترجمهٔ فارسیِ ترتیل (رواد و تاجی) برای provider باندل‌شده.

گام ۵ برابری با ترتیل (PR ایجنت دوم): ترتیل دقیقاً دو ترجمهٔ فارسی
دارد — «رواد» (مرکز ترجمهٔ رواد، کلید QuranEnc: persian_ih) و
«دکتر حسین تاجی» (persian_tagi) — و هیچ‌کدام در فهرست ۱۳ ترجمهٔ
AlQuran Cloud آکادمی نبودند. هر دو از QuranEnc (موسوعة القرآن
الكريم) گرفته می‌شوند که ناشر عمومی و بدون لاگینِ هر دو است:

- رواد: فایل sqlite رسمی QuranEnc
  (https://quranenc.com/downloads/sqlite/persian_ih.sqlite)
- تاجی: sqlite منتشر نشده؛ از API عمومی همان منبع، سوره‌به‌سوره
  (https://quranenc.com/api/v1/translation/sura/persian_tagi/{n})

خروجی: دو فایل JSON در app/modules/quran/data/ با قالب
{"1:1": "متن", ...} — همان قرارداد دادهٔ سمت سرورِ متن تنزیل.
اعتبارسنجی سخت‌گیرانه: پوشش کامل ۶۲۳۶ آیه و شمارش هر سوره دقیقاً
برابر فایل تنزیل خود ریپو؛ هر انحرافی = خروج با خطا، بدون خروجی.
پانویس‌های منبع حمل نمی‌شوند (ریدر UI پانویس ندارد)؛ متن خالی یا
ناقص هم پذیرفته نیست.

اجرا: python3 scripts/generate_quran_fa_translations.py
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import tempfile
import urllib.request
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = API_ROOT / "app" / "modules" / "quran" / "data"
TANZIL_PATH = DATA_DIR / "tanzil_uthmani.txt"

ROWWAD_SQLITE_URL = "https://quranenc.com/downloads/sqlite/persian_ih.sqlite"
TAGI_API = "https://quranenc.com/api/v1/translation/sura/persian_tagi/{n}"


def _tanzil_counts() -> dict[int, int]:
    counts: dict[int, int] = {}
    for line in TANZIL_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            counts[int(parts[0])] = counts.get(int(parts[0]), 0) + 1
    assert len(counts) == 114 and sum(counts.values()) == 6236, counts
    return counts


def _validate(data: dict[str, str], counts: dict[int, int], label: str) -> None:
    if len(data) != 6236:
        raise SystemExit(f"{label}: expected 6236 ayahs, got {len(data)}")
    per_surah: dict[int, int] = {}
    for key, text in data.items():
        surah_s, _ = key.split(":")
        per_surah[int(surah_s)] = per_surah.get(int(surah_s), 0) + 1
        if not text.strip():
            raise SystemExit(f"{label}: empty text at {key}")
    if per_surah != counts:
        raise SystemExit(f"{label}: per-surah counts differ from Tanzil")


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "maturidi-generator"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _rowwad() -> dict[str, str]:
    raw = _fetch(ROWWAD_SQLITE_URL)
    print(f"rowwad sqlite: {len(raw)} bytes sha256={hashlib.sha256(raw).hexdigest()}")
    with tempfile.NamedTemporaryFile(suffix=".sqlite") as tmp:
        tmp.write(raw)
        tmp.flush()
        con = sqlite3.connect(tmp.name)
        rows = con.execute(
            "SELECT sura, aya, translation FROM translations"
        ).fetchall()
        con.close()
    return {f"{s}:{a}": t for s, a, t in rows}


def _taji() -> dict[str, str]:
    data: dict[str, str] = {}
    for surah in range(1, 115):
        body = json.loads(_fetch(TAGI_API.format(n=surah)))
        rows = body.get("result")
        if not isinstance(rows, list) or not rows:
            raise SystemExit(f"taji: bad payload for surah {surah}")
        for row in rows:
            data[f"{int(row['sura'])}:{int(row['aya'])}"] = row["translation"]
    return data


def main() -> int:
    counts = _tanzil_counts()
    for label, loader, out_name in (
        ("fa.rowwad (QuranEnc persian_ih)", _rowwad, "fa_rowwad.json"),
        ("fa.taji (QuranEnc persian_tagi)", _taji, "fa_taji.json"),
    ):
        data = loader()
        _validate(data, counts, label)
        out = DATA_DIR / out_name
        out.write_text(
            json.dumps(data, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        print(f"{label}: OK — 6236 ayahs -> {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
