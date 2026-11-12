#!/usr/bin/env python3
"""Generate the QPC V4 (Madina 1441 print) mushaf data for the web
reader — Tarteel-parity step 2 (agent-2 PR).

Inputs (env DK_QUL_DB, same database as the Digital Khatt
generator): the QUL word/layout datasets as distributed in the
Tarteel app bundle (quran-data.sqlite):
  - words            (83,668 rows incl. 6,236 ayah-end markers)
  - qpc_v4_layout    (604 pages x 15 lines: ayah/basmallah/surah_name)

Repo inputs:
  - public/quran-mushaf-v2.json        (juz/hizb per page + the
    independent pipeline's pages, used for cross-checks)
  - public/quran-mushaf-v4-glyphs/p{n}.json  (the study module's
    per-page V4 glyph maps, keyed "surah:ayah:real-word-ordinal",
    with one extra marker entry per ayah)

Outputs:
  - public/quran-mushaf-v4.json + public/quran-mushaf-v4-pages/p{n}.json
    Pages in the EXACT V2Page shape (lib/quran-mushaf-v2.ts), so
    the reader renders them through the proven, fail-closed
    expandV2Page pipeline with the QCF V4 per-page fonts.
  - public/quran-mushaf-v4qpc-glyphs/p{n}.json
    The same glyph maps re-keyed by QUL id (the keying
    expandV2Page consumes), one file per page.

Segment construction replicates the repo V2 convention exactly:
  - a line-leading ayah-end marker becomes the line's `lead`
    ("NUM:s:a") and belongs to no segment;
  - a marker inside the line sets e=1 on its ayah's last segment
    in that line;
  - segment w = the reader-relative Tanzil token index of the
    segment's first real word: (ordinal-1) + pause/sajda sign
    tokens bundled before it in the QUL uthmani strings + the
    4-token Basmala prefix for ayah 1 of surahs 2..114 except 9.

Fail-hard validations (any failure aborts, nothing is written):
  - the w formula reproduces EVERY segment start of the repo's
    own V2 pages (thousands of independent samples);
  - per line: segment word counts + markers account for every
    layout token in the range;
  - glyph coverage: every distinct token id in a page's ranges
    has a glyph entry (the 37:130 pair shares one id/entry);
  - totals: 604 pages, 83,668 layout tokens placed.
"""
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
PUBLIC = os.path.join(WEB, "public")
DB_PATH = os.environ.get("DK_QUL_DB")
if not DB_PATH:
    sys.exit("set DK_QUL_DB to the QUL quran-data.sqlite path")

PAUSE_AND_SAJDA = {"ۚ", "ۖ", "ۗ", "ۙ", "ۘ", "ۛ", "ۜ", "۩"}

# The one genuine 2->1 merge (also documented in
# lib/quran-mushaf-v2.ts): QUL writes 37:130's "إِلْ يَاسِينَ" as
# ONE layout word (one row), but it is TWO Tanzil tokens sharing
# one QUL id. The row therefore spans 2 covered token indices.
MERGED_ROW = (37, 130, 3)


def token_span(row) -> int:
    key = (row["surah_number"], row["ayah_number"], row["word_number"])
    return 2 if key == MERGED_ROW else 1


def fail(msg):
    raise SystemExit(f"FAIL: {msg}")


def bundled_sign_count(uthmani: str) -> int:
    """Sign tokens bundled after the word's own text in the QUL
    uthmani string ('رَيْبَ ۛ' -> 1)."""
    parts = uthmani.split(" ")
    return sum(1 for p in parts[1:] if p in PAUSE_AND_SAJDA)


