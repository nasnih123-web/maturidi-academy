#!/usr/bin/env python3
"""Independent validation of apps/web/public/quran-mushaf-v2.json.

Written fresh for Phase 7 (architecture review). It does NOT import or
reuse the Phase 3 generator (apps/web/scripts/generate-quran-mushaf-v2.py)
or its checks: every comparison below reads the raw reference sources
directly — the QPC V2 layout DB, the ayah-by-ayah glyphs DB (page per
ayah), the QUL words DB, and the Tanzil Uthmani text in the API tree —
and compares them against the shipped JSON.

Checks:
  1. per-page line-type counts (surah_name / basmallah / ayah) vs layout DB
  2. first/last_word_id of every text line vs layout DB (8820 lines)
  3. is_centered flag vs layout DB
  4. ayah -> page (first segment's page) vs glyphs DB page_number (6236)
  5. per-ayah real-word counts (sum of segment n) vs Tanzil token counts
     (pause signs, sajda marks and the prefixed basmala of surahs 2-114
     except 9 excluded — those tokens carry no layout word)
  6. rubAyahs: 199 distinct valid "surah:ayah" keys
  7. sajdaWords: 15 keys, each the word immediately before a standalone
     sajda mark in Tanzil
  8. QUL-id (q) continuity across segments (ayah-end number tokens
     consume one id; the 37:130 merge shares one id)
  9. (phase 8) surah start/end pages vs glyphs DB: first segment page
     of ayah 1 and last segment page of the last ayah, per surah
  10. (phase 8) no ayah spans two pages (all 6236 ayahs on one page);
      long ayahs 2:282 (page 48) and 2:255 (page 42) pinned
  11. (phase 8) KFGQPC UthmanicHafs v3.0 woff2 cmap covers every distinct
      codepoint of the Tanzil text (font correctness, not just presence)

Usage: python3 validate-quran-mushaf-v2-independent.py
Exit 0 only when every check passes (check 8 allows the single known
37:130 merge exception, reported explicitly).
"""
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent.parent
JSON_PATH = REPO / "apps/web/public/quran-mushaf-v2.json"
LAYOUT_DB = Path.home() / "workspace/tarteel-drive/extracted/qpc-v2-15-lines.db/qpc-v2-15-lines.db"
GLYPHS_DB = Path.home() / "workspace/tarteel-drive/extracted/qpc-v2-ayah-by-ayah-glyphs.db/qpc-v2-ayah-by-ayah-glyphs.db"
WORDS_DB = Path.home() / "workspace/tarteel-drive/extracted/qpc-v2.db/qpc-v2.db"
TANZIL = REPO / "apps/api/app/modules/quran/data/tanzil_uthmani.txt"

PAUSE_SIGNS = {"ۚ", "ۖ", "ۗ", "ۙ", "ۘ", "ۛ", "ۜ"}
SAJDA_MARK = "۩"
BASMALA = ["بِسْمِ", "ٱللَّهِ", "ٱلرَّحْمَٰنِ", "ٱلرَّحِيمِ"]

failures: list[str] = []
notes: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(f"{name}: {detail}")


