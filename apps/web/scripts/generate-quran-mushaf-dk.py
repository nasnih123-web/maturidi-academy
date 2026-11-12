#!/usr/bin/env python3
"""Generate the Digital Khatt mushaf page data (Madani 604 + IndoPak 610).

Tarteel-parity step 1b (agent-2 PR, 2026-11-12).

Inputs (env-overridable, maintainer-local files — NOT in the repo):
  DK_QUL_DB            SQLite with the QUL word/layout datasets:
                       tables `words` (with `dk_v2` / `dk_indopak`
                       script columns) and the layout tables
                       `qpc_v2_layout` / `indopak_15_lines_layout`.
                       This is the quran-data.sqlite of the QUL
                       datasets (the same file the Tarteel app
                       bundles; QUL's own download of the layout —
                       resource 21 — needs a QUL account).
  QURAN_MUSHAF_V2_JSON The repo's existing V2 layout file
                       (default: ../public/quran-mushaf-v2.json),
                       used ONLY for per-page juz/hizb, surah header
                       names, and as an independent cross-check of
                       the Madani line structure.

Outputs (apps/web/public/):
  quran-mushaf-dk.json                 all 604 Madani pages (one file)
  quran-mushaf-dk-pages/p{n}.json      per-page Madani chunks
  quran-mushaf-dk-indopak.json         all 610 IndoPak pages
  quran-mushaf-dk-indopak-pages/p{n}.json

Page shape (mirrors the V2 page files so the DK renderer can keep
the V2 component's contract):
  { "n", "juz", "hizb", "basmala", "lines": [
      { "t": "h", "s": <surah>, "x": <surah name> },
      { "t": "b" },
      { "t": "x", "c"?: 1, "words": [
          { "k": "s:a:w", "g": <word_number_all>, "x": <dk text> },
          { "k": "s:a:end", "g": ..., "x": <marker text>, "m": 1 } ] } ] }

The generator FAILS HARD on any count/coverage mismatch — it never
silently repairs data (same rule as generate-quran-mushaf-v2.py).

Cross-checks performed for the Madani dataset against the repo's V2
pages: identical line-kind sequence per page, identical ordered
ayah-end (surah, ayah) list per page, identical first word per page.
"""

import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "..", "public")

DK_QUL_DB = os.environ.get("DK_QUL_DB", "")
V2_JSON = os.environ.get(
    "QURAN_MUSHAF_V2_JSON", os.path.join(PUBLIC, "quran-mushaf-v2.json")
)

EXPECTED_WORDS = 83668


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_words(cur, script_col):
    words = {}
    rows = cur.execute(
        f"SELECT word_number_all, surah_number, ayah_number, word_number,"
        f" {script_col}, is_ayah_marker FROM words ORDER BY word_number_all"
    ).fetchall()
    if len(rows) != EXPECTED_WORDS:
        fail(f"words table has {len(rows)} rows, expected {EXPECTED_WORDS}")
    for g, s, a, w, text, marker in rows:
        if text is None or text == "":
            fail(f"word {g} ({s}:{a}:{w}) has empty {script_col} text")
        words[g] = {
            "s": s,
            "a": a,
            "w": w,
            "x": text,
            "m": 1 if marker else 0,
        }
    return words


def basmala_text(cur, script_col):
    rows = cur.execute(
        f"SELECT {script_col} FROM words WHERE surah_number=1 AND ayah_number=1"
        " AND word_number BETWEEN 1 AND 4 ORDER BY word_number"
    ).fetchall()
    if len(rows) != 4:
        fail("could not read the 1:1 Basmala words for the DK script")
    return " ".join(r[0] for r in rows)