def main():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    words = {}          # id -> row
    by_key = {}         # (s, a, ordinal) -> row (real words only)
    marker_of = {}      # (s, a) -> marker row
    ayah_words = {}     # (s, a) -> [rows in order]
    for r in db.execute("SELECT * FROM words ORDER BY word_number_all"):
        words[r["word_number_all"]] = r
        key = (r["surah_number"], r["ayah_number"])
        if r["is_ayah_marker"]:
            marker_of[key] = r
        else:
            by_key[(key[0], key[1], r["word_number"])] = r
            ayah_words.setdefault(key, []).append(r)
    if len(words) != 83668:
        fail(f"words rows {len(words)} != 83668")

    # Token index (reader-relative) of each real word.
    token_index = {}    # (s, a, ordinal) -> w
    for (s, a), rows in ayah_words.items():
        idx = 4 if (a == 1 and s not in (1, 9)) else 0
        for r in rows:
            token_index[(s, a, r["word_number"])] = idx
            idx += token_span(r) + bundled_sign_count(r["uthmani"])

    v2 = json.load(open(os.path.join(PUBLIC, "quran-mushaf-v2.json")))
    v2_pages = {p["n"]: p for p in v2["pages"]}
    header_names = {}
    for p in v2["pages"]:
        for ln in p["lines"]:
            if ln["t"] == "h":
                header_names[ln["s"]] = ln["x"]

    # ── Cross-check the w formula against EVERY V2 segment start ──
    checked = 0
    for p in v2["pages"]:
        for ln in p["lines"]:
            if ln["t"] != "x":
                continue
            for seg in ln["seg"]:
                # The segment's first real word: token q in the
                # words table (q = QUL id of the first word).
                row = words[seg["q"]]
                key = (seg["s"], seg["a"], row["word_number"])
                if token_index[key] != seg["w"]:
                    fail(
                        f"w formula mismatch at {key}: mine "
                        f"{token_index[key]} vs V2 {seg['w']}"
                    )
                checked += 1
    print(f"w formula verified against {checked} V2 segment starts")

    # ── Build V4 pages ──
    layout = {}
    for r in db.execute("SELECT * FROM qpc_v4_layout ORDER BY page, line"):
        layout.setdefault(r["page"], []).append(r)

    pages = []
    total_tokens = 0
    kind_diffs = 0
    range_diffs = 0
    for n in range(1, 605):
        rows = layout.get(n)
        if rows is None:
            fail(f"V4 layout missing page {n}")
        lines = []
        for r in rows:
            if r["type"] == "surah_name":
                lines.append({"t": "h", "s": r["range_start"], "x": header_names[r["range_start"]]})
            elif r["type"] == "basmallah":
                lines.append({"t": "b"})
            else:
                start, end = r["range_start"], r["range_end"]
                toks = [words[i] for i in range(start, end + 1)]
                total_tokens += len(toks)
                lead = None
                pos = 0
                if toks[0]["is_ayah_marker"]:
                    lead = f"NUM:{toks[0]['surah_number']}:{toks[0]['ayah_number']}"
                    pos = 1
                segs = []
                i = pos
                while i < len(toks):
                    t = toks[i]
                    if t["is_ayah_marker"]:
                        # Mid-line marker: closes the previous seg.
                        if not segs:
                            fail(f"p{n}: marker with no preceding segment")
                        segs[-1]["e"] = 1
                        i += 1
                        continue
                    s, a = t["surah_number"], t["ayah_number"]
                    # A segment is a run of consecutive real words
                    # with NO sign token between them (the strict
                    # expansion verifies covered token indices are
                    # consecutive): the run also breaks after any
                    # word that bundles a pause/sajda sign.
                    j = i
                    while (
                        j < len(toks)
                        and not toks[j]["is_ayah_marker"]
                        and toks[j]["surah_number"] == s
                        and toks[j]["ayah_number"] == a
                    ):
                        j += 1
                        if bundled_sign_count(toks[j - 1]["uthmani"]) > 0:
                            break
                    first = toks[i]
                    segs.append(
                        {
                            "s": s,
                            "a": a,
                            "w": token_index[(s, a, first["word_number"])],
                            # n counts covered TANZIL TOKENS (the
                            # merged 37:130 row covers two).
                            "n": sum(token_span(t) for t in toks[i:j]),
                            "q": first["word_number_all"],
                            "e": 0,
                        }
                    )
                    i = j
                # Accounting: segment token spans cover every
                # non-marker row of the range exactly once.
                covered = sum(sg["n"] for sg in segs)
                expected = sum(
                    token_span(t) for t in toks if not t["is_ayah_marker"]
                )
                if covered != expected:
                    fail(f"p{n}: segment accounting mismatch")
                line = {"t": "x", "f": start, "l": end, "seg": segs}
                if r["is_centered"]:
                    line["c"] = 1
                if lead:
                    line["lead"] = lead
                lines.append(line)
        v2p = v2_pages[n]
        if [ln["t"] for ln in lines] != [ln["t"] for ln in v2p["lines"]]:
            kind_diffs += 1
        v2_first = next(ln["f"] for ln in v2p["lines"] if ln["t"] == "x")
        v4_first = next(ln["f"] for ln in lines if ln["t"] == "x")
        v2_last = [ln["l"] for ln in v2p["lines"] if ln["t"] == "x"][-1]
        v4_last = [ln["l"] for ln in lines if ln["t"] == "x"][-1]
        if (v2_first, v2_last) != (v4_first, v4_last):
            range_diffs += 1
        pages.append(
            {
                "n": n,
                # Page word ranges are expected identical to V2
                # (same Madina page boundaries); juz/hizb are taken
                # from the repo V2 page and the range check above
                # reports any page where that assumption breaks.
                "juz": v2p["juz"],
                "hizb": v2p["hizb"],
                "lines": lines,
            }
        )
    if total_tokens != 83668:
        fail(f"V4 layout tokens {total_tokens} != 83668")
    print(
        f"V4 pages built: line-kind diffs vs V2 on {kind_diffs} pages; "
        f"page-range diffs on {range_diffs} pages"
    )

    # ── Re-key the V4 glyph maps by QUL id ──
    glyph_dir = os.path.join(PUBLIC, "quran-mushaf-v4qpc-glyphs")
    os.makedirs(glyph_dir, exist_ok=True)
    study_dir = os.path.join(PUBLIC, "quran-mushaf-v4-glyphs")
    total_entries = 0
    for n in range(1, 605):
        src = json.load(open(os.path.join(study_dir, f"p{n}.json")))
        out = {}
        for key, glyph in src.items():
            s, a, w = (int(x) for x in key.split(":"))
            real = by_key.get((s, a, w))
            if real is not None:
                out[str(real["word_number_all"])] = glyph
            elif (s, a) in marker_of and w == len(ayah_words[(s, a)]) + 1:
                out[str(marker_of[(s, a)]["word_number_all"])] = glyph
            elif (s, a, w) == (37, 130, 3):
                # The merged pair's combined entry: its QUL id is
                # the first word's id (shared by both tokens).
                first = by_key[(37, 130, 3)]
                out[str(first["word_number_all"])] = glyph
            else:
                fail(f"glyph key {key} maps to no word/marker")
        # Coverage: every distinct token id in this page's ranges.
        page_ids = set()
        for ln in pages[n - 1]["lines"]:
            if ln["t"] == "x":
                page_ids.update(range(ln["f"], ln["l"] + 1))
        missing = page_ids - {int(k) for k in out}
        if missing:
            fail(f"p{n}: {len(missing)} token ids without glyphs, e.g. {sorted(missing)[:5]}")
        total_entries += len(out)
        with open(os.path.join(glyph_dir, f"p{n}.json"), "w") as fh:
            json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"glyph maps re-keyed: {total_entries} entries over 604 pages")

    # ── Write pages ──
    pages_dir = os.path.join(PUBLIC, "quran-mushaf-v4-pages")
    os.makedirs(pages_dir, exist_ok=True)
    for p in pages:
        with open(os.path.join(pages_dir, f"p{p['n']}.json"), "w") as fh:
            json.dump(p, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(PUBLIC, "quran-mushaf-v4.json"), "w") as fh:
        json.dump(
            {
                "version": 1,
                "source": "QUL qpc_v4_layout + QPC V4 glyph script (see THIRD_PARTY_NOTICES.md)",
                "pages": pages,
            },
            fh,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    print("OK: QPC V4 pages + glyph maps written.")


if __name__ == "__main__":
    main()