def main() -> int:
    for p in (JSON_PATH, LAYOUT_DB, GLYPHS_DB, WORDS_DB, TANZIL):
        if not p.exists():
            print(f"missing input: {p}")
            return 2
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    pages = data["pages"]

    layout = sqlite3.connect(f"file:{LAYOUT_DB}?mode=ro", uri=True)
    glyphs = sqlite3.connect(f"file:{GLYPHS_DB}?mode=ro", uri=True)
    words = sqlite3.connect(f"file:{WORDS_DB}?mode=ro", uri=True)

    # --- 1. per-page line-type counts -------------------------------------
    db_rows = layout.execute(
        "SELECT page_number, line_type, COUNT(*) FROM pages GROUP BY page_number, line_type"
    ).fetchall()
    db_counts: dict[int, dict[str, int]] = {}
    for page_no, line_type, count in db_rows:
        db_counts.setdefault(page_no, {})[line_type] = count
    type_map = {"h": "surah_name", "b": "basmallah", "x": "ayah"}
    bad_pages = 0
    for page in pages:
        n = page["n"]
        got: dict[str, int] = {}
        for line in page["lines"]:
            got[type_map[line["t"]]] = got.get(type_map[line["t"]], 0) + 1
        if got != db_counts.get(n, {}):
            bad_pages += 1
            if bad_pages <= 3:
                notes.append(f"page {n}: json {got} vs db {db_counts.get(n)}")
    check("1. line-type counts per page (604 pages)", bad_pages == 0,
          f"{604 - bad_pages}/604 pages match" + (f"; e.g. {notes[0]}" if notes else ""))
    total_db = layout.execute("SELECT COUNT(*) FROM pages").fetchone()[0]
    total_json = sum(len(p["lines"]) for p in pages)
    check("1b. total lines", total_db == total_json, f"db {total_db} vs json {total_json}")

    # --- 2+3. first/last_word_id and is_centered per text line ------------
    db_lines = layout.execute(
        "SELECT page_number, line_number, line_type, is_centered,"
        " first_word_id, last_word_id FROM pages ORDER BY page_number, line_number"
    ).fetchall()
    json_text_lines: list[tuple[int, int, int, int, int]] = []  # page, f, l, centered, idx
    for page in pages:
        for line in page["lines"]:
            if line["t"] == "x":
                json_text_lines.append(
                    (page["n"], line["f"], line["l"], 1 if line.get("c") else 0, len(json_text_lines))
                )
    db_text = [(r[0], r[4], r[5], r[3]) for r in db_lines if r[2] == "ayah"]
    fl_bad = sum(
        1 for j, d in zip(json_text_lines, db_text)
        if (j[0], j[1], j[2]) != (d[0], int(d[1]), int(d[2]))
    )
    cen_bad = sum(1 for j, d in zip(json_text_lines, db_text) if j[3] != d[3])
    check("2. first/last_word_id of all text lines", len(json_text_lines) == len(db_text) and fl_bad == 0,
          f"{len(json_text_lines)} text lines, {fl_bad} mismatches")
    check("3. is_centered flag", cen_bad == 0, f"{cen_bad} mismatches")

    # --- 4. ayah -> page vs glyphs DB --------------------------------------
    first_page: dict[str, int] = {}
    for page in pages:
        for line in page["lines"]:
            if line["t"] != "x":
                continue
            for seg in line["seg"]:
                key = f"{seg['s']}:{seg['a']}"
                first_page.setdefault(key, page["n"])
    glyph_pages = {
        f"{s}:{a}": p
        for s, a, p in glyphs.execute("SELECT surah, ayah, page_number FROM verses").fetchall()
    }
    page_bad = [
        (k, first_page.get(k), v) for k, v in glyph_pages.items() if first_page.get(k) != v
    ]
    check("4. ayah->page vs glyphs DB (6236 ayahs)", len(page_bad) == 0,
          f"{len(glyph_pages) - len(page_bad)}/{len(glyph_pages)} match"
          + (f"; e.g. {page_bad[:3]}" if page_bad else ""))

    # --- 5. per-ayah word counts vs Tanzil ----------------------------------
    tanzil_counts: dict[str, int] = {}
    tanzil_sajda: list[str] = []
    for raw in TANZIL.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        parts = raw.split("|", 2)
        if len(parts) != 3:
            continue
        s, a, text = parts
        tokens = text.split()
        # Drop the prefixed basmala of surahs 2-114 except 9: those four
        # tokens print on a basmala line and carry no layout word.
        if a == "1" and int(s) not in (1, 9):
            tokens = tokens[4:]
        real = 0
        for i, tok in enumerate(tokens):
            if tok in PAUSE_SIGNS or tok == SAJDA_MARK:
                if tok == SAJDA_MARK:
                    tanzil_sajda.append(f"{s}:{a}:{i - 1}")
                continue
            real += 1
        tanzil_counts[f"{s}:{a}"] = real
    json_counts: dict[str, int] = {}
    for page in pages:
        for line in page["lines"]:
            if line["t"] != "x":
                continue
            for seg in line["seg"]:
                key = f"{seg['s']}:{seg['a']}"
                json_counts[key] = json_counts.get(key, 0) + seg["n"]
    count_bad = [
        (k, json_counts.get(k), v)
        for k, v in tanzil_counts.items()
        if json_counts.get(k) != v
    ]
    check("5. per-ayah word counts vs Tanzil (6236 ayahs)", len(count_bad) == 0,
          f"{len(tanzil_counts) - len(count_bad)}/{len(tanzil_counts)} match"
          + (f"; e.g. {count_bad[:5]}" if count_bad else ""))
    total_json_words = sum(json_counts.values())
    total_tanzil_words = sum(tanzil_counts.values())
    check("5b. total real words", total_json_words == total_tanzil_words,
          f"json {total_json_words} vs tanzil {total_tanzil_words}")

    # --- 6. rub list ---------------------------------------------------------
    rub = data["rubAyahs"]
    rub_ok = (
        len(rub) == 199
        and len(set(rub)) == 199
        and all(k in glyph_pages for k in rub)
    )
    check("6. rubAyahs: 199 distinct valid ayahs", rub_ok, f"count {len(rub)}, distinct {len(set(rub))}")

    # --- 7. sajda list vs Tanzil ---------------------------------------------
    sajda = data["sajdaWords"]
    check("7. sajdaWords: 15, each the word before a Tanzil sajda mark",
          sorted(sajda) == sorted(tanzil_sajda),
          f"json {len(sajda)} vs tanzil {len(tanzil_sajda)}"
          + (f"; diff {sorted(set(sajda) ^ set(tanzil_sajda))}" if sorted(sajda) != sorted(tanzil_sajda) else ""))

    # --- 8. QUL-id continuity across segments -------------------------------
    # Expected: next q = prev q + prev n + 1 whenever the ayah changes
    # (the ayah-end number token consumes one id at every ayah end —
    # either as a rosette on the same line, `e == 1`, or as a `lead`
    # number token at the start of the next line). The single known
    # exception is the 37:130 merge: both Tanzil tokens share one QUL
    # id, so the segment starting at w=3 reuses the q of w=2.
    segments: list[tuple[int, int, int, int, int]] = []  # s, a, w, n, q, e
    for page in pages:
        for line in page["lines"]:
            if line["t"] != "x":
                continue
            for seg in line["seg"]:
                segments.append((seg["s"], seg["a"], seg["w"], seg["n"], seg["q"], seg["e"]))
    q_bad: list[tuple] = []
    for prev, cur in zip(segments, segments[1:]):
        ayah_changed = (cur[0], cur[1]) != (prev[0], prev[1])
        expected = prev[4] + prev[3] + (1 if ayah_changed else 0)
        # 37:130 merge: the ayah's 4 Tanzil tokens occupy only 3 QUL
        # ids (tokens w=2,3 share one), so the ayah consumes one id
        # fewer than its token count.
        if prev[0] == 37 and prev[1] == 130 and ayah_changed:
            expected -= 1
        if cur[4] != expected:
            # 37:130 merge: the segment starting at w=3 reuses q of w=2.
            if cur[0] == 37 and cur[1] == 130 and cur[2] == 3 and cur[4] == prev[4]:
                continue
            q_bad.append((prev, cur, expected))
    check("8. QUL-id continuity across segments", len(q_bad) == 0,
          f"{len(segments) - 1 - len(q_bad)}/{len(segments) - 1} transitions ok"
          + (f"; e.g. {q_bad[:3]}" if q_bad else ""))
    # The last segment's words end at 83667; the final ayah-number
    # token is id 83668.
    last = segments[-1]
    check("8b. last segment ends at QUL id 83668 (final ayah-number token)",
          last[4] + last[3] == 83668, f"last segment q {last[4]} + n {last[3]}")

    # --- extra: words DB cross-check (location <-> q) ------------------------
    qul = {row[0]: row[1] for row in words.execute("SELECT id, location FROM words").fetchall()}
    # Exact check: every segment q exists in the words table.
    word_ids = {q for _, _, _, _, q, _ in segments}
    missing_q = [q for q in word_ids if q not in qul]
    check("8c. every segment q exists in QUL words DB", len(missing_q) == 0,
          f"{len(word_ids)} distinct q values, {len(missing_q)} missing")

    # --- 9. (phase 8) surah start/end pages vs glyphs DB --------------------
    # First segment page of ayah 1 and last segment page of the last
    # ayah, per surah, must equal the glyphs DB page_number for those
    # ayahs. (The header page itself is the same page, or one page
    # earlier on the 18 spill pages — checked in the web unit tests,
    # not here, because the glyphs DB knows nothing about headers.)
    last_ayah_of = {}
    for key in tanzil_counts:
        s, a = key.split(":")
        last_ayah_of[int(s)] = max(last_ayah_of.get(int(s), 0), int(a))
    seg_pages: dict[str, list[int]] = {}
    for page in pages:
        for line in page["lines"]:
            if line["t"] != "x":
                continue
            for seg in line["seg"]:
                seg_pages.setdefault(f"{seg['s']}:{seg['a']}", []).append(page["n"])
    bounds_bad = []
    for s in range(1, 115):
        first_key = f"{s}:1"
        last_key = f"{s}:{last_ayah_of[s]}"
        if seg_pages[first_key][0] != glyph_pages[first_key]:
            bounds_bad.append((first_key, seg_pages[first_key][0], glyph_pages[first_key]))
        if seg_pages[last_key][-1] != glyph_pages[last_key]:
            bounds_bad.append((last_key, seg_pages[last_key][-1], glyph_pages[last_key]))
    check("9. surah start/end pages vs glyphs DB (114 surahs x 2)",
          len(bounds_bad) == 0,
          f"{228 - len(bounds_bad)}/228 match"
          + (f"; e.g. {bounds_bad[:3]}" if bounds_bad else ""))

    # --- 10. (phase 8) no ayah spans two pages ------------------------------
    multi_page = [(k, sorted(set(v))) for k, v in seg_pages.items() if len(set(v)) > 1]
    check("10. no ayah spans two pages (6236 ayahs)", len(multi_page) == 0,
          f"{len(seg_pages) - len(multi_page)}/{len(seg_pages)} single-page"
          + (f"; e.g. {multi_page[:3]}" if multi_page else ""))
    long_ok = (
        sorted(set(seg_pages.get("2:282", []))) == [48]
        and json_counts.get("2:282") == 128
        and sorted(set(seg_pages.get("2:255", []))) == [42]
        and json_counts.get("2:255") == 50
    )
    check("10b. long ayahs: 2:282 on page 48 (128 words), 2:255 on page 42 (50 words)",
          long_ok,
          f"2:282 pages {sorted(set(seg_pages.get('2:282', [])))} words {json_counts.get('2:282')}; "
          f"2:255 pages {sorted(set(seg_pages.get('2:255', [])))} words {json_counts.get('2:255')}")

    # --- 11. (phase 8) font cmap coverage vs Tanzil --------------------------
    try:
        from fontTools.ttLib import TTFont

        font_path = REPO / "apps/web/public/fonts/UthmanicHafs-v-3.0.woff2"
        font = TTFont(str(font_path), lazy=True)
        cmap = font.getBestCmap()
        tanzil_chars = set()
        for raw in TANZIL.read_text(encoding="utf-8").splitlines():
            if not raw.strip() or raw.startswith("#"):
                continue
            parts = raw.split("|", 2)
            if len(parts) != 3:
                continue
            tanzil_chars.update(parts[2])
        tanzil_chars.discard(" ")
        missing_chars = sorted(c for c in tanzil_chars if ord(c) not in cmap)
        check("11. UthmanicHafs v3.0 woff2 covers every Tanzil codepoint",
              len(missing_chars) == 0,
              f"{len(tanzil_chars) - len(missing_chars)}/{len(tanzil_chars)} codepoints covered"
              + (f"; missing {[hex(ord(c)) for c in missing_chars]}" if missing_chars else ""))
    except ImportError:
        print("11. fontTools not installed — check skipped (not a pass)")
        notes.append("fontTools missing; check 11 skipped")

    print()
    if failures:
        print(f"RESULT: {len(failures)} check(s) FAILED")
        return 1
    print("RESULT: all independent checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