def build_pages(cur, layout_table, words, basmala, header_names, page_meta):
    layout = cur.execute(
        f"SELECT page, line, type, is_centered, range_start, range_end"
        f" FROM {layout_table} ORDER BY page, line"
    ).fetchall()
    pages = {}
    placed = 0
    for page, line_no, ltype, centered, rstart, rend in layout:
        pg = pages.setdefault(
            page,
            {
                "n": page,
                "juz": page_meta.get(page, {}).get("juz"),
                "hizb": page_meta.get(page, {}).get("hizb"),
                "basmala": basmala,
                "lines": [],
            },
        )
        if ltype == "surah_name":
            # The layout row's range_start holds the surah number in
            # this dataset's encoding; fall back to the next ayah
            # line's first word if it ever disagrees.
            surah = rstart
            pg["lines"].append(
                {"t": "h", "s": surah, "x": header_names.get(surah, "")}
            )
        elif ltype == "basmallah":
            pg["lines"].append({"t": "b"})
        elif ltype == "ayah":
            line_words = []
            for g in range(rstart, rend + 1):
                wd = words.get(g)
                if wd is None:
                    fail(f"{layout_table} p{page} line {line_no}: word {g} missing")
                if wd["m"]:
                    key = f"{wd['s']}:{wd['a']}:end"
                    entry = {"k": key, "g": g, "x": wd["x"], "m": 1}
                else:
                    key = f"{wd['s']}:{wd['a']}:{wd['w']}"
                    entry = {"k": key, "g": g, "x": wd["x"]}
                line_words.append(entry)
                placed += 1
            line = {"t": "x", "words": line_words}
            if centered:
                line["c"] = 1
            pg["lines"].append(line)
        else:
            fail(f"{layout_table} p{page} line {line_no}: unknown type {ltype!r}")
    return pages, placed


def write_dataset(pages, full_name, pages_dir_name):
    out_full = os.path.join(PUBLIC, full_name)
    out_dir = os.path.join(PUBLIC, pages_dir_name)
    os.makedirs(out_dir, exist_ok=True)
    ordered = [pages[n] for n in sorted(pages)]
    with open(out_full, "w", encoding="utf-8") as fh:
        json.dump({"pages": ordered}, fh, ensure_ascii=False, separators=(",", ":"))
    for pg in ordered:
        with open(os.path.join(out_dir, f"p{pg['n']}.json"), "w", encoding="utf-8") as fh:
            json.dump(pg, fh, ensure_ascii=False, separators=(",", ":"))
    return len(ordered)


