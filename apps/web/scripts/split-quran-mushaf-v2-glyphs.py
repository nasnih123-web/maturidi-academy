#!/usr/bin/env python3
"""Split the word-level QPC V2 glyph script into per-page JSON files.

Reads the word-level glyph JSON (83,668 entries keyed "surah:ayah:word",
each with an `id` (QUL id) and a `text` (glyph string, 1-3 PUA chars))
and writes one file per mushaf page:

    apps/web/public/quran-mushaf-v2-glyphs/p<page>.json

Each file maps QUL id (as a JSON string key) to its glyph string, and
holds ONLY that page's word ids. The web loader
(`loadV2PageGlyphs` in apps/web/lib/quran-mushaf-v2.ts) fetches
`/quran-mushaf-v2-glyphs/p<page>.json` (page number NOT zero-padded)
and converts the keys back to numbers.

Page assignment comes from the app's own layout data
(apps/web/public/quran-mushaf-v2.json): a word id belongs to the page
whose text-line QUL-id range (f..l) contains it. The layout ranges
are sequential and non-overlapping, and every word id falls in exactly
one page's ranges (verified: 83,668/83,668 assigned, 0 unassigned).
Ayahs never span pages in this mushaf, so each ayah's words sit on a
single page; the optional ayah-level cross-check verifies that the
first page of each ayah's words equals its recorded `page_number`.

The 37:130 merge: the layout writes "IL-YASIN" as ONE layout word, so
both Tanzil tokens share QUL id 61958, whose glyph string already
holds both halves as one printed unit. The split keeps that single
entry (id 61958 -> its glyph string, on page 451); the engine renders
the second word empty (see expandV2Page).

Quirk of the procured Drive extraction: the .db/.json files live inside
SAME-NAMED DIRECTORIES, so the default input paths carry a doubled
name, e.g. qpc-v2.json/qpc-v2.json. Pass --words/--ayahs to override.

Usage (after the EPERM block clears; run from apps/web):

    python3 scripts/split-quran-mushaf-v2-glyphs.py

Exit code is non-zero on ANY validation failure — never write a
partial or silently incomplete set of files.
"""

from __future__ import annotations

import argparse
import bisect
import json
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
WEB_DIR = SCRIPT_DIR.parent

DEFAULT_WORDS = (
    Path.home()
    / "workspace"
    / "tarteel-drive"
    / "extracted"
    / "qpc-v2.json"
    / "qpc-v2.json"
)
DEFAULT_AYAHS = (
    Path.home()
    / "workspace"
    / "tarteel-drive"
    / "extracted"
    / "qpc-v2-ayah-by-ayah-glyphs.json"
    / "qpc-v2-ayah-by-ayah-glyphs.json"
)
DEFAULT_LAYOUT = WEB_DIR / "public" / "quran-mushaf-v2.json"
DEFAULT_OUT_DIR = WEB_DIR / "public" / "quran-mushaf-v2-glyphs"

EXPECTED_WORD_COUNT = 83668
EXPECTED_PAGES = 604


def fail(message: str) -> "SystemExit":
    return SystemExit(f"split-quran-mushaf-v2-glyphs: ERROR: {message}")


def load_json(path: Path, what: str) -> dict:
    if not path.is_file():
        raise fail(f"{what} not found: {path}")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def page_intervals(layout: dict) -> list[tuple[int, int, int]]:
    """(first_id, last_id, page) for every text line, sorted by first id."""
    intervals: list[tuple[int, int, int]] = []
    pages = layout.get("pages")
    if not isinstance(pages, list) or len(pages) != EXPECTED_PAGES:
        raise fail(
            f"layout has {len(pages) if isinstance(pages, list) else 'no'} pages, "
            f"expected {EXPECTED_PAGES}"
        )
    for page in pages:
        n = page["n"]
        for line in page["lines"]:
            if line.get("t") != "x":
                continue
            intervals.append((int(line["f"]), int(line["l"]), int(n)))
    intervals.sort()
    prev_end = -1
    for start, end, page in intervals:
        if start > end:
            raise fail(f"page {page}: inverted line range {start}..{end}")
        if start <= prev_end:
            raise fail(
                f"layout line ranges overlap: {start}..{end} (page {page}) "
                f"starts at or before previous end {prev_end}"
            )
        prev_end = max(prev_end, end)
    return intervals


