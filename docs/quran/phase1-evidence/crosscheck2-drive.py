#!/usr/bin/env python3
"""Phase 1 remaining probes: tafsir groups, indopak layout coverage, WBW font pairing, header SVG licenses, DB<->JSON equality."""
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

EXT = Path.home() / "workspace" / "tarteel-drive" / "extracted"
EVIDENCE = Path.home() / "workspace" / "quran-hifz-redesign" / "docs" / "quran" / "phase1-evidence"
log = []

def note(s):
    log.append(s)
    print(s)

# 1. tafsir al-Wasit grouped rows
taf = sqlite3.connect(f"file:{EXT/'ar-tafsir-al-wasit.db'/'ar-tafsir-al-wasit.db'}?mode=ro", uri=True)
rows = taf.execute("SELECT ayah_key, group_ayah_key, from_ayah, to_ayah, text FROM tafsir").fetchall()
empty = [r for r in rows if not r[4]]
note(f"tafsir rows={len(rows)} empty_text={len(empty)}")
heads = {r[0]: r for r in rows}
bad = 0
for r in empty:
    head = heads.get(r[1])
    if head is None or not head[4]:
        bad += 1
note(f"empty rows whose group head is missing/empty: {bad}")
multi = Counter(r[1] for r in rows if r[1] != r[0])
note(f"groups with >1 ayah: {len(multi)}; largest group: {max((len([x for x in rows if x[1]==g]), g) for g in multi)}")
sample_group = [r for r in rows if r[1] == "2:1"][:3]
note(f"sample group 2:1 rows: {[(r[0], len(r[4] or '')) for r in sample_group]}")

# 2. indopak layouts word coverage
for lay_name, script_db in [("qudratullah-indopak-15-lines.db", "qpc-nastaleeq.db"),
                            ("qpc-nastaleeq-15-lines.db", "qpc-nastaleeq.db"),
                            ("indopak-13-lines-layout-qudratullah.db", "qpc-nastaleeq.db"),
                            ("indopak-13-lines-taj-company.db", "qpc-nastaleeq.db")]:
    lay = sqlite3.connect(f"file:{EXT/lay_name/lay_name}?mode=ro", uri=True)
    scr = sqlite3.connect(f"file:{EXT/script_db/script_db}?mode=ro", uri=True)
    ids = {r[0] for r in scr.execute("SELECT id FROM words")}
    covered = set()
    for first, last in lay.execute("SELECT first_word_id, last_word_id FROM pages WHERE first_word_id != ''"):
        covered.update(range(int(first), int(last) + 1))
    note(f"{lay_name} vs {script_db}: script words={len(ids)} covered={len(covered)} missing={len(ids-covered)} extra={len(covered-ids)}")
    # page 1/2 detail
    for pg in [1, 2, 610]:
        rws = lay.execute("SELECT line_number, line_type, first_word_id, last_word_id FROM pages WHERE page_number=? ORDER BY line_number", (pg,)).fetchall()
        note(f"  {lay_name} page {pg}: {len(rws)} lines: {rws[:4]}")

# 3. WBW IndoPak font pairing: cmap coverage of indopak.db verse chars
from fontTools.ttLib import TTFont
f = TTFont(str(EXT / "font.ttf" / "font.ttf"), lazy=True)
cmap = f.getBestCmap()
note(f"WBW font: family={f['name'].getDebugName(1)} glyphs={f['maxp'].numGlyphs} cmap_entries={len(cmap)}")
f.close()
ind = sqlite3.connect(f"file:{EXT/'indopak.db'/'indopak.db'}?mode=ro", uri=True)
texts = [r[0] for r in ind.execute("SELECT text FROM verses")]
chars = set("".join(texts))
missing = sorted(c for c in chars if ord(c) not in cmap and c not in " \n")
note(f"indopak.db distinct chars: {len(chars)}; NOT in WBW font cmap: {len(missing)} {[hex(ord(c)) for c in missing[:20]]}")
indn = sqlite3.connect(f"file:{EXT/'indopak-nastaleeq.db'/'indopak-nastaleeq.db'}?mode=ro", uri=True)
texts2 = [r[0] for r in indn.execute("SELECT text FROM verses")]
chars2 = set("".join(texts2))
missing2 = sorted(c for c in chars2 if ord(c) not in cmap and c not in " \n")
note(f"indopak-nastaleeq.db distinct chars: {len(chars2)}; NOT in WBW font cmap: {len(missing2)} {[hex(ord(c)) for c in missing2[:20]]}")

