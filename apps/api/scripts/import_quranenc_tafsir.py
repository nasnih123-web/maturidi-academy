#!/usr/bin/env python3
"""مبدل تفسیر سعدیِ فارسی از QuranEnc به قالب باندل‌شده (گام ۷ توسعه).

چرا این مبدل لازم شد: در کاتالوگ دانلودی QUL سعدیِ فارسی نیست (در
متادیتای quranlab/quran-tafsir ستون‌های QUL برای `tafsir-saadi-fa`
خالی‌اند؛ فایل‌های تحویلی مالک هم راستی‌آزمایی شدند: `sq-saadi`
آلبانیایی و `tafsir-as-saadi` عربیِ اصل است و `persian_ih.pdf`
ترجمهٔ رواد بود، نه سعدی). تنها منبع رسمی سعدیِ فارسی، QuranEnc
است — کلید `persian_saadi`، API عمومی بدون لاگین:
  https://quranenc.com/api/v1/translation/sura/persian_saadi/{n}

روند: هر ۱۱۴ سوره از API گرفته می‌شود، در sqliteای با شکل خود
QuranEnc (جدول translations: sura, aya, translation — همان شکل
دانلودهای sqlite رسمی‌اش) می‌نشیند و بعد دقیقاً از همان مسیر
import_qul_tafsir.py عبور می‌کند (تشخیص شکل + اعتبارسنجی سخت‌گیرانه)
تا فقط یک مسیر نصب وجود داشته باشد. پانویس‌های منبع حمل نمی‌شوند
(ریدر UI پانویس ندارد؛ همان انتخاب مستند مولد گام ۵).

استثنای پوشش: نسخهٔ رسمی QuranEnc سه ورودیِ خالیِ مشروع دارد —
۲:۲۱۲، ۲۸:۱۶، ۵۶:۴۳ (هر سه ۲۰۲۶-۱۱-۱۲ از خود API راستی‌آزمایی
شدند: translation خالی، همسایه‌ها پر). این اسکریپت مجموعهٔ خالی‌های
واقعی منبع را با همان سه‌تای مستند مقایسه می‌کند؛ هر انحرافی =
توقف، بدون خروجی. متن برای آن سه آیه ساخته نمی‌شود: کلیدشان در
fa.saadi.json نیست و provider برایشان خطای صادقانه می‌دهد.

اجرا: python3 scripts/import_quranenc_tafsir.py
خروجی: app/modules/quran/data/tafsir/fa.saadi.json (۶۲۳۳ آیه)
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = API_ROOT / "app" / "modules" / "quran" / "data"
TANZIL_PATH = DATA_DIR / "tanzil_uthmani.txt"
OUT_PATH = DATA_DIR / "tafsir" / "fa.saadi.json"

API = "https://quranenc.com/api/v1/translation/sura/persian_saadi/{n}"
EXPECTED_EMPTY = {"2:212", "28:16", "56:43"}


def _load_importer():
    spec = importlib.util.spec_from_file_location(
        "import_qul_tafsir", Path(__file__).with_name("import_qul_tafsir.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tanzil_counts() -> dict[int, int]:
    counts: dict[int, int] = {}
    for line in TANZIL_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            counts[int(parts[0])] = counts.get(int(parts[0]), 0) + 1
    assert len(counts) == 114 and sum(counts.values()) == 6236, counts
    return counts


def _fetch(surah: int) -> list[dict]:
    url = API.format(n=surah)
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "maturidi-importer"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read())
            rows = body.get("result")
            if not isinstance(rows, list) or not rows:
                raise SystemExit(f"persian_saadi: bad payload for surah {surah}")
            return rows
        except Exception as exc:  # noqa: BLE001 (تلاش دوبارهٔ شبکه)
            last_exc = exc
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"persian_saadi: fetch failed for surah {surah}: {last_exc}")


def main() -> int:
    counts = _tanzil_counts()
    rows: list[tuple[int, int, str]] = []
    empty: set[str] = set()
    for surah in range(1, 115):
        payload = _fetch(surah)
        if len(payload) != counts[surah]:
            raise SystemExit(
                f"persian_saadi: surah {surah} has {len(payload)} rows, "
                f"Tanzil expects {counts[surah]}"
            )
        for row in payload:
            s, a = int(row["sura"]), int(row["aya"])
            if s != surah:
                raise SystemExit(
                    f"persian_saadi: row sura mismatch ({s} in surah {surah})"
                )
            text = row.get("translation") or ""
            rows.append((s, a, text))
            if not str(text).strip():
                empty.add(f"{s}:{a}")
        if surah % 25 == 0:
            print(f"  fetched {surah}/114 surahs", file=sys.stderr)
    if len(rows) != 6236:
        raise SystemExit(f"persian_saadi: expected 6236 rows, got {len(rows)}")
    if empty != EXPECTED_EMPTY:
        raise SystemExit(
            f"persian_saadi: empty set differs from the documented "
            f"exemptions: extra={sorted(empty - EXPECTED_EMPTY)} "
            f"missing={sorted(EXPECTED_EMPTY - empty)}"
        )
    print(
        f"source OK: 6236 rows, empties exactly the documented "
        f"{sorted(EXPECTED_EMPTY)}",
        file=sys.stderr,
    )

    importer = _load_importer()
    with tempfile.NamedTemporaryFile(suffix=".sqlite") as tmp:
        con = sqlite3.connect(tmp.name)
        con.execute(
            "CREATE TABLE translations (sura INT, aya INT, translation TEXT)"
        )
        con.executemany("INSERT INTO translations VALUES (?, ?, ?)", rows)
        con.commit()
        con.close()
        data = importer.convert(Path(tmp.name))
    importer.validate_full(data, "fa.saadi")
    assert len(data) == 6233, len(data)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(data, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )
    digest = hashlib.sha256(OUT_PATH.read_bytes()).hexdigest()
    print(
        f"fa.saadi: OK — 6233 ayahs (3 documented source exemptions) "
        f"-> {OUT_PATH} sha256={digest}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
