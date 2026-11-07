#!/usr/bin/env python3
"""Phase 1 validation of the 31 Tarteel Drive zips.
Writes a JSON report to ~/workspace/quran-hifz-redesign/docs/quran/phase1-evidence/validation-report.json
and a human-readable log next to it. Never touches the repo code.
"""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import zipfile
from pathlib import Path

DRIVE = Path.home() / "workspace" / "tarteel-drive"
EXTRACT = DRIVE / "extracted"
EVIDENCE = Path.home() / "workspace" / "quran-hifz-redesign" / "docs" / "quran" / "phase1-evidence"
EVIDENCE.mkdir(parents=True, exist_ok=True)
EXTRACT.mkdir(parents=True, exist_ok=True)

EXPECTED_MD5 = {
    "indopak.db.zip": "af153b1067aec64223fc2e8012e34f36",
    "tajweed-images-old.db.zip": "789df96aa1eed382f63f604a6fd5761e",
    "qpc-nastaleeq.db.zip": "b6228dfcbe320e069a870297f75bbb40",
    "digital-khatt-v2.db.zip": "eaf05a1df52b75dc7130b2f618eb782e",
    "ar-tafsir-al-wasit.db.zip": "5a089e64a94028cb1388c6868873f868",
    "indopak-13-lines-layout-qudratullah.db.zip": "5cee13000a9ecffc433ff1bb73fc12a8",
    "indopak-13-lines-taj-company.db.zip": "45e73eddb8c046e8bd55960ba5a3e206",
    "qudratullah-indopak-15-lines.db.zip": "3e1bf69bd0db9fd479ad15f2f5e0d508",
    "indopak-nastaleeq.json.zip": "51d0e208777684aa39c61d98c2adedfa",
    "indopak-nastaleeq.db.zip": "9c22ef5f2b65952229272c7849fe54d5",
    "font.woff2.zip": "2d6f26e8d2144b0a8e405e86537eb19b",
    "font.ttf.zip": "8c4403047e8adabcb6e1898407678942",
    "font.woff.zip": "a43e7094c230854e80a705b9af21628b",
    "qpc-nastaleeq-15-lines.db.zip": "88b14d28464d2e9763ac66eda0453e20",
    "header-surah-svg.zip": "e82ae9634335df16a9b641416377ef52",
    "quran-metadata-surah-name.json.zip": "222d0b5c4e3e441b77eac146dbb5d9ca",
    "quran-metadata-surah-name.sqlite.zip": "4c89884449b9902746934f6ca0619bc4",
    "qpc-v1-glyph-codes-wbw.json.zip": "f7f6a45f836941d512f8b2ff9d27525f",
    "qpc-v1-glyph-codes-wbw.db.zip": "e08d5a1b8ee26c422fc7ab8b1362b3b0",
    "qpc-v4.db.zip": "d4bc3c8042f8f27f307d9fbbe3ade350",
    "QPC V2 Font.ttf.bz2.zip": "f29f58da628e17c19e4831f3593af5db",
    "qpc-hafs-word-by-word.db.zip": "b9ef57f63805a38f2c5f821f3d0c0619",
    "qpc-hafs-word-by-word.json.zip": "e9e35d01340bd554a943a3fac11253fa",
    "qpc-v2-ayah-by-ayah-glyphs.db.zip": "80904084f55de26ed7b2dc0ffed54b85",
    "qpc-v2-ayah-by-ayah-glyphs.json.zip": "a189a709271bba1310a55a09e6f223ed",
    "QPC V2 Font.woff2.bz2.zip": "97dc9e791b7a3d90278b9c7f90e5a23e",
    "qpc-hafs-tajweed.json.zip": "0a97ac87db88ffe6262f4e8d6c1dbdd2",
    "qpc-hafs-tajweed.db.zip": "6945ea713344a0efee58c99aaca07973",
    "qpc-v2.json.zip": "13ad0a2659b7388d4c8bf31b06ba98ca",
    "qpc-v2.db.zip": "c2bc740fb760a178cdda8a7d278aaa48",
    "qpc-v2-15-lines.db.zip": "462dcac6f1b4413010cff9eeb837f641",
}

def md5(p: Path) -> str:
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def db_summary(db_path: Path) -> dict:
    out = {"tables": {}}
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = con.cursor()
        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        out["table_list"] = tables
        for t in tables:
            try:
                n = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except Exception as e:
                n = f"ERROR: {e}"
            try:
                cols = [r[1] for r in cur.execute(f'PRAGMA table_info("{t}")')]
            except Exception:
                cols = []
            out["tables"][t] = {"rows": n, "columns": cols}
        # extra probes
        out["probes"] = {}
        for t in tables:
            try:
                sample = cur.execute(f'SELECT * FROM "{t}" LIMIT 2').fetchall()
                out["probes"][t] = [str(r)[:300] for r in sample]
            except Exception as e:
                out["probes"][t] = f"ERROR: {e}"
        con.close()
    except Exception as e:
        out["error"] = str(e)
    return out

