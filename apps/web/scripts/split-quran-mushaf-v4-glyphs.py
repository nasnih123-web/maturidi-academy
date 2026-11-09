#!/usr/bin/env python3
"""Split the word-level QPC V4 Tajweed glyph script into per-page JSON files.

Reads the word-level glyph JSON (83,668 entries keyed "surah:ayah:word",
each with an `id` (QUL id) and a `text` (glyph string, 1-3 PUA chars,
COLR-layered in the per-page QCF4NNN_COLOR fonts)) and writes one file
per mushaf page:

    apps/web/public/quran-mushaf-v4-glyphs/p<page>.json

Each file maps the V4 native key "surah:ayah:word" (word 1-based) to its
glyph string, and holds ONLY that page's words. The hifz loader
(`loadV4PageGlyphs` in apps/web/lib/quran-mushaf-v4.ts) fetches
`/quran-mushaf-v4-glyphs/p<page>.json` (page number NOT zero-padded).

Page assignment comes from the app's own V2 layout data
(apps/web/public/quran-mushaf-v2.json): a word id belongs to the page
whose text-line QUL-id range (f..l) contains it. The V4 data carries
no page number, but V4 and V2 share the QUL id space, so the same
ranges assign every V4 entry (verified: 83,668/83,668 assigned,
0 unassigned). Ayahs never span pages in this mushaf, so each ayah's
words sit on a single page.

The 37:130 case: V4 keeps four separate entries (ids 61956-61959),
one per Tanzil token — unlike V2's merged layout word — so both
tokens get their own glyph string by key.

Usage (run from apps/web):

    python3 scripts/split-quran-mushaf-v4-glyphs.py

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

DEFAULT_WORDS = WEB_DIR / "public" / "quran-mushaf-v4-tajweed.json"
DEFAULT_LAYOUT = WEB_DIR / "public" / "quran-mushaf-v2.json"
DEFAULT_OUT_DIR = WEB_DIR / "public" / "quran-mushaf-v4-glyphs"

EXPECTED_WORD_COUNT = 83668
EXPECTED_PAGES = 604


def fail(message: str) -> "SystemExit":
    return SystemExit(f"split-quran-mushaf-v4-glyphs: ERROR: {message}")


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
        description="Split the QPC V4 Tajweed word-level glyph script into per-page JSON files."
    )
    parser.add_argument(
        "--words",
        type=Path,
        default=DEFAULT_WORDS,
        help="word-level glyph JSON (default: %(default)s)",
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
    unassigned: list[int] = []
    for key, entry in words.items():
        word_id = int(entry["id"])
        text = entry["text"]
        if not isinstance(text, str) or text == "":
            raise fail(f"word {key} (id {word_id}) has an empty glyph string")
        # The output key is the V4 native key "surah:ayah:word"
        # (word 1-based), rebuilt from the entry's own fields so a
        # mistyped dict key can never slip through.
        out_key = f"{int(entry['surah'])}:{int(entry['ayah'])}:{int(entry['word'])}"
        if out_key != key:
            raise fail(f"word key {key} disagrees with its fields ({out_key})")
        page = page_of(word_id, intervals, starts)
        if page is None:
            unassigned.append(word_id)
            continue
        per_page[page][out_key] = text
    if unassigned:
        raise fail(
            f"{len(unassigned)} word ids fall in no page range, "
            f"first few: {sorted(unassigned)[:10]}"
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

    # Spot checks (investigation brief §1.2, corrected 2026-11-08):
    # p293 holds 138 entries (17:105-111 + 18:1-4). 18:1:1 is the
    # first REAL word after the Basmalah (الْحَمْدُ) — the Basmalah
    # prefix itself has no V4 entries. The 37:130 pair's keys sit on
    # p451 (37:130:3 is the merged "إِلْ يَاسِينَ" entry, 37:130:4
    # the ayah-end marker).
    if len(per_page[293]) != 138:
        raise fail(f"spot check failed: page 293 has {len(per_page[293])} words, expected 138")
    if per_page[293].get("18:1:1") is None:
        raise fail("spot check failed: Basmalah word 18:1:1 is not on page 293")
    if per_page[451].get("37:130:2") is None or per_page[451].get("37:130:3") is None:
        raise fail("spot check failed: 37:130 tokens 2/3 are not both on page 451")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for page in range(1, EXPECTED_PAGES + 1):
        entries = dict(
            sorted(
                per_page[page].items(),
                key=lambda kv: tuple(int(x) for x in kv[0].split(":")),
            )
        )
        out_path = args.out_dir / f"p{page}.json"
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")

    counts = [len(per_page[p]) for p in range(1, EXPECTED_PAGES + 1)]
    print(f"pages written: {len(per_page)} -> {args.out_dir}")
    print(f"total words: {written_total} (in: {len(words)}, out: {written_total})")
    print(f"words per page: min {min(counts)}, max {max(counts)}")
    print(f"spot check: page 293 has {len(per_page[293])} words, 18:1:1 -> {per_page[293]['18:1:1']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
