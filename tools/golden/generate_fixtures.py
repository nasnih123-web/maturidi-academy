#!/usr/bin/env python3
"""Golden-fixture generator for the source-derived calculator tests.

Runs tools/golden/harness.js (Node) against the ORIGINAL page scripts —
fetched 2026-10-21 from dl.ghadimyol.ir over plain HTTP (HTTPS failed),
kept outside the repo in ~/workspace/.calc-sources — and normalizes their
outputs into the structured fixtures consumed by
apps/api/tests/test_calculators_source_golden.py.

The source HTML files are NEVER committed; this generator records their
SHA-256 hashes in every fixture file for provenance.

Usage:
    CALC_SOURCES_DIR=~/workspace/.calc-sources \
    CASES_DIR=<dir with cases-{zakat,miras,mosaref}.json> \
    python3 generate_fixtures.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FIXTURES = REPO / "apps" / "api" / "tests" / "fixtures"
SRC_DIR = Path(os.environ.get("CALC_SOURCES_DIR", Path.home() / "workspace/.calc-sources"))
CASES_DIR = Path(os.environ.get("CASES_DIR", "/tmp/calc-extract"))

SOURCE_URLS = {
    "zakat": "http://dl.ghadimyol.ir/calculator/zakat.html",
    "miras": "http://dl.ghadimyol.ir/calculator/miras.html",
    "mosaref": "http://dl.ghadimyol.ir/calculator/mosaref.html",
}

FA_NUM = {"یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6}
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def clean_num(text: str) -> str:
    return text.translate(_DIGITS).replace(",", "").replace("٬", "").strip()


def count_of(token: str) -> int:
    token = token.strip()
    if token in FA_NUM:
        return FA_NUM[token]
    return int(clean_num(token))


# ---------------------------------------------------------------- zakat ---
def norm_sheep(text: str) -> dict:
    tail = text.split(":", 1)[1].strip()
    if tail == "زکات ندارد":
        return {"due": []}
    n = count_of(tail.split(" ")[0])
    return {"due": [{"kind": "sheep", "count": n}]}


_CAMEL_AGES = {"یک‌ساله": 1, "دو‌ساله": 2, "سه‌ساله": 3, "چهار‌ساله": 4}


def norm_camel(text: str) -> dict:
    if "زکات ندارد" in text:
        return {"due": []}
    due: list[dict] = []

    def add(kind: str, count: int, age: int | None = None) -> None:
        for item in due:
            if item["kind"] == kind and item.get("age_years") == age:
                item["count"] += count
                return
        item = {"kind": kind, "count": count}
        if age is not None:
            item["age_years"] = age
        due.append(item)

    for m in re.finditer(r"(\d+|یک|دو|سه|چهار)\s+شتر ماده\s+(یک‌ساله|دو‌ساله|سه‌ساله|چهار‌ساله)", text):
        add("camel_female", count_of(m.group(1)), _CAMEL_AGES[m.group(2)])
    for m in re.finditer(r"(\d+|یک|دو|سه|چهار)\s+گوسفند", text):
        add("sheep", count_of(m.group(1)))
    # order: camels appear before sheep in the source text; keep text order by
    # re-sorting on first occurrence index
    order = {}
    for m in re.finditer(r"(شتر ماده|گوسفند)", text):
        key = "camel_female" if m.group(1) == "شتر ماده" else "sheep"
        order.setdefault(key, m.start())
    due.sort(key=lambda d: order.get(d["kind"], 0))
    return {"due": due}


def norm_cow(text: str) -> dict:
    if "زکات ندارد" in text:
        return {"due": [], "musinna_fortieths": 0}
    due: list[dict] = []
    num = r"(\d+|[۰-۹]+|یک|دو|سه|چهار)"
    m = re.search(num + r"\s+(?:رأس\s+)?گاو یک‌ساله", text)
    if m:
        due.append({"kind": "cow_tabii", "count": count_of(m.group(1))})
    m = re.search(num + r"\s+(?:رأس\s+)?گاو دو ساله", text)
    if m:
        due.append({"kind": "cow_musinna", "count": count_of(m.group(1))})
    fortieths = 0
    m = re.search(r"\+\s*(\d+)\s+چهلم", text)
    if m:
        fortieths = int(m.group(1))
    out: dict = {"due": due, "musinna_fortieths": fortieths}
    m = re.search(r"با\s+([۰-۹٬]+)\s+تومان پول", text)
    if m:
        out["extra_money_at_source_price"] = clean_num(m.group(1))
        out["source_price"] = "40000000"
    return out


def norm_metal(text: str) -> dict:
    if "به نصاب نرسیده است" in text:
        return {"nisab_met": False, "zakat_grams": "0"}
    m = re.search(r"زکات واجب:\s*([\d.]+)\s*گرم", text)
    return {"nisab_met": True, "zakat_grams": m.group(1)}


def norm_money(text: str) -> dict:
    if "به نصاب نرسیده است" in text:
        return {"nisab_met": False, "zakat_coins": "0", "zakat_amount": "0"}
    coins = re.search(r"زکات نهایی:\s*([\d.]+)\s*سکه", text).group(1)
    amount = re.search(r"زکات واجب به تومان:\s*([\d,]+)\s*تومان", text).group(1)
    return {"nisab_met": True, "zakat_coins": coins, "zakat_amount": amount.replace(",", "")}


def norm_oshr(text: str) -> dict:
    m = re.search(r":\s*([\d,.]+)\s*کیلوگرم", text)
    return {"oshr_kg": str(Decimal(clean_num(m.group(1))))}


def norm_khoms(text: str) -> dict:
    m = re.search(r"خمس شما:\s*([\d,.]+)", text)
    return {"khoms": str(Decimal(clean_num(m.group(1))))}


_ZAKAT_FN = {
    "calcSheep": ("sheep", norm_sheep),
    "calcCamel": ("camel", norm_camel),
    "calcCow": ("cow", norm_cow),
    "calctala": ("gold", norm_metal),
    "calcnogh": ("silver", norm_metal),
    "calcamval": ("money", norm_money),
    "calcOshr": ("oshr", norm_oshr),
    "calckhoms": ("khoms", norm_khoms),
}


# انحراف‌های مستند از خروجی منبع: جاهایی که خروجی خود منبع به‌علت
# محاسبهٔ float اشتباه است و موتور دقیق (Decimal) عمداً آن را بازتولید
# نمی‌کند. تست طلایی برای این کیس‌ها مقدار صحیحِ مستند را assert می‌کند.
_ZAKAT_DEVIATIONS = {
    "gold_147.2": {
        "kind": "source_float_artifact",
        "correct_zakat_grams": "3.68",
        "note": (
            "147.2g = nisab(92) + exactly 3 steps(18.4); exact zakat "
            "2.3 + 3*0.46 = 3.68 (= 147.2/40). The source's float "
            "division (147.2-92)/18.4 = 2.9999... floors to 2 steps "
            "and prints 3.22. Engine keeps the exact value."
        ),
    },
}


def build_zakat(raw: list[dict]) -> list[dict]:
    out = []
    for case in raw:
        if case["fn"] == "calcHorse":
            assert "در هر اسب یک دینار" in (case["text"] or "")
            out.append({
                "id": case["id"], "calc": "horse",
                "inputs": {"count": case["inputs"].get("HorseInput", 0)},
                "expected": {"rule_note": "dinar_or_fortieth_per_horse"},
            })
            continue
        kind, norm = _ZAKAT_FN[case["fn"]]
        inputs = {k: str(v) for k, v in case["inputs"].items()}
        if case.get("arg") is not None:
            inputs["irrigation"] = case["arg"]
        item = {"id": case["id"], "calc": kind, "inputs": inputs,
                "source_text": case["text"], "expected": norm(case["text"])}
        if case["id"] in _ZAKAT_DEVIATIONS:
            item["deviation"] = _ZAKAT_DEVIATIONS[case["id"]]
        out.append(item)
    return out


# ---------------------------------------------------------------- miras ---
_FAMILY_KEY_MAP = {
    "sonSons": "son_sons", "sonDaughters": "son_daughters",
    "pBrothers": "paternal_brothers", "pSisters": "paternal_sisters",
    "uBrothers": "uterine_brothers", "uSisters": "uterine_sisters",
    "fullBrotherSons": "full_brother_sons",
    "paternalBrotherSons": "paternal_brother_sons",
    "fullUncles": "full_uncles", "paternalUncles": "paternal_uncles",
    "fullUncleSons": "full_uncle_sons",
    "paternalUncleSons": "paternal_uncle_sons",
    "daughterSons": "daughter_sons", "daughterDaughters": "daughter_daughters",
    "sonDaughterSons": "son_daughter_sons",
    "sonDaughterDaughters": "son_daughter_daughters",
    "maternalGrandfather": "maternal_grandfather",
    "remoteGrandmothers": "remote_grandmothers",
    "sisterSons": "sister_sons", "sisterDaughters": "sister_daughters",
    "fullBrotherDaughters": "full_brother_daughters",
    "paternalBrotherDaughters": "paternal_brother_daughters",
    "uterineBrotherChildren": "uterine_brother_children",
    "uterineSisterChildren": "uterine_sister_children",
    "maternalUncles": "maternal_uncles", "maternalAunts": "maternal_aunts",
    "maternalPaternalUncles": "maternal_paternal_uncles",
    "paternalAunts": "paternal_aunts",
    "paternalUncleDaughters": "paternal_uncle_daughters",
}
_BLOCKED_NAME_TO_KEY = {
    "جدّه مادری": "mgm", "جدّه پدری": "pgm", "جد پدری": "grandfather",
    "برادران تنی": "brothers", "خواهران تنی": "sisters",
    "برادر تنی": "brothers", "خواهر تنی": "sisters",
    "برادران پدری": "paternal_brothers", "خواهران پدری": "paternal_sisters",
    "برادران مادری": "uterine_brothers", "خواهران مادری": "uterine_sisters",
    "پسران برادر تنی": "full_brother_sons", "پسر برادر تنی": "full_brother_sons",
    "پسران برادر پدری": "paternal_brother_sons", "پسر برادر پدری": "paternal_brother_sons",
    "عموهای تنی": "full_uncles", "عموهای پدری": "paternal_uncles",
    "پسران عموی تنی": "full_uncle_sons", "پسران عموی پدری": "paternal_uncle_sons",
    "بنت‌الابن": "son_daughters", "ابن‌الابن": "son_sons",
    "پسران دختر": "daughter_sons", "دختران دختر": "daughter_daughters",
    "پسران دخترِ پسر": "son_daughter_sons", "دختران دخترِ پسر": "son_daughter_daughters",
    "جد مادری": "maternal_grandfather", "جدات ساقطه": "remote_grandmothers",
    "پسران خواهر": "sister_sons", "دختران خواهر": "sister_daughters",
    "دختران برادر تنی": "full_brother_daughters",
    "دختران برادر پدری": "paternal_brother_daughters",
    "فرزندان برادر مادری": "uterine_brother_children",
    "فرزندان خواهر مادری": "uterine_sister_children",
    "دایی‌ها": "maternal_uncles", "خاله‌ها": "maternal_aunts",
    "عموهای مادری": "maternal_paternal_uncles", "عمه‌ها": "paternal_aunts",
    "دختران عمو": "paternal_uncle_daughters",
}


def _stop_code(warning: str | None) -> str:
    w = warning or ""
    if "اختلاف دین" in w:
        return "impediment_religion"
    if "کشته باشد" in w or "مانع ارث مورّث را کشته" in w:
        return "impediment_killer"
    if "تقدم فوت معلوم نباشد" in w:
        return "impediment_simultaneous_death"
    if "رقّ" in w:
        return "impediment_slavery"
    if "چندشاخه" in w:
        return "dhawu_multibranch"
    if "چیزی برای تقسیم باقی نمانده" in w:
        return "nothing_to_distribute"
    if "وارث قابل توزیع" in w:
        return "no_distributable_heir"
    if "دقیقاً به یک نمی‌رسد" in w:
        return "incomplete_total"
    return "unknown_stop"


def build_miras(raw: list[dict]) -> list[dict]:
    out = []
    for case in raw:
        st = case["state"]
        estate = sum(
            Decimal(str(i["value"])) * Decimal(str(i["share"])) / 100
            for i in st.get("estateItems", [])
        )
        inputs = {
            "gender": st.get("gender"),
            "estate_value": str(estate),
            "funeral": str(st.get("funeral", 0)),
            "debt": str(st.get("debt", 0)),
            "will": str(st.get("will", 0)),
            "will_for_heir": bool(st.get("willForHeir", False)),
            "will_approved": bool(st.get("willApproved", False)),
            "impediments": {
                "religion_mixed": bool(st.get("heirsReligionMixed", False)),
                "killer": bool(st.get("killerPresent", False)),
                "simultaneous_death": bool(st.get("simultaneousDeath", False)),
                "slavery": bool(st.get("slavePresent", False)),
            },
            "family": {_FAMILY_KEY_MAP.get(k, k): v for k, v in st.items() if k not in (
                "gender", "estateItems", "funeral", "debt", "will",
                "willForHeir", "willApproved", "heirsReligionMixed",
                "killerPresent", "simultaneousDeath", "slavePresent",
                "estate", "hasWives", "hasSons", "hasSonDesc", "sonDescType",
                "hasDaughters", "heirsAgreeValuation", "minorOrAbsentHeirQisma",
                "minorForHeteroQisma", "qismaByConsent", "cashInQismaConsent",
                "domicileMixed",
            )},
        }
        if case["stopped"]:
            expected = {"status": "stopped", "stop_code": _stop_code(case["warning"])}
        else:
            r = case["result"]
            blocked_keys: list[str] = []
            for name, _reason in r["blocked"]:
                key = _BLOCKED_NAME_TO_KEY.get(name)
                assert key, f"unmapped blocked name {name!r} in {case['id']}"
                if key not in blocked_keys:
                    blocked_keys.append(key)
            expected = {
                "status": "computed",
                "net": r["net"],
                "will_applied": r["will"],
                "awl": r["awl"],
                "radd": r["radd"],
                "rows": [
                    {"key": row["key"], "count": row["count"],
                     "share": f"{row['share']['n']}/{row['share']['d']}"}
                    for row in r["rows"]
                ],
                "blocked": blocked_keys,
            }
        out.append({"id": case["id"], "inputs": inputs, "expected": expected})
    return out


# -------------------------------------------------------------- mosaref ---
def _mosaref_error_code(html: str | None) -> str:
    h = html or ""
    if "ریشه باید حداقل" in h:
        return "root_too_short"
    if "جزء حروف اصلیِ ریشه نیست" in h:
        return "alif_in_root"
    if "ترکیب همزه با حرف علت" in h:
        return "mahmuz_weak_mix"
    if "ترکیب همزه با تضعیف" in h:
        return "mahmuz_mudgham_mix"
    if "افعال رباعی معتل" in h:
        return "rubaai_weak_unsupported"
    if "این ترکیب از حروف علت" in h:
        return "weak_combo_unsupported"
    if "صرف کامل این باب" in h:
        return "bab_unsupported"
    if "ابواب مزید و رباعی" in h:
        return "mudgham_augmented_unsupported"
    if "ابواب رباعی" in h:
        return "weak_rubaai_unsupported"
    return "unknown_error"


# انحراف مستند مُصَرِّف: صفحه fixHamza را روی رشتهٔ HTML اعمال می‌کند،
# پس همزهٔ ابتدای کلمه «حرف قبلی» را انتهای تگ HTML می‌بیند و برای
# مضموم کرسی ؤ می‌گیرد (ؤُخِذَ)؛ درحالی‌که کرسی درستِ ابتدای کلمه أ
# است — همان که شاخهٔ ابتدای رشتهٔ خود تابع قصد کرده است. موتور کرسی
# درست را می‌دهد؛ تست، رابطهٔ مکانیکی انحراف را قفل می‌کند.
_MOSAREF_DEVIATIONS = {
    "mahmuz_fa_akhz": {
        "kind": "source_html_context_artifact",
        "columns": ["past.passive", "tafdil.form"],
        "note": (
            "Page applies fixHamza to the full HTML string: a "
            "word-initial hamza inherits the preceding markup as "
            "context (damma -> ؤ). Engine seats word-initial hamza "
            "correctly (أ for fatha/damma, إ for kasra)."
        ),
    },
}


def build_mosaref(raw: list[dict]) -> list[dict]:
    out = []
    for case in raw:
        item = {
            "id": case["id"],
            "inputs": {"root": case["root"], "bab": case["bab"],
                       "transitivity": case["transitivity"],
                       "harf_jar": case["harf_jar"]},
            "status": case["status"],
        }
        if case["status"] == "error":
            item["error_code"] = _mosaref_error_code(case.get("error_html"))
        else:
            item["tables"] = case["tables"]
        if case["id"] in _MOSAREF_DEVIATIONS:
            item["deviation"] = _MOSAREF_DEVIATIONS[case["id"]]
        out.append(item)
    return out


# ------------------------------------------------------------------ main --
def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    builders = {"zakat": build_zakat, "miras": build_miras, "mosaref": build_mosaref}
    for name, builder in builders.items():
        cases = json.loads((CASES_DIR / f"cases-{name}.json").read_text(encoding="utf-8"))
        proc = subprocess.run(
            ["node", str(HERE / "harness.js"), name],
            input=json.dumps(cases), capture_output=True, text=True,
            env={**os.environ, "CALC_SOURCES_DIR": str(SRC_DIR)},
        )
        if proc.returncode != 0:
            print(proc.stderr, file=sys.stderr)
            raise SystemExit(f"harness failed for {name}")
        raw = json.loads(proc.stdout)
        digest = hashlib.sha256((SRC_DIR / f"{name}.html").read_bytes()).hexdigest()
        fixture = {
            "provenance": {
                "source_url": SOURCE_URLS[name],
                "source_sha256": digest,
                "fetched": "2026-10-21 via plain HTTP (HTTPS failed)",
                "attributed_author": "مهران ساعدی (per user attribution; name appears in zakat.html)",
                "license": "no explicit license text in source — rules re-implemented, code/prose not copied",
                "generated_by": "tools/golden/generate_fixtures.py + tools/golden/harness.js (original page JS executed in Node vm)",
            },
            "cases": builder(raw),
        }
        target = FIXTURES / f"{name}_golden.json"
        target.write_text(json.dumps(fixture, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{name}: {len(fixture['cases'])} cases -> {target}")


if __name__ == "__main__":
    main()