def json_summary(jp: Path) -> dict:
    out = {}
    try:
        with open(jp, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            keys = list(data.keys())
            out["type"] = "object"
            out["records"] = len(keys)
            out["sample_keys"] = keys[:3]
            first = data[keys[0]] if keys else None
            out["sample_value"] = str(first)[:500]
            # surah/ayah coverage
            try:
                sas = set()
                for k in keys:
                    parts = k.split(":")
                    if len(parts) >= 2:
                        sas.add((int(parts[0]), int(parts[1])))
                out["distinct_ayahs"] = len(sas)
                out["surahs"] = len({s for s, _ in sas})
                out["max_ayah_per_surah_sample"] = {
                    str(s): max(a for ss, a in sas if ss == s)
                    for s in sorted({s for s, _ in sas})[:3]
                }
            except Exception as e:
                out["ayah_parse_error"] = str(e)
        elif isinstance(data, list):
            out["type"] = "list"
            out["records"] = len(data)
            out["sample_value"] = str(data[0])[:500] if data else None
        else:
            out["type"] = type(data).__name__
    except Exception as e:
        out["error"] = str(e)
    return out

def font_summary(fp: Path) -> dict:
    out = {"size": fp.stat().st_size}
    try:
        r = subprocess.run(["file", str(fp)], capture_output=True, text=True)
        out["file"] = r.stdout.strip()
    except Exception as e:
        out["file_error"] = str(e)
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(str(fp), fontNumber=0, lazy=True)
        out["glyphs"] = f["maxp"].numGlyphs
        out["family"] = str(f["name"].getDebugName(1))
        out["subfamily"] = str(f["name"].getDebugName(2))
        out["version"] = str(f["name"].getDebugName(5))
        out["cmap_tables"] = [(t.platformID, t.platEncID, len(t.cmap)) for t in f["cmap"].tables]
        out["units_per_em"] = f["head"].unitsPerEm
        f.close()
    except Exception as e:
        out["fonttools_error"] = str(e)
    return out

report = {"files": {}}
zips = sorted(DRIVE.glob("*.zip"))
print(f"found {len(zips)} zips")
for zp in zips:
    name = zp.name
    entry = {"size": zp.stat().st_size, "md5": md5(zp), "md5_expected": EXPECTED_MD5.get(name),
             "md5_match": (md5(zp) == EXPECTED_MD5.get(name)) if name in EXPECTED_MD5 else None,
             "sha256": sha256(zp)}
    print(f"== {name} ({entry['size']} B) md5_match={entry['md5_match']}")
    # zip integrity
    try:
        with zipfile.ZipFile(zp) as z:
            bad = z.testzip()
            infos = z.infolist()
            entry["zip_test_bad"] = bad
            entry["members"] = [{"name": i.filename, "size": i.file_size,
                                 "compressed": i.compress_size} for i in infos]
    except Exception as e:
        entry["zip_error"] = str(e)
        report["files"][name] = entry
        continue
    # extract
    dest = EXTRACT / zp.stem
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zp) as z:
            z.extractall(dest)
        entry["extracted_to"] = str(dest)
    except Exception as e:
        entry["extract_error"] = str(e)
        report["files"][name] = entry
        continue
    # walk extracted files
    extracted = sorted([p for p in dest.rglob("*") if p.is_file()])
    entry["extracted_files"] = [{"path": str(p.relative_to(dest)), "size": p.stat().st_size,
                                 "sha256": sha256(p)} for p in extracted]
    # per-type validation
    for p in extracted:
        suf = p.suffix.lower()
        key = str(p.relative_to(dest))
        if suf in (".db", ".sqlite", ".sqlite3"):
            entry.setdefault("db", {})[key] = db_summary(p)
        elif suf == ".json":
            entry.setdefault("json", {})[key] = json_summary(p)
        elif suf in (".ttf", ".otf", ".woff", ".woff2"):
            entry.setdefault("fonts", {})[key] = font_summary(p)
        elif suf == ".bz2":
            # decompress with bzip2
            outp = p.with_suffix("")
            try:
                r = subprocess.run(["bunzip2", "-k", "-f", str(p)], capture_output=True, text=True, timeout=600)
                if r.returncode == 0 and outp.exists():
                    entry.setdefault("bz2", {})[key] = {
                        "decompressed": str(outp.relative_to(dest)),
                        "size": outp.stat().st_size,
                        "sha256": sha256(outp),
                        "font": font_summary(outp) if outp.suffix.lower() in (".ttf", ".otf", ".woff", ".woff2") else None,
                    }
                else:
                    entry.setdefault("bz2", {})[key] = {"error": r.stderr[:500]}
            except Exception as e:
                entry.setdefault("bz2", {})[key] = {"error": str(e)}
        elif suf == ".svg":
            pass  # counted below
    # svg counting
    svgs = [p for p in extracted if p.suffix.lower() == ".svg"]
    if svgs:
        entry["svg_count"] = len(svgs)
        entry["svg_names_sample"] = sorted(p.name for p in svgs)[:5]
        entry["svg_names_last"] = sorted(p.name for p in svgs)[-5:]
    report["files"][name] = entry

# cross-checks: compare extracted JSONs with ~/workspace/qul-downloads
qul = Path.home() / "workspace" / "qul-downloads"
report["qul_crosscheck"] = {}
if qul.exists():
    for f in sorted(qul.glob("*.json")):
        report["qul_crosscheck"][f.name] = {"size": f.stat().st_size, "sha256": sha256(f)}

out = EVIDENCE / "validation-report.json"
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"WROTE {out}")
print(f"files validated: {len(report['files'])}")