def page_of(word_id: int, intervals: list[tuple[int, int, int]], starts: list[int]) -> int | None:
    i = bisect.bisect_right(starts, word_id) - 1
    if i < 0:
        return None
    start, end, page = intervals[i]
    return page if start <= word_id <= end else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Split the QPC V2 word-level glyph script into per-page JSON files."
    )
    parser.add_argument(
        "--words",
        type=Path,
        default=DEFAULT_WORDS,
        help="word-level glyph JSON (default: %(default)s)",
    )
    parser.add_argument(
        "--ayahs",
        type=Path,
        default=DEFAULT_AYAHS,
        help="ayah-level glyph JSON for the page cross-check (default: %(default)s)",
    )
    parser.add_argument(
        "--layout",
        type=Path,
        default=DEFAULT_LAYOUT,
        help="V2 layout JSON (default: %(default)s)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="output directory (default: %(default)s)",
    )
    parser.add_argument(
        "--no-ayah-check",
        action="store_true",
        help="skip the ayah-level page_number cross-check",
    )
    args = parser.parse_args(argv)

    layout = load_json(args.layout, "layout JSON")
    intervals = page_intervals(layout)
    starts = [start for start, _, _ in intervals]

    words = load_json(args.words, "word-level glyph JSON")
    if len(words) != EXPECTED_WORD_COUNT:
        raise fail(
            f"word-level JSON has {len(words)} entries, expected {EXPECTED_WORD_COUNT}"
        )

    # Assign every word id to its page; fail loudly on any gap.
    per_page: dict[int, dict[str, str]] = defaultdict(dict)
    ayah_pages: dict[tuple[str, str], set[int]] = defaultdict(set)
    unassigned: list[int] = []
    for key, entry in words.items():
        word_id = int(entry["id"])
        text = entry["text"]
        if not isinstance(text, str) or text == "":
            raise fail(f"word {key} (id {word_id}) has an empty glyph string")
        page = page_of(word_id, intervals, starts)
        if page is None:
            unassigned.append(word_id)
            continue
        per_page[page][str(word_id)] = text
        ayah_pages[(str(entry["surah"]), str(entry["ayah"]))].add(page)
    if unassigned:
        raise fail(
            f"{len(unassigned)} word ids fall in no page range, "
            f"first few: {sorted(unassigned)[:10]}"
        )

    if not args.no_ayah_check:
        ayahs = load_json(args.ayahs, "ayah-level glyph JSON")
        if len(ayahs) != 6236:
            raise fail(f"ayah-level JSON has {len(ayahs)} entries, expected 6236")
        mismatches: list[str] = []
        for key, record in ayahs.items():
            surah, ayah = key.split(":")
            pages = ayah_pages.get((surah, ayah))
            if not pages:
                mismatches.append(f"{key}: no words")
            elif min(pages) != int(record["page_number"]):
                mismatches.append(
                    f"{key}: words on pages {sorted(pages)}, "
                    f"recorded page_number {record['page_number']}"
                )
        if mismatches:
            raise fail(
                f"{len(mismatches)} ayah page mismatches, first few: {mismatches[:5]}"
            )

    written_total = sum(len(entries) for entries in per_page.values())
    if written_total != EXPECTED_WORD_COUNT:
        raise fail(
            f"assigned {written_total} words, expected {EXPECTED_WORD_COUNT}"
        )
    if len(per_page) != EXPECTED_PAGES:
        raise fail(
            f"words cover {len(per_page)} pages, expected {EXPECTED_PAGES}"
        )
    empty_pages = [p for p in range(1, EXPECTED_PAGES + 1) if not per_page.get(p)]
    if empty_pages:
        raise fail(f"pages with no words: {empty_pages}")

    # Spot check the documented merge: id 61958 (both halves of
    # 37:130 "IL-YASIN") must sit on page 451.
    if per_page[451].get("61958") is None:
        raise fail("spot check failed: QUL id 61958 is not on page 451")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for page in range(1, EXPECTED_PAGES + 1):
        entries = dict(sorted(per_page[page].items(), key=lambda kv: int(kv[0])))
        out_path = args.out_dir / f"p{page}.json"
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")

    counts = [len(per_page[p]) for p in range(1, EXPECTED_PAGES + 1)]
    print(f"pages written: {len(per_page)} -> {args.out_dir}")
    print(f"total words: {written_total} (in: {len(words)}, out: {written_total})")
    print(f"words per page: min {min(counts)}, max {max(counts)}")
    print(f"spot check: page 451 id 61958 -> {per_page[451]['61958']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
