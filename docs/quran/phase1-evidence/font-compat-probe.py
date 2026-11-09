#!/usr/bin/env python3
"""Font/script compatibility probe: every QPC V2 word glyph must exist in its page font (TTF and WOFF2)."""
import json
import sqlite3
from pathlib import Path
from fontTools.ttLib import TTFont

EXT = Path.home() / "workspace" / "tarteel-drive" / "extracted"
EVIDENCE = Path.home() / "workspace" / "quran-hifz-redesign" / "docs" / "quran" / "phase1-evidence"
log = []

def note(s):
    log.append(s)
    print(s)

# word -> page from layout + glyph text from qpc-v2.json
v2json = json.loads((EXT / "qpc-v2.json" / "qpc-v2.json").read_text(encoding="utf-8"))
lay = sqlite3.connect(f"file:{EXT/'qpc-v2-15-lines.db'/'qpc-v2-15-lines.db'}?mode=ro", uri=True)
word_page = {}
for pno, first, last in lay.execute("SELECT page_number, first_word_id, last_word_id FROM pages WHERE first_word_id != ''"):
    for wid in range(int(first), int(last) + 1):
        word_page[wid] = pno
note(f"words mapped to pages: {len(word_page)}")

# glyph codepoint per word: text is a single PUA char (ligature)
# collect per-page set of codepoints
page_cps = {}
for k, v in v2json.items():
    wid = v["id"]
    pg = word_page.get(wid)
    if pg is None:
        continue
    for ch in v["text"]:
        page_cps.setdefault(pg, set()).add(ord(ch))
note(f"pages with glyph cps: {len(page_cps)}; total distinct cps overall: {len(set().union(*page_cps.values()))}")
# check: distinct cps per page vs words per page
for pg in [1, 2, 100, 245, 604]:
    note(f"page {pg}: distinct glyph codepoints={len(page_cps[pg])}")

# cmap probe per page font (TTF + WOFF2), with error capture
def cmap_codes(path):
    try:
        f = TTFont(str(path), lazy=True)
        codes = set()
        for t in f["cmap"].tables:
            codes.update(t.cmap.keys())
        n = f["maxp"].numGlyphs
        f.close()
        return codes, n, None
    except Exception as e:
        return None, None, f"{type(e).__name__}: {e}"

missing_ttf = {}
missing_woff2 = {}
errors = {}
for pg in sorted(page_cps):
    tp = EXT / "QPC V2 Font.ttf.bz2" / f"p{pg}.ttf"
    wp = EXT / "QPC V2 Font.woff2.bz2" / f"p{pg}.woff2"
    tc, tn, te = cmap_codes(tp)
    wc, wn, we = cmap_codes(wp)
    if te:
        errors[f"p{pg}.ttf"] = te
    if we:
        errors[f"p{pg}.woff2"] = we
    if tc is not None:
        miss = page_cps[pg] - tc
        if miss:
            missing_ttf[pg] = sorted(miss)
    if wc is not None:
        miss = page_cps[pg] - wc
        if miss:
            missing_woff2[pg] = sorted(miss)
note(f"pages with glyphs missing from TTF cmap: {len(missing_ttf)}; total missing codepoints: {sum(len(v) for v in missing_ttf.values())}")
note(f"pages with glyphs missing from WOFF2 cmap: {len(missing_woff2)}; total missing codepoints: {sum(len(v) for v in missing_woff2.values())}")
note(f"cmap read errors: {len(errors)}")
for k, v in list(errors.items())[:10]:
    note(f"  ERR {k}: {v}")
if missing_ttf:
    note(f"  TTF missing sample: {dict(list(missing_ttf.items())[:3])}")
if missing_woff2:
    note(f"  WOFF2 missing sample: {dict(list(missing_woff2.items())[:3])}")

# p1 cmap codepoint ranges detail
for pg in [1, 100]:
    for fmt, path in [("TTF", EXT / "QPC V2 Font.ttf.bz2" / f"p{pg}.ttf"),
                      ("WOFF2", EXT / "QPC V2 Font.woff2.bz2" / f"p{pg}.woff2")]:
        try:
            f = TTFont(str(path), lazy=True)
            fmts = [(t.format, len(t.cmap)) for t in f["cmap"].tables]
            codes = sorted(set().union(*[set(t.cmap.keys()) for t in f["cmap"].tables]))
            note(f"p{pg} {fmt}: cmap formats={fmts}; code range U+{codes[0]:04X}..U+{codes[-1]:04X}; n_codes={len(codes)}; sample={[hex(c) for c in codes[:6]]}")
            f.close()
        except Exception as e:
            note(f"p{pg} {fmt}: ERROR {type(e).__name__}: {e}")

# p245.woff2 raw cmap table inspection
p245w = EXT / "QPC V2 Font.woff2.bz2" / "p245.woff2"
try:
    f = TTFont(str(p245w), lazy=True)
    raw = f.reader.tables["cmap"].data if "cmap" in f.reader.tables else None
    note(f"p245.woff2 cmap raw bytes: {len(raw) if raw else None}")
    # list cmap subtables via sfnt table directory
    from fontTools.ttLib.sfnt import SFNTReader
    note(f"p245.woff2 tables: {sorted(f.keys())}")
    f.close()
except Exception as e:
    note(f"p245.woff2 raw inspect ERROR: {type(e).__name__}: {e}")
# compare p245 woff2 vs ttf file sizes + woff2 magic
for pg in [245]:
    for path in [EXT / "QPC V2 Font.ttf.bz2" / f"p{pg}.ttf", EXT / "QPC V2 Font.woff2.bz2" / f"p{pg}.woff2"]:
        data = path.read_bytes()[:16]
        note(f"{path.name}: size={path.stat().st_size} magic={data[:4]!r}")

(EVIDENCE / "font-compat-report.txt").write_text("\n".join(log), encoding="utf-8")
note("WROTE font-compat-report.txt")
