#!/usr/bin/env python3
"""Phase 1 cross-checks on extracted Drive files. Writes crosscheck-report.json + .txt"""
import hashlib
import json
import sqlite3
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

EXT = Path.home() / "workspace" / "tarteel-drive" / "extracted"
QUL = Path.home() / "workspace" / "qul-downloads"
EVIDENCE = Path.home() / "workspace" / "quran-hifz-redesign" / "docs" / "quran" / "phase1-evidence"
out = {}
log = []

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()

def note(s):
    log.append(s)
    print(s)

# 1. identical-file checks
pairs = [
    ("qpc-v2.db", "qpc-v4.db"),
    ("qpc-v2.json", "qpc-v4.json (qul)"),
]
v2db = EXT / "qpc-v2.db" / "qpc-v2.db"
v4db = EXT / "qpc-v4.db" / "qpc-v4.db"
v2json = EXT / "qpc-v2.json" / "qpc-v2.json"
qul_v4 = QUL / "qpc-v4.json"
qul_hafs = QUL / "qpc-hafs-word-by-word.json"
ext_hafs = EXT / "qpc-hafs-word-by-word.json" / "qpc-hafs-word-by-word.json"
qul_dk2 = QUL / "digital-khatt-v2.json"
note(f"sha qpc-v2.db      = {sha(v2db)}")
note(f"sha qpc-v4.db      = {sha(v4db)}")
note(f"v2.db == v4.db ?   {sha(v2db) == sha(v4db)}")
note(f"sha qpc-v2.json    = {sha(v2json)}")
note(f"sha qul qpc-v4.json= {sha(qul_v4)}")
note(f"v2.json == qul v4 ? {sha(v2json) == sha(qul_v4)}")
note(f"sha ext hafs json  = {sha(ext_hafs)}")
note(f"sha qul hafs json  = {sha(qul_hafs)}")
note(f"ext hafs == qul hafs ? {sha(ext_hafs) == sha(qul_hafs)}")
out["identical"] = {
    "v2db_eq_v4db": sha(v2db) == sha(v4db),
    "v2json_eq_qul_v4": sha(v2json) == sha(qul_v4),
    "ext_hafs_eq_qul_hafs": sha(ext_hafs) == sha(qul_hafs),
}
# v2 vs v4 word-level diff (if DBs differ in bytes, compare rows)
con2 = sqlite3.connect(f"file:{v2db}?mode=ro", uri=True)
con4 = sqlite3.connect(f"file:{v4db}?mode=ro", uri=True)
w2 = con2.execute("SELECT id, location, text FROM words ORDER BY id").fetchall()
w4 = con4.execute("SELECT id, location, text FROM words ORDER BY id").fetchall()
diff = sum(1 for a, b in zip(w2, w4) if a != b)
note(f"v2 vs v4 words rows: {len(w2)} vs {len(w4)}, differing rows: {diff}")
out["v2_v4_word_diff_rows"] = diff
out["v2_v4_sample_diff"] = [(a, b) for a, b in zip(w2, w4) if a != b][:5]

# 2. qpc-v2 layout <-> words link check
lay = sqlite3.connect(f"file:{EXT/'qpc-v2-15-lines.db'/'qpc-v2-15-lines.db'}?mode=ro", uri=True)
info = lay.execute("SELECT * FROM info").fetchall()
pages = lay.execute("SELECT page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number FROM pages ORDER BY page_number, line_number").fetchall()
note(f"V2 layout info: {info}")
note(f"V2 layout pages rows: {len(pages)}; distinct pages: {len({p[0] for p in pages})}; max page: {max(p[0] for p in pages)}")
ids = {r[0] for r in w2}
bad_first = [p for p in pages if p[4] not in ("", None) and int(p[4]) not in ids]
bad_last = [p for p in pages if p[5] not in ("", None) and int(p[5]) not in ids]
note(f"V2 layout first_word_id not in words table: {len(bad_first)}; last_word_id missing: {len(bad_last)}")
# every word id covered by exactly one line?
covered = set()
for p in pages:
    if p[4] not in ("", None) and p[5] not in ("", None):
        covered.update(range(int(p[4]), int(p[5]) + 1))