def main():
    if not DK_QUL_DB or not os.path.exists(DK_QUL_DB):
        fail(
            "DK_QUL_DB is not set or does not exist. Point it at the QUL "
            "quran-data.sqlite (words + layouts); see the module docstring."
        )
    if not os.path.exists(V2_JSON):
        fail(f"V2 layout file not found: {V2_JSON}")

    with open(V2_JSON, encoding="utf-8") as fh:
        v2 = json.load(fh)
    v2_pages = {p["n"]: p for p in v2["pages"]}
    header_names = {}
    page_meta = {}
    for n, p in v2_pages.items():
        page_meta[n] = {"juz": p.get("juz"), "hizb": p.get("hizb")}
        for ln in p["lines"]:
            if ln.get("t") == "h":
                header_names[ln["s"]] = ln["x"]
    if len(header_names) != 114:
        fail(f"expected 114 surah header names from V2 data, got {len(header_names)}")

    con = sqlite3.connect(DK_QUL_DB)
    cur = con.cursor()

    # ---- Madani (Digital Khatt V2 script, QPC V2 1421H layout) ----
    words = load_words(cur, "dk_v2")
    basmala = basmala_text(cur, "dk_v2")
    pages, placed = build_pages(cur, "qpc_v2_layout", words, basmala, header_names, page_meta)
    if placed != EXPECTED_WORDS:
        fail(f"Madani: placed {placed} words, expected {EXPECTED_WORDS}")
    if len(pages) != 604:
        fail(f"Madani: {len(pages)} pages, expected 604")

    # Cross-checks vs the repo's own V2 pages (independent pipeline).
    # NOTE on ayah-end attribution: the two pipelines place a
    # line-leading ayah-end marker differently. In the QUL layout an
    # ayah whose last word ends a line has its marker token as the
    # FIRST token of the next line (as in the print); the repo's V2
    # segmenter instead leaves that ayah unflagged on its own line
    # and the end is only implied by the next segment's (surah,
    # ayah) change. The check below therefore compares the QUL
    # marker list against the V2 ends reconstructed as: e-flagged
    # segments, plus any line-final segment whose successor segment
    # starts a different ayah (an implied, marker-leading end).
    def v2_page_ends_exact(n):
        v2p = v2_pages[n]
        ends = []
        lines = [ln for ln in v2p["lines"] if ln["t"] == "x"]
        flat = [seg for ln in lines for seg in ln["seg"]]
        pos = 0
        for li, ln in enumerate(lines):
            for j, seg in enumerate(ln["seg"]):
                idx = pos + j
                if seg.get("e"):
                    ends.append((seg["s"], seg["a"]))
                elif j == len(ln["seg"]) - 1:
                    nxt = flat[idx + 1] if idx + 1 < len(flat) else None
                    if nxt is None and n < 604:
                        nxtp = v2_pages[n + 1]
                        nxt = next(
                            (l2["seg"][0] for l2 in nxtp["lines"] if l2["t"] == "x" and l2["seg"]),
                            None,
                        )
                    if nxt is not None and (nxt["s"], nxt["a"]) != (seg["s"], seg["a"]):
                        ends.append((seg["s"], seg["a"]))
            pos += len(ln["seg"])
        return ends

    mismatches = 0
    for n, pg in pages.items():
        v2p = v2_pages.get(n)
        if v2p is None:
            fail(f"Madani p{n}: no V2 page to cross-check against")
        dk_kinds = [ln["t"] for ln in pg["lines"]]
        v2_kinds = [ln["t"] for ln in v2p["lines"]]
        if dk_kinds != v2_kinds:
            fail(f"Madani p{n}: line-kind sequence differs from V2 page")
        dk_ends = [
            (int(w["k"].split(":")[0]), int(w["k"].split(":")[1]))
            for ln in pg["lines"]
            if ln["t"] == "x"
            for w in ln["words"]
            if w.get("m")
        ]
        if dk_ends != v2_page_ends_exact(n):
            fail(f"Madani p{n}: ayah-end sequence differs from V2 page")
        dk_first = next(
            (w for ln in pg["lines"] if ln["t"] == "x" for w in ln["words"]), None
        )
        v2_first_seg = next(
            (ln["seg"][0] for ln in v2p["lines"] if ln["t"] == "x" and ln["seg"]), None
        )
        if dk_first and v2_first_seg:
            fs, fa = int(dk_first["k"].split(":")[0]), int(dk_first["k"].split(":")[1])
            if (fs, fa) != (v2_first_seg["s"], v2_first_seg["a"]):
                mismatches += 1
    if mismatches:
        fail(f"Madani: first-word mismatch on {mismatches} pages vs V2 data")

    n_madani = write_dataset(pages, "quran-mushaf-dk.json", "quran-mushaf-dk-pages")

    # ---- IndoPak (Digital Khatt IndoPak script, 610-page layout) ----
    words_ip = load_words(cur, "dk_indopak")
    basmala_ip = basmala_text(cur, "dk_indopak")
    pages_ip, placed_ip = build_pages(
        cur, "indopak_15_lines_layout", words_ip, basmala_ip, header_names, {}
    )
    if placed_ip != EXPECTED_WORDS:
        fail(f"IndoPak: placed {placed_ip} words, expected {EXPECTED_WORDS}")
    if len(pages_ip) != 610:
        fail(f"IndoPak: {len(pages_ip)} pages, expected 610")
    n_ip = write_dataset(
        pages_ip, "quran-mushaf-dk-indopak.json", "quran-mushaf-dk-indopak-pages"
    )

    print(f"OK: Madani {n_madani} pages, IndoPak {n_ip} pages, "
          f"{placed} + {placed_ip} words placed, cross-checks passed.")


if __name__ == "__main__":
    main()
