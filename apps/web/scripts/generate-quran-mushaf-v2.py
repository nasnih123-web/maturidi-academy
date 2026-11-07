#!/usr/bin/env python3
"""Generate apps/web/public/quran-mushaf-v2.json — the real 604-page, 15-line
Madani (QPC V2, 1421H) mushaf layout with word-level Tanzil mapping.

WHAT THIS IS (read before regenerating)
----------------------------------------
The output is a *layout* file, not a text file:

* Line/page breaks, line types (surah header / basmala / text),
  ``is_centered`` and the first/last QUL word id of every text line
  come from the QPC V2 15-line layout (``qpc-v2-15-lines.db``).
  Layouts are the one QUL category with a clear bundling permission:
  TarteelAI/quranic-universal-library issue #596 (maintainer, closed
  2026-05-06): "All layouts, including Madinah V2, are available for
  free and can be used in both personal and commercial projects...
  bundle the SQLite in your app, use it offline, modify it, or
  transform it into other formats as needed."
* The WORDS on those lines are Tanzil Uthmani v1.1 (CC BY 3.0,
  already in the repo at apps/api/.../tanzil_uthmani.txt). The file
  stores, per line, runs of Tanzil words as ``(surah, ayah,
  tanzil-token-index, count, first-qul-id)`` — i.e. WHERE each Tanzil
  word sits in the print, not the word text itself.
* The QPC V2 *glyph script* (PUA ligatures, QUL #61) and the 604
  per-page QPC V2 *fonts* (QUL #249) are NOT used here: their licence
  is undetermined (no licence section on their QUL source pages), so
  bundling them is forbidden until written permission exists. The
  renderer therefore shows licensed Tanzil text in the licensed
  KFGQPC Uthmanic font, positioned word-by-word per the V2 layout.
  The layout (breaks, order, positions) is V2-exact; the glyph codes
  are the unlicensed part and are NOT used. If the QUL glyph licence
  is ever determined, only the word *text source* changes (glyph
  strings instead of Tanzil strings) — the layout file, the segment
  structure and the QUL ids stay identical, because the word-id
  scheme is shared (validated: qpc-v2.db and
  qpc-hafs-word-by-word.db have identical id/location tables).

WORD-ID MAPPING (the hard part, solved with data)
-------------------------------------------------
QUL numbers words 1..83,668 sequentially in mushaf order, counting
one extra token per ayah: the ayah-end number itself (e.g. 1:1:5 is
the digit "١"). Tanzil whitespace-splits to 82,260 tokens, which
differs for two systematic reasons, both proven in the Phase 3
analysis (see docs/quran/hifz-redesign-phase3-notes.md):

1. Tanzil prefixes the Basmalah (4 tokens) to ayah 1 of every surah
   except 1 and 9; the print puts it on its own basmala line and it
   takes no QUL id. (Surahs 95 and 97 spell the first token
   "بِّسْمِ" with a shadda — handled explicitly.)
2. Tanzil has 4,364 standalone pause-sign tokens (ۚ ۖ ۗ ۙ ۘ ۛ ۜ)
   and 15 standalone sajda marks (۩); the print attaches them to the
   neighbouring word, so they take no QUL id either.

After removing exactly those, the token streams align 1:1 in order
for 6,234 of 6,236 ayahs. The two residuals:

* (2,72): same word, different hamza spelling (Tanzil
  "فَٱدَّٰرَْٰٔتُمْ" vs QUL "فَٱدَّٰرَٰءۡتُمۡ") — a normalisation
  artefact, counts equal, 1:1 mapping holds.
* (37,130): QUL writes "إِلْ يَاسِينَ" as ONE layout word; Tanzil
  has two tokens. Both Tanzil tokens share the one QUL id
  (documented in MERGED_WORDS below); the renderer keys words by
  "surah:ayah:word" so no collision occurs in the app.

Rub el hizb (۞, 199): NOT in Tanzil (it was downloaded with
rub-el-hizb signs off). The 199 ayahs carrying it are derived from
the already-bundled quran-mushaf-lines.json (its line texts contain
199 standalone ۞ tokens) and cross-checked against the QUL word
list when --validate-words-db is given. The ornament is stored as a
list of "surah:ayah" — layout positions only, no QUL text.

Sajda marks (۩, 15): derived from Tanzil itself (15 standalone ۩
tokens; the sajda word is the preceding word of the same ayah) and
cross-checked the same way.

USAGE
-----
  python3 apps/web/scripts/generate-quran-mushaf-v2.py [--check-only]

Inputs (env-overridable; defaults assume the repo root as cwd):
  QPC_V2_LAYOUT_DB   validated Drive copy of qpc-v2-15-lines.db
  TANZIL_TEXT        apps/api/app/modules/quran/data/tanzil_uthmani.txt
  QURAN_MUSHAF_LINES_JSON  apps/web/lib/quran-mushaf-lines.json (rub
                       ayahs + surah-header names + break comparison)
  QURAN_BOUNDARIES_JSON    apps/web/lib/quran-boundaries.json
  QUL_WORDS_DB       optional validation copy of
                     qpc-hafs-word-by-word.db (read-only cross-checks;
                     NEVER bundled — only counts/positions are read)
  OUT                apps/web/public/quran-mushaf-v2.json
                     (public/: the file is fetched + preloaded from the page
                     head since the hifz-completion performance work —
                     see lib/quran-mushaf-v2.ts)

The script FAILS (non-zero exit) on any inconsistency: page/line
counts, word-id gaps or overlaps, a word placed twice or never, a
per-ayah total that does not match Tanzil, a rub/sajda set that does
not match the validation DB. It never silently repairs data.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

LAYOUT_DB = Path(
    os.environ.get(
        "QPC_V2_LAYOUT_DB",
        "/home/hatch/workspace/tarteel-drive/extracted/qpc-v2-15-lines.db/qpc-v2-15-lines.db",
    )
)
TANZIL = Path(
    os.environ.get(
        "TANZIL_TEXT", REPO / "apps/api/app/modules/quran/data/tanzil_uthmani.txt"
    )
)
OLD_LINES = Path(
    os.environ.get(
        "QURAN_MUSHAF_LINES_JSON", REPO / "apps/web/lib/quran-mushaf-lines.json"
    )
)
BOUNDARIES = Path(
    os.environ.get(
        "QURAN_BOUNDARIES_JSON", REPO / "apps/web/lib/quran-boundaries.json"
    )
)
WORDS_DB = os.environ.get(
    "QUL_WORDS_DB",
    "/home/hatch/workspace/tarteel-drive/extracted/qpc-hafs-word-by-word.db/qpc-hafs-word-by-word.db",
)
AYAH_DB = os.environ.get(
    "QPC_V2_AYAH_DB",
    "/home/hatch/workspace/tarteel-drive/extracted/qpc-v2-ayah-by-ayah-glyphs.db/qpc-v2-ayah-by-ayah-glyphs.db",
)
OUT = Path(
    os.environ.get("OUT", REPO / "apps/web/public/quran-mushaf-v2.json")
)

# Standalone pause-sign tokens in Tanzil: ornaments, never words.
PAUSE_SIGNS = set("ۚۖۗۙۘۛۜ")
SAJDA_MARK = "۩"
# Tanzil tokens 0-3 of ayah 1 (surahs != 1, 9) are the Basmalah. The
# first token is "بِسْمِ", except surahs 95 and 97 ("بِّسْمِ").
BASMALAH_TAIL = ["ٱللَّهِ", "ٱلرَّحْمَـٰنِ", "ٱلرَّحِيمِ"]
# The ONE genuine 2->1 merge (see module docstring): both Tanzil
# tokens of 37:130 at indices 2 and 3 share a single QUL id.
# Key: (surah, ayah, second-token-index).
MERGED_WORDS = {(37, 130, 3)}
TOTAL_QUL_WORDS = 83668
TOTAL_PAGES = 604

failures: list[str] = []
warnings: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"FAIL: {msg}", file=sys.stderr)


# ---------------------------------------------------------------- Tanzil
def parse_tanzil(path: Path) -> dict[tuple[int, int], list[str]]:
    """surah:ayah -> whitespace-split tokens (verbatim, Basmalah kept)."""
    out: dict[tuple[int, int], list[str]] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        s, a, text = line.split("|", 2)
        out[(int(s), int(a))] = text.split()
    return out


def is_basmalah_prefix(surah: int, ayah: int, tokens: list[str]) -> bool:
    if surah in (1, 9) or ayah != 1 or len(tokens) < 4:
        return False
    first = tokens[0].replace("ّ", "")
    return first == "بِسْمِ" and tokens[1:4] == BASMALAH_TAIL


def real_words(
    surah: int, ayah: int, tokens: list[str]
) -> list[tuple[int, str]]:
    """(tanzil-token-index, text) of the ayah's real words.

    Drops the ayah-1 Basmalah prefix, standalone pause signs and the
    standalone sajda mark. A token that merely CONTAINS a pause/sajda
    sign inside a word (e.g. 2:245 "وَيَبْصُۜطُ") is a word.
    """
    start = 4 if is_basmalah_prefix(surah, ayah, tokens) else 0
    out = []
    for i in range(start, len(tokens)):
        tok = tokens[i]
        if tok in PAUSE_SIGNS or tok == SAJDA_MARK:
            continue
        out.append((i, tok))
    return out


def sajda_words(tanzil: dict[tuple[int, int], list[str]]) -> list[str]:
    """"surah:ayah:token-index" of the 15 printed sajda words."""
    out = []
    for (s, a), tokens in sorted(tanzil.items()):
        for i, tok in enumerate(tokens):
            if tok == SAJDA_MARK:
                # The sajda word is the last real word before the mark.
                prev = [j for j, _ in real_words(s, a, tokens) if j < i]
                if not prev:
                    fail(f"sajda mark in {s}:{a} has no preceding word")
                else:
                    out.append(f"{s}:{a}:{prev[-1]}")
    return out


# ------------------------------------------------------- QUL id assignment
def assign_qul_ids(
    tanzil: dict[tuple[int, int], list[str]],
) -> tuple[dict[int, list[tuple[int, int, int]] | str], dict[tuple[int, int], dict]]:
    """Walk ayahs in mushaf order; assign sequential QUL ids.

    Returns (by_qul_id, per_ayah) where by_qul_id maps an id to the
    list of (surah, ayah, tanzil-token-index) sharing it (normally
    one; two for the 37:130 merge) or "NUM:<s>:<a>" for an ayah-end
    number token, and per_ayah maps (s, a) to {"words":
    [(token-index, qul-id)], "num_q": id of the number}.
    """
    by_id: dict[int, list[tuple[int, int, int]] | str] = {}
    per_ayah: dict[tuple[int, int], dict] = {}
    nxt = 1
    for key in sorted(tanzil):
        s, a = key
        words = real_words(s, a, tanzil[key])
        entries: list[tuple[int, int]] = []
        prev_q: int | None = None
        for idx, _text in words:
            if (s, a, idx) in MERGED_WORDS and prev_q is not None:
                q = prev_q  # shares the previous word's QUL id
            else:
                q = nxt
                nxt += 1
            prev_q = q
            entries.append((idx, q))
            slot = by_id.setdefault(q, [])
            assert isinstance(slot, list)
            slot.append((s, a, idx))
        num_q = nxt
        nxt += 1
        by_id[num_q] = f"NUM:{s}:{a}"
        per_ayah[key] = {"words": entries, "num_q": num_q}
    if nxt - 1 != TOTAL_QUL_WORDS:
        fail(
            f"assigned {nxt - 1} QUL ids, expected {TOTAL_QUL_WORDS} "
            "(Tanzil/QUL tokenisation drift)"
        )
    return by_id, per_ayah


# ---------------------------------------------------------------- layout
def load_layout(db: Path) -> list[dict]:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        info = con.execute("SELECT * FROM info").fetchall()
        rows = con.execute(
            "SELECT page_number, line_number, line_type, is_centered,"
            " first_word_id, last_word_id, surah_number FROM pages"
            " ORDER BY page_number, line_number"
        ).fetchall()
    finally:
        con.close()
    print(f"layout info: {info}")
    return [
        {
            "page": r[0],
            "line": r[1],
            "type": r[2],
            "centered": int(r[3] or 0),
            "first": (int(r[4]) if str(r[4]).strip() != "" else None),
            "last": (int(r[5]) if str(r[5]).strip() != "" else None),
            "surah": (int(r[6]) if str(r[6]).strip() != "" else None),
        }
        for r in rows
    ]


def load_old_lines(path: Path) -> list:
    return json.loads(path.read_text(encoding="utf-8"))["pages"]


def rub_ayahs_from_old(pages: list) -> set[tuple[int, int]]:
    """(surah, ayah) whose printed line carries a standalone ۞."""
    out: set[tuple[int, int]] = set()
    arabic_indic = set("٠١٢٣٤٥٦٧٨٩")
    for page in pages:
        for line in page:
            if line.get("t") != "text" or not line.get("v"):
                continue
            s, a = (int(x) for x in line["v"].split(":"))
            for tok in (line.get("x") or "").split():
                if tok == "۞":
                    out.add((s, a))
                elif all(c in arabic_indic for c in tok):
                    a += 1
    return out


def page_juz_hizb(boundaries: dict, ref: tuple[int, int]) -> tuple[int | None, int | None]:
    """rangeContaining() rule: last boundary start at or before ref."""
    def find(lst: list[dict]) -> int | None:
        found = None
        for e in lst:
            if (e["surah"], e["ayah"]) <= ref:
                found = e["n"]
            else:
                break
        return found
    return find(boundaries["juz"]), find(boundaries["hizb"])


def build_pages(
    layout: list[dict],
    by_id: dict[int, list[tuple[int, int, int]] | str],
    per_ayah: dict[tuple[int, int], dict],
    old_pages: list,
    boundaries: dict,
) -> tuple[list[dict], list[str]]:
    """Build the V2 page structures; returns (pages, break-diffs)."""
    # Header names per SURAH (not per page): the old JSON's 114
    # header lines, in page order, are surahs 1..114. (Per-page
    # lookup is wrong: QPC1 and V2 place some surah starts on
    # different pages, e.g. V2 pages 587/591/595.)
    header_names: list[str] = []
    for page in old_pages:
        for ln in page:
            if ln.get("t") == "surah-header" and ln.get("x"):
                header_names.append(ln["x"])
    if len(header_names) != 114:
        fail(f"old JSON has {len(header_names)} surah headers, expected 114")
    header_surahs_seen: list[int] = []
    # Last ayah per old line, for the break comparison.
    break_diffs: list[str] = []
    pages_out: list[dict] = []
    seen_ids: set[int] = set()
    placed_words: set[tuple[int, int, int]] = set()
    by_page: dict[int, list[dict]] = {}
    for row in layout:
        by_page.setdefault(row["page"], []).append(row)
    if sorted(by_page) != list(range(1, TOTAL_PAGES + 1)):
        fail(f"layout pages are not exactly 1..{TOTAL_PAGES}")
    for pnum in range(1, TOTAL_PAGES + 1):
        rows = by_page[pnum]
        if [r["line"] for r in rows] != list(range(1, len(rows) + 1)):
            fail(f"page {pnum}: line numbers are not 1..{len(rows)}")
        if pnum in (1, 2):
            if len(rows) != 8:
                fail(f"page {pnum}: expected 8 lines, got {len(rows)}")
        elif len(rows) != 15:
            fail(f"page {pnum}: expected 15 lines, got {len(rows)}")
        lines_out: list[dict] = []
        last_ref: tuple[int, int] | None = None
        for row in rows:
            if row["type"] == "surah_name":
                if row["surah"] is None:
                    fail(f"page {pnum}: surah_name row without surah_number")
                    continue
                header_surahs_seen.append(row["surah"])
                name = (
                    header_names[row["surah"] - 1]
                    if 1 <= row["surah"] <= len(header_names)
                    else ""
                )
                if not name:
                    fail(f"page {pnum}: no header name for surah {row['surah']}")
                lines_out.append({"t": "h", "s": row["surah"], "x": name})
            elif row["type"] == "basmallah":
                lines_out.append({"t": "b"})
            elif row["type"] == "ayah":
                if row["first"] is None or row["last"] is None:
                    fail(f"page {pnum} line {row['line']}: ayah row without word ids")
                    continue
                f, l = row["first"], row["last"]
                if l < f:
                    fail(f"page {pnum} line {row['line']}: last < first ({f}..{l})")
                    continue
                ids = list(range(f, l + 1))
                overlap = seen_ids.intersection(ids)
                if overlap:
                    fail(f"page {pnum} line {row['line']}: ids reused: {sorted(overlap)[:5]}")
                seen_ids.update(ids)
                # Map ids to words; number tokens end their ayah.
                segments: list[dict] = []
                cur: dict | None = None
                lead_num: str | None = None
                for q in ids:
                    target = by_id.get(q)
                    if target is None:
                        fail(f"page {pnum}: QUL id {q} has no Tanzil word")
                        continue
                    if isinstance(target, str):
                        # Ayah-end number token.
                        if cur is not None:
                            cur["e"] = 1
                            segments.append(cur)
                            cur = None
                        else:
                            # Number token first in this line: it
                            # belongs to the previous line's last
                            # ayah; record it so the renderer can
                            # place the rosette at the line start.
                            lead_num = target
                        continue
                    for (s, a, w) in target:
                        last_ref = (s, a)
                        placed_words.add((s, a, w))
                        if cur is not None and (cur["s"], cur["a"]) == (s, a) and w == cur["w"] + cur["n"]:
                            cur["n"] += 1
                        else:
                            if cur is not None:
                                segments.append(cur)
                            cur = {"s": s, "a": a, "w": w, "n": 1, "q": q, "e": 0}
                if cur is not None:
                    segments.append(cur)
                line_obj: dict = {
                    "t": "x",
                    "f": f,
                    "l": l,
                    "seg": segments,
                }
                if row["centered"]:
                    line_obj["c"] = 1
                if lead_num:
                    line_obj["lead"] = lead_num
                lines_out.append(line_obj)
            else:
                fail(f"page {pnum} line {row['line']}: unknown type {row['type']!r}")
        # Break comparison vs the old (QPC1) line data. Lines are
        # compared by INDEX within the page, which is only meaningful
        # when the page's header/basmala skeleton matches; pages
        # whose skeleton differs (a surah starts on another page in
        # V2) are reported separately instead of inflating the count.
        old = old_pages[pnum - 1]
        old_skeleton = "".join(
            {"surah-header": "h", "basmala": "b", "text": "x"}.get(
                ln.get("t", "?"), "?"
            )
            for ln in old
        )
        new_skeleton = "".join(
            {"h": "h", "b": "b", "x": "x"}[ln["t"]] for ln in lines_out
        )
        if old_skeleton != new_skeleton:
            break_diffs.append(
                f"page {pnum}: SKELETON old={old_skeleton} v2={new_skeleton}"
            )
        elif len(old) != len(lines_out):
            break_diffs.append(
                f"page {pnum}: line count old={len(old)} v2={len(lines_out)}"
            )
        else:
            for i, (o, n) in enumerate(zip(old, lines_out), start=1):
                if o.get("t") == "text" and n.get("t") == "x":
                    ov = o.get("v")
                    ow = o.get("w")
                    nsegs = n["seg"]
                    nv = f"{nsegs[0]['s']}:{nsegs[0]['a']}" if nsegs else None
                    nw = f"{nsegs[-1]['s']}:{nsegs[-1]['a']}" if nsegs else None
                    if ov != nv or ow != nw:
                        break_diffs.append(
                            f"page {pnum} line {i}: old {ov}..{ow} vs v2 {nv}..{nw}"
                        )
        juz, hizb = page_juz_hizb(boundaries, last_ref or (1, 1))
        pages_out.append({"n": pnum, "juz": juz, "hizb": hizb, "lines": lines_out})
    # Global coverage checks.
    if header_surahs_seen != list(range(1, 115)):
        fail(f"surah headers are not 1..114 in order: {header_surahs_seen[:10]}...")
    if seen_ids != set(range(1, TOTAL_QUL_WORDS + 1)):
        missing = sorted(set(range(1, TOTAL_QUL_WORDS + 1)) - seen_ids)
        fail(f"word-id coverage: {len(missing)} ids never placed, first: {missing[:5]}")
    all_real = {
        (s, a, w) for (s, a), info in per_ayah.items() for (w, _q) in info["words"]
    }
    if placed_words != all_real:
        fail(
            f"word placement: placed {len(placed_words)} of {len(all_real)} real words; "
            f"missing {sorted(all_real - placed_words)[:5]}, "
            f"extra {sorted(placed_words - all_real)[:5]}"
        )
    return pages_out, break_diffs


def validate_against_words_db(
    db_path: str, per_ayah: dict, rub: set[tuple[int, int]], sajda: list[str]
) -> None:
    """Read-only cross-checks against the QUL word list (counts and
    positions only — no glyph text is read or copied)."""
    if not db_path or not Path(db_path).exists():
        warnings.append("QUL words DB not available; cross-checks skipped")
        return
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        counts = {
            (s, a): n
            for (s, a, n) in con.execute(
                "SELECT surah, ayah, COUNT(*) FROM words GROUP BY surah, ayah"
            )
        }
        rub_db = {
            (s, a)
            for (s, a) in con.execute(
                "SELECT surah, ayah FROM words WHERE text LIKE '۞ %'"
            )
        }
        sajda_db = {
            (s, a, w)
            for (s, a, w) in con.execute(
                "SELECT surah, ayah, word FROM words WHERE text LIKE '%۩%'"
            )
        }
    finally:
        con.close()
    bad = 0
    merged_ayahs = {(s, a) for (s, a, _w) in MERGED_WORDS}
    for key, info in per_ayah.items():
        # QUL count = real words + 1 ayah-number token, minus 1 for
        # each merged pair (37:130 writes two Tanzil tokens as one
        # layout word).
        expected = len(info["words"]) + 1 - (1 if key in merged_ayahs else 0)
        if counts.get(key) != expected:
            bad += 1
            if bad <= 5:
                fail(
                    f"QUL count mismatch {key}: db={counts.get(key)} "
                    f"derived={expected}"
                )
    if bad:
        fail(f"{bad} ayahs disagree with the QUL word list on word counts")
    if rub_db != rub:
        fail(f"rub set differs from QUL word list: db={len(rub_db)} derived={len(rub)}")
    # Sajda positions in the QUL list are (s, a, qul-word-index);
    # translate to Tanzil token indices via per_ayah.
    sajda_derived = set()
    for item in sajda:
        s, a, w = (int(x) for x in item.split(":"))
        sajda_derived.add((s, a, w))
    sajda_qul = set()
    for (s, a, qw) in sajda_db:
        words = per_ayah[(s, a)]["words"]
        # qw is the 1-based QUL word index inside the ayah (incl. the
        # number token at the end, which is never a sajda word).
        if qw - 1 < len(words):
            sajda_qul.add((s, a, words[qw - 1][0]))
    if sajda_qul != sajda_derived:
        fail(
            f"sajda set differs from QUL word list: db={sorted(sajda_qul)} "
            f"derived={sorted(sajda_derived)}"
        )
    print(
        f"cross-check vs QUL word list: counts ok, rub {len(rub_db)}, "
        f"sajda {len(sajda_db)}"
    )


def validate_ayah_pages(pages: list[dict], db_path: str) -> None:
    """Every ayah's V2 page must equal the page_number of the
    independent V2 ayah-by-ayah source (a second V2 witness — this
    check fails loudly, it is not a QPC1 comparison)."""
    if not db_path or not Path(db_path).exists():
        warnings.append("V2 ayah-by-ayah DB not available; page check skipped")
        return
    ayah_page: dict[tuple[int, int], int] = {}
    for p in pages:
        for ln in p["lines"]:
            if ln.get("t") != "x":
                continue
            for seg in ln["seg"]:
                ayah_page[(seg["s"], seg["a"])] = p["n"]
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT surah, ayah, page_number FROM verses").fetchall()
    finally:
        con.close()
    mis = [
        (s, a, pg, ayah_page.get((s, a)))
        for (s, a, pg) in rows
        if ayah_page.get((s, a)) != pg
    ]
    if mis:
        fail(f"ayah->page mismatches vs V2 ayah-by-ayah DB: {len(mis)} {mis[:5]}")
    else:
        print(f"ayah->page vs V2 ayah-by-ayah DB: 0 mismatches / {len(rows)}")


def main() -> int:
    check_only = "--check-only" in sys.argv
    tanzil = parse_tanzil(TANZIL)
    print(f"tanzil: {len(tanzil)} ayahs")
    if len(tanzil) != 6236:
        fail(f"tanzil has {len(tanzil)} ayahs, expected 6236")
    by_id, per_ayah = assign_qul_ids(tanzil)
    layout = load_layout(LAYOUT_DB)
    print(f"layout: {len(layout)} rows")
    if len(layout) != 9046:
        fail(f"layout has {len(layout)} rows, expected 9046")
    type_counts: dict[str, int] = {}
    for row in layout:
        type_counts[row["type"]] = type_counts.get(row["type"], 0) + 1
    print(f"layout types: {type_counts}")
    if type_counts != {"ayah": 8820, "surah_name": 114, "basmallah": 112}:
        fail(f"unexpected layout type split: {type_counts}")
    # Header/basmala rows carry no word ids; ayah rows always do.
    for row in layout:
        if row["type"] in ("surah_name", "basmallah"):
            if row["first"] is not None or row["last"] is not None:
                fail(f"page {row['page']} line {row['line']}: {row['type']} has word ids")
            if row["type"] == "surah_name" and row["surah"] is None:
                fail(f"page {row['page']} line {row['line']}: surah_name without surah")
        else:
            if row["first"] is None or row["last"] is None:
                fail(f"page {row['page']} line {row['line']}: ayah row without word ids")
    # Centered rows: all headers + basmalas + 30 ayah lines.
    centered_ayah = sum(1 for r in layout if r["type"] == "ayah" and r["centered"])
    print(f"centered ayah lines: {centered_ayah}")
    old_pages = load_old_lines(OLD_LINES)
    rub = rub_ayahs_from_old(old_pages)
    print(f"rub ayahs from old line data: {len(rub)}")
    if len(rub) != 199:
        fail(f"rub ayahs from old data: {len(rub)}, expected 199")
    sajda = sajda_words(tanzil)
    print(f"sajda words from Tanzil: {len(sajda)}")
    if len(sajda) != 15:
        fail(f"sajda words from Tanzil: {len(sajda)}, expected 15")
    boundaries = json.loads(BOUNDARIES.read_text(encoding="utf-8"))
    pages, break_diffs = build_pages(
        layout, by_id, per_ayah, old_pages, boundaries
    )
    validate_against_words_db(WORDS_DB, per_ayah, rub, sajda)
    validate_ayah_pages(pages, AYAH_DB)
    # INFO (not a failure): the first ayah beginning on each V2 page
    # vs boundaries.json (AlQuran Cloud / QPC1 pagination). The 25
    # differing pages are genuine QPC1-vs-V2 page-break differences
    # (56 ayahs sit on another page in V2); the V2 page data is
    # authoritative for the printed page.
    first_begin: dict[int, tuple[int, int]] = {}
    for p in pages:
        for ln in p["lines"]:
            if ln.get("t") != "x":
                continue
            done = False
            for seg in ln["seg"]:
                words = per_ayah[(seg["s"], seg["a"])]["words"]
                if words and words[0][0] == seg["w"]:
                    first_begin[p["n"]] = (seg["s"], seg["a"])
                    done = True
                    break
            if done:
                break
    n_start_diff = sum(
        1
        for e in boundaries["page"]
        if first_begin.get(e["n"]) != (e["surah"], e["ayah"])
    )
    print(f"page starts vs boundaries.json (QPC1): {n_start_diff} differ of 604")
    print(f"break diffs vs old (QPC1) line data: {len(break_diffs)}")
    for d in break_diffs:
        print(f"  break: {d}")
    if failures:
        print(f"\n{len(failures)} FAILURE(S) — no output written", file=sys.stderr)
        return 1
    data = {
        "version": 1,
        "source": (
            "QPC V2 15-line layout (QUL, TarteelAI/quranic-universal-library "
            "issue #596: layouts free to bundle/transform) + Tanzil Uthmani "
            "v1.1 (CC BY 3.0). Words are Tanzil words positioned per the V2 "
            "layout; the unlicensed QPC V2 glyph script and per-page fonts "
            "are NOT used. See docs/quran/hifz-redesign-phase3-notes.md."
        ),
        "pages": pages,
        "rubAyahs": [f"{s}:{a}" for (s, a) in sorted(rub)],
        "sajdaWords": sorted(sajda),
    }
    if check_only:
        print("check-only: all verifications passed, no output written")
        return 0
    OUT.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    if warnings:
        for w in warnings:
            print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