# 4. header SVG license comments
svgdir = EXT / "header-surah-svg"
comments = Counter()
for p in sorted(svgdir.glob("*.svg")):
    txt = p.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"<!--(.*?)-->", txt, re.S)
    comments[m.group(1).strip()[:200] if m else "<no comment>"] += 1
note(f"header SVG comment variants: {len(comments)}")
for c, n in comments.items():
    note(f"  x{n}: {c[:200]}")

# 5. DB <-> JSON equality for word-by-word sets
def words_from_db(path):
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    return {r[0]: r[1] for r in c.execute("SELECT location, text FROM words")}
for dbname, jsonname in [("qpc-hafs-word-by-word.db", "qpc-hafs-word-by-word.json"),
                         ("digital-khatt-v2.db", None),
                         ("qpc-v1-glyph-codes-wbw.db", "qpc-v1-glyph-codes-wbw.json"),
                         ("qpc-nastaleeq.db", None)]:
    dbw = words_from_db(EXT / dbname / dbname)
    note(f"{dbname}: words={len(dbw)}")
    if jsonname:
        j = json.loads((EXT / jsonname / jsonname).read_text(encoding="utf-8"))
        jw = {v["location"]: v["text"] for v in j.values()}
        diff = sum(1 for k in dbw if dbw[k] != jw.get(k))
        note(f"  vs {jsonname}: json_words={len(jw)} differing={diff}")
# digital-khatt-v2.db vs qul json
qul_dk2 = json.loads((Path.home() / "workspace" / "qul-downloads" / "digital-khatt-v2.json").read_text(encoding="utf-8"))
dk2w = {v["location"]: v["text"] for v in qul_dk2.values()}
dbw = words_from_db(EXT / "digital-khatt-v2.db" / "digital-khatt-v2.db")
diff = sum(1 for k in dbw if dbw[k] != dk2w.get(k))
note(f"digital-khatt-v2.db vs qul digital-khatt-v2.json: db={len(dbw)} json={len(dk2w)} differing={diff}")
# qpc-nastaleeq.db vs qul json
qul_nas = json.loads((Path.home() / "workspace" / "qul-downloads" / "qpc-nastaleeq.json").read_text(encoding="utf-8"))
nasw = {v["location"]: v["text"] for v in qul_nas.values()}
dbw2 = words_from_db(EXT / "qpc-nastaleeq.db" / "qpc-nastaleeq.db")
diff2 = sum(1 for k in dbw2 if dbw2[k] != nasw.get(k))
note(f"qpc-nastaleeq.db vs qul qpc-nastaleeq.json: db={len(dbw2)} json={len(nasw)} differing={diff2}")
# indopak-nastaleeq db vs json (both in Drive)
ijn = json.loads((EXT / "indopak-nastaleeq.json" / "indopak-nastaleeq.json").read_text(encoding="utf-8"))
note(f"indopak-nastaleeq.json: ayah records={len(ijn)}")
c = sqlite3.connect(f"file:{EXT/'indopak-nastaleeq.db'/'indopak-nastaleeq.db'}?mode=ro", uri=True)
dbv = {r[0]: r[1] for r in c.execute("SELECT verse_key, text FROM verses")}
jv = {v["verse_key"]: v["text"] for v in ijn.values()}
diff3 = sum(1 for k in dbv if dbv[k] != jv.get(k))
note(f"indopak-nastaleeq db vs json: db={len(dbv)} json={len(jv)} differing={diff3}")

# 6. tajweed-images-old: URL pattern check
ti = sqlite3.connect(f"file:{EXT/'tajweed-images-old.db'/'tajweed-images-old.db'}?mode=ro", uri=True)
urls = [r[0] for r in ti.execute("SELECT text FROM words LIMIT 3")]
note(f"tajweed-images sample URLs: {urls}")
prefixes = Counter("/".join(r[0].split("/")[:6]) for r in ti.execute("SELECT text FROM words"))
note(f"tajweed-images URL prefixes: {dict(prefixes)}")

(EVIDENCE / "crosscheck2-report.txt").write_text("\n".join(log), encoding="utf-8")
note("WROTE crosscheck2-report.txt")