note(f"V2 layout covers word ids: {len(covered)} of {len(ids)}; missing ids: {sorted(ids - covered)[:10]} (count {len(ids-covered)}); extra ids: {sorted(covered-ids)[:10]}")
# line types
note(f"V2 layout line_type counts: {Counter(p[2] for p in pages)}")
# page 1 and 604 spans
p1 = [p for p in pages if p[0] == 1]
p604 = [p for p in pages if p[0] == 604]
note(f"V2 page1 lines: {len(p1)} first/last word: {p1[0][4]}..{p1[-1][5]}; page604 lines: {len(p604)} first/last: {p604[0][4]}..{p604[-1][5]}")
out["v2_layout"] = {"rows": len(pages), "pages": len({p[0] for p in pages}),
                    "missing_first": len(bad_first), "missing_last": len(bad_last),
                    "covered_words": len(covered), "total_words": len(ids),
                    "uncovered_word_ids": sorted(ids - covered),
                    "line_types": dict(Counter(p[2] for p in pages))}

# 3. ayah-by-ayah glyphs page_number vs layout
aba = sqlite3.connect(f"file:{EXT/'qpc-v2-ayah-by-ayah-glyphs.db'/'qpc-v2-ayah-by-ayah-glyphs.db'}?mode=ro", uri=True)
verses = aba.execute("SELECT verse_key, page_number FROM verses").fetchall()
note(f"ayah-by-ayah verses: {len(verses)}; page range: {min(v[1] for v in verses)}..{max(v[1] for v in verses)}")
# page of each ayah from layout: ayah -> pages containing its words
word_ayah = {}
for wid, loc, text in w2:
    s, a, w = loc.split(":")
    word_ayah[wid] = (int(s), int(a))
ayah_pages_layout = {}
for p in pages:
    if p[4] not in ("", None):
        for wid in range(int(p[4]), int(p[5]) + 1):
            ayah_pages_layout.setdefault(word_ayah[wid], set()).add(p[0])
mismatch = 0
multi = 0
for vk, pg in verses:
    s, a = map(int, vk.split(":"))
    lp = ayah_pages_layout.get((s, a), set())
    if len(lp) > 1:
        multi += 1
    if lp and pg not in lp:
        mismatch += 1
note(f"ayah-by-ayah page_number mismatches vs layout: {mismatch}; ayahs spanning >1 page: {multi}")
out["aba_page_mismatch"] = mismatch
out["aba_multi_page_ayahs"] = multi

# 4. other layouts: info vs actual max page
for name in ["indopak-13-lines-layout-qudratullah.db", "indopak-13-lines-taj-company.db",
             "qudratullah-indopak-15-lines.db", "qpc-nastaleeq-15-lines.db"]:
    db = EXT / name / name
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    inf = c.execute("SELECT * FROM info").fetchall()
    mx = c.execute("SELECT MAX(page_number), COUNT(*) FROM pages").fetchone()
    lt = Counter(r[0] for r in c.execute("SELECT line_type FROM pages"))
    note(f"{name}: info={inf} max_page={mx[0]} rows={mx[1]} line_types={dict(lt)}")
    out[name] = {"info": inf, "max_page": mx[0], "rows": mx[1], "line_types": dict(lt)}

# 5. surah metadata sums
meta = json.loads((EXT / "quran-metadata-surah-name.json" / "quran-metadata-surah-name.json").read_text(encoding="utf-8"))
note(f"metadata records: {len(meta)}; sum verses_count: {sum(m['verses_count'] for m in meta.values())}; bismillah_pre False: {[k for k, m in meta.items() if not m['bismillah_pre']]}")
out["metadata"] = {"records": len(meta), "verses_sum": sum(m["verses_count"] for m in meta.values())}

# 6. header SVGs: parse + which surahs
svgdir = EXT / "header-surah-svg"
svgs = sorted(svgdir.glob("*.svg"))
nums = sorted(int(p.stem.split("-")[1]) for p in svgs)
note(f"header SVGs: {len(svgs)}; surahs present: {nums[0]}..{nums[-1]}; missing: {[n for n in range(1, 115) if n not in nums]}")
bad_xml = []
for p in svgs:
    try:
        ET.parse(p)
    except Exception as e:
        bad_xml.append((p.name, str(e)))
note(f"header SVGs failing XML parse: {len(bad_xml)} {bad_xml[:3]}")
# sample svg content size + first bytes
s2 = (svgdir / "surah-002.svg").read_text(encoding="utf-8")
note(f"surah-002.svg chars: {len(s2)}; starts: {s2[:120]!r}")
out["header_svg"] = {"count": len(svgs), "missing_surahs": [n for n in range(1, 115) if n not in nums],
                     "bad_xml": bad_xml}

# 7. tajweed rules distinct classes
import re
tj = json.loads((EXT / "qpc-hafs-tajweed.json" / "qpc-hafs-tajweed.json").read_text(encoding="utf-8"))
classes = Counter()
for v in tj.values():
    classes.update(re.findall(r'class=([a-z_]+)', v["text"]))
