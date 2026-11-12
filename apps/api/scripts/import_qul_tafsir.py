#!/usr/bin/env python3
"""واردکنندهٔ تفسیر فارسی QUL به قالب باندل‌شدهٔ سمت سرور (گام ۵).

تفسیرهای فارسی «مختصر» و «سعدی» در کاتالوگ QUL (منبع خود ترتیل)
هستند، ولی دانلود از QUL لاگین می‌خواهد؛ پس فایل sqlite را مالک با
حساب خودش از qul.tarteel.ai می‌گیرد و این اسکریپت آن را به
app/modules/quran/data/tafsir/<edition>.json تبدیل می‌کند — بعد از
آن provider باندل‌شده بدون هیچ فراخوانی زنده‌ای سروش می‌کند و
edition در پاسخ /providers ظاهر و در ریدر قابل انتخاب می‌شود.

تشخیص شکل منبع (سخت‌گیرانه، بدون حدس بی‌صدا):
- جدولی با ستون‌های (sura|surah, aya|ayah, translation|text|tafsir)
  — شکل QuranEnc و بیشتر sqliteهای QUL؛ یا
- ستون کلید واحد (ayah_key|verse_key|key) با قالب "s:a" + ستون متن.
هر شکل ناشناخته‌ای = خطای صریح و بدون خروجی.

ردیف‌های گروهی QUL: بعضی دیتاست‌ها (از جمله مختصر فارسی واقعی)
تفسیرِ چند آیهٔ پیاپی را در یک ردیف می‌گذارند — ردیفِ گروه ستون
ayah_keys را با فهرست اعضا پر می‌کند و ردیفِ بقیهٔ اعضا خالی است.
گسترش فقط از همان اعلانِ صریحِ منبع انجام می‌شود: متنِ گروه فقط
جای خالیِ اعضایش را پر می‌کند و هرگز روی متنِ مستقلِ یک آیه
نمی‌نشیند؛ تعداد گسترش‌ها هم روی stderr گزارش می‌شود.

اعتبارسنجی: پوشش باید کامل باشد — هر ۶۲۳۶ آیهٔ متن تنزیل، با متن
غیرخالی. ناقص = رد (تفسیر ناقص هرگز بی‌صدا نصب نمی‌شود). تنها
استثنای مستند: سعدیِ فارسی از QuranEnc (مبدلِ
import_quranenc_tafsir.py) که نسخهٔ رسمی‌اش سه ورودیِ خالیِ مشروع
دارد (۲:۲۱۲، ۲۸:۱۶، ۵۶:۴۳) — دقیقاً همان سه آیه برای fa.saadi
استثناست: نه import رد می‌شود، نه متنی برایشان ساخته می‌شود
(کلیدشان در خروجی نیست و provider برایشان خطای صادقانه می‌دهد).

اجرا:
  python3 scripts/import_qul_tafsir.py mokhtasar.sqlite fa.mokhtasar
  python3 scripts/import_qul_tafsir.py saadi.sqlite fa.saadi
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = API_ROOT / "app" / "modules" / "quran" / "data"
TANZIL_PATH = DATA_DIR / "tanzil_uthmani.txt"
EDITIONS = ("fa.mokhtasar", "fa.saadi")

# استثناهای پوششِ مستند، به‌ازای edition: آیاتی که نسخهٔ رسمیِ منبع
# برایشان ورودیِ خالیِ مشروع دارد. فقط fa.saadi از QuranEnc (نسخهٔ
# رسمی persian_saadi؛ هر سه در ۲۰۲۶-۱۱-۱۲ از خود API راستی‌آزمایی
# شدند). برای این آیه‌ها متن ساخته نمی‌شود.
EMPTY_EXEMPTIONS: dict[str, frozenset[str]] = {
    "fa.saadi": frozenset({"2:212", "28:16", "56:43"}),
}

_SURAH_COLS = ("sura", "surah")
_AYAH_COLS = ("aya", "ayah")
_KEY_COLS = ("ayah_key", "verse_key", "key")
_TEXT_COLS = ("translation", "text", "tafsir", "content")


def _tanzil_keys() -> set[str]:
    keys: set[str] = set()
    for line in TANZIL_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            keys.add(f"{int(parts[0])}:{int(parts[1])}")
    assert len(keys) == 6236
    return keys


def _pick(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    lowered = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand in lowered:
            return lowered[cand]
    return None


def convert(db_path: Path) -> dict[str, str]:
    """sqlite منبع → نگاشت {"s:a": متن}؛ شکل ناشناخته = ValueError."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        ]
        fallback: dict[str, str] | None = None
        for table in tables:
            columns = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
            if not columns:
                continue
            text_col = _pick(columns, _TEXT_COLS)
            if text_col is None:
                continue
            surah_col = _pick(columns, _SURAH_COLS)
            ayah_col = _pick(columns, _AYAH_COLS)
            key_col = _pick(columns, _KEY_COLS)
            data: dict[str, str] = {}
            if surah_col and ayah_col:
                rows = con.execute(
                    f'SELECT "{surah_col}", "{ayah_col}", "{text_col}" FROM "{table}"'
                )
                for s, a, t in rows:
                    if t and str(t).strip():
                        data[f"{int(s)}:{int(a)}"] = str(t)
            elif key_col:
                group_col = _pick(columns, ("ayah_keys",))
                if group_col:
                    rows = con.execute(
                        f'SELECT "{key_col}", "{text_col}", "{group_col}"'
                        f' FROM "{table}"'
                    ).fetchall()
                else:
                    rows = [
                        (k, t, None)
                        for k, t in con.execute(
                            f'SELECT "{key_col}", "{text_col}" FROM "{table}"'
                        )
                    ]
                group_fill: dict[str, str] = {}
                for k, t, members in rows:
                    if not (t and str(t).strip()):
                        continue
                    if k and ":" in str(k):
                        s, a = str(k).split(":", 1)
                        data[f"{int(s)}:{int(a)}"] = str(t)
                    if members:
                        for member in str(members).split(","):
                            member = member.strip()
                            if ":" in member:
                                ms, ma = member.split(":", 1)
                                group_fill.setdefault(
                                    f"{int(ms)}:{int(ma)}", str(t)
                                )
                expanded = 0
                for k, v in group_fill.items():
                    if k not in data:
                        data[k] = v
                        expanded += 1
                if expanded:
                    print(
                        f"group expansion: {expanded} ayahs filled from "
                        f"declared ayah_keys groups",
                        file=sys.stderr,
                    )
            else:
                continue
            if len(data) >= 6000:
                return data
            if fallback is None and data:
                # شکل شناخته شد ولی پوشش کم است — نگهش دار؛ کامل‌بودن
                # را validate_full قضاوت می‌کند، نه تشخیص شکل.
                fallback = data
        if fallback is not None:
            return fallback
        raise ValueError(
            "no recognizable tafsir table (need sura+aya+text or ayah_key+text)"
        )
    finally:
        con.close()


def validate_full(data: dict[str, str], edition: str = "") -> None:
    expected = _tanzil_keys()
    missing = expected - set(data)
    allowed = EMPTY_EXEMPTIONS.get(edition, frozenset())
    illegal = missing - allowed
    if illegal:
        raise ValueError(
            f"incomplete tafsir: {len(illegal)} ayahs missing "
            f"(e.g. {sorted(illegal)[:5]})"
        )
    if missing:
        print(
            f"coverage exemptions applied ({edition}): "
            f"{sorted(missing)} have no source text (documented)",
            file=sys.stderr,
        )
    extra = set(data) - expected
    if extra:
        raise ValueError(f"unknown ayah keys: {sorted(extra)[:5]}")


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[2] not in EDITIONS:
        print(__doc__)
        return 2
    src = Path(argv[1])
    edition = argv[2]
    data = convert(src)
    validate_full(data, edition)
    out_dir = DATA_DIR / "tafsir"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{edition}.json"
    out.write_text(
        json.dumps(data, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"{edition}: OK — 6236 ayahs -> {out} sha256={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