note(f"tajweed rule classes ({len(classes)} distinct): {dict(classes)}")
out["tajweed_classes"] = dict(classes)

# 8. tafsir al-Wasit checks
taf = sqlite3.connect(f"file:{EXT/'ar-tafsir-al-wasit.db'/'ar-tafsir-al-wasit.db'}?mode=ro", uri=True)
n = taf.execute("SELECT COUNT(*), COUNT(DISTINCT ayah_key), SUM(CASE WHEN text IS NULL OR text='' THEN 1 ELSE 0 END) FROM tafsir").fetchone()
groups = taf.execute("SELECT COUNT(*) FROM tafsir WHERE group_ayah_key != ayah_key").fetchone()
note(f"tafsir al-Wasit: rows={n[0]} distinct_ayah={n[1]} empty_text={n[2]} grouped_rows={groups[0]}")
out["tafsir"] = {"rows": n[0], "distinct_ayah": n[1], "empty_text": n[2], "grouped_rows": groups[0]}

# 9. indopak.db vs indopak-nastaleeq.db: same verses? diff count
def verses(dbpath):
    c = sqlite3.connect(f"file:{dbpath}?mode=ro", uri=True)
    return {r[0]: r[1] for r in c.execute("SELECT verse_key, text FROM verses")}
vi = verses(EXT / "indopak.db" / "indopak.db")
vn = verses(EXT / "indopak-nastaleeq.db" / "indopak-nastaleeq.db")
diff_in = sum(1 for k in vi if vi[k] != vn.get(k))
note(f"indopak.db vs indopak-nastaleeq.db: {len(vi)} vs {len(vn)} verses; differing texts: {diff_in}")
out["indopak_verse_diff"] = diff_in

# 10. p245.ttf investigation + p1 woff2 vs ttf
from fontTools.ttLib import TTFont
p245 = EXT / "QPC V2 Font.ttf.bz2" / "p245.ttf"
note(f"p245.ttf exists: {p245.exists()} size: {p245.stat().st_size if p245.exists() else None}")
try:
    f = TTFont(str(p245), fontNumber=0, lazy=False)
    note(f"p245 non-lazy open OK: glyphs={f['maxp'].numGlyphs} family={f['name'].getDebugName(1)}")
    f.close()
except Exception as e:
    note(f"p245 non-lazy open FAILED: {type(e).__name__}: {e}")
try:
    f = TTFont(str(p245), fontNumber=0, lazy=True)
    note(f"p245 lazy open OK: glyphs={f['maxp'].numGlyphs}")
    f.close()
except Exception as e:
    note(f"p245 lazy open FAILED: {type(e).__name__}: {e}")
for pg in [1, 2, 245, 604]:
    try:
        t = TTFont(str(EXT / "QPC V2 Font.ttf.bz2" / f"p{pg}.ttf"), lazy=True)
        tg = t["maxp"].numGlyphs
        try:
            tc = sum(len(x.cmap) for x in t["cmap"].tables)
        except Exception as e:
            tc = f"CMAP-ERROR: {type(e).__name__}: {e}"
        t.close()
    except Exception as e:
        tg, tc = "ERROR", f"{type(e).__name__}: {e}"
    try:
        w = TTFont(str(EXT / "QPC V2 Font.woff2.bz2" / f"p{pg}.woff2"), lazy=True)
        wg = w["maxp"].numGlyphs
        try:
            wc = sum(len(x.cmap) for x in w["cmap"].tables)
        except Exception as e:
            wc = f"CMAP-ERROR: {type(e).__name__}: {e}"
        w.close()
    except Exception as e:
        wg, wc = "ERROR", f"{type(e).__name__}: {e}"
    note(f"page {pg}: TTF glyphs={tg} cmap={tc} | WOFF2 glyphs={wg} cmap={wc}")
# check for duplicate family names across TTF set
fams = Counter()
for p in sorted((EXT / "QPC V2 Font.ttf.bz2").glob("p*.ttf")):
    try:
        f = TTFont(str(p), lazy=True)
        fams[str(f["name"].getDebugName(1))] += 1
        f.close()
    except Exception:
        fams["<error>"] += 1
note(f"TTF families: {len(fams)} distinct; duplicates: {[k for k, v in fams.items() if v > 1][:5]}; errors: {fams.get('<error>', 0)}")
out["ttf_families_distinct"] = len(fams)

(EVIDENCE / "crosscheck-report.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
(EVIDENCE / "crosscheck-report.txt").write_text("\n".join(log), encoding="utf-8")
note("WROTE crosscheck reports")
