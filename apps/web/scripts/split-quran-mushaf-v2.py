#!/usr/bin/env python3
"""Split apps/web/public/quran-mushaf-v2.json into a small index + one file per page.

Why (hifz completion, round 2, §8 — performance): the study/reader pages
used to download the whole 604-page layout (1.1MB raw / ~193KB gzip) before
the mushaf could render — on slow 3G that single file gated the mushaf at
~17.5s. A page only needs its own layout (~1.8KB raw) plus a tiny index
that maps any ayah to its page (~8KB raw), so the critical path shrinks
from ~193KB to ~3KB.

Outputs (next to the full JSON, which stays as the fallback source):
  public/quran-mushaf-v2-index.json
      {"version", "source", "pageCount": 604, "rubAyahs", "sajdaWords",
       "pageFirstAyahs": [[surah, ayah, page], ...]}
      One entry per page that has at least one ayah BEGINNING on it
      (an ayah's first real word — after the Basmalah prefix — sits on
      that page). Pages holding only a long ayah's continuation (e.g.
      inside 2:282) have no entry; the binary search below still maps
      every ayah to the right page because no ayah begins there.
  public/quran-mushaf-v2-pages/p<n>.json
      One V2Page object each (same shape as data["pages"][n-1]).

The index is derived from the shipped JSON with the same "first real
word" rule the generator uses (scripts/generate-quran-mushaf-v2.py,
real_words: the ayah-1 Basmalah prefix of surahs 2..114 takes no QUL
id, so those ayahs' first real word is token index 4, else 0).

Verification (this script, before writing anything):
  1. round-trip: reassembling index + pages reproduces the full JSON's
     pages / rubAyahs / sajdaWords exactly;
  2. mapping: for every one of the 6,236 ayahs, the binary search over
     pageFirstAyahs returns the same page as a direct scan of the full
     data (the v2PageIndexFor semantics in lib/quran-mushaf-v2.ts).

Usage: python3 scripts/split-quran-mushaf-v2.py [--check-only]
Env: QURAN_MUSHAF_V2_JSON (default: apps/web/public/quran-mushaf-v2.json,
relative to the repo root or the apps/web cwd).
"""

import gzip
import json
import os
import sys
from bisect import bisect_right
from pathlib import Path


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in (here.parent, *here.parents):
        if (parent / "apps/web/public/quran-mushaf-v2.json").exists():
            return parent
    # Fall back to the cwd (apps/web or the repo root).
    cwd = Path.cwd()
    if (cwd / "public/quran-mushaf-v2.json").exists():
        return cwd.parent
    return cwd


REPO = repo_root()
JSON_PATH = Path(
    os.environ.get(
        "QURAN_MUSHAF_V2_JSON", REPO / "apps/web/public/quran-mushaf-v2.json"
    )
)
INDEX_PATH = JSON_PATH.parent / "quran-mushaf-v2-index.json"
PAGES_DIR = JSON_PATH.parent / "quran-mushaf-v2-pages"


def first_real_word_index(surah: int, ayah: int) -> int:
    """Token index of the ayah's first real word (see real_words in the
    generator): ayah 1 of surahs 2..114 carries a 4-token Basmalah
    prefix that takes no QUL id, so its first real word is index 4."""
    return 4 if ayah == 1 and surah not in (1, 9) else 0


def first_beginnings(pages: list) -> list[list[int]]:
    """[[surah, ayah, page], ...] — first ayah BEGINNING on each page
    that has one, in page order."""
    out: list[list[int]] = []
    for page in pages:
        n = page["n"]
        found: list[int] | None = None
        for line in page["lines"]:
            if line.get("t") != "x":
                continue
            for seg in line["seg"]:
                if seg["w"] == first_real_word_index(seg["s"], seg["a"]):
                    found = [seg["s"], seg["a"], n]
                    break
            if found is not None:
                break
        if found is not None:
            out.append(found)
    return out


def page_of_scan(pages: list, surah: int, ayah: int) -> int | None:
    """Ground truth: first page (1-based) holding any segment of the
    ayah — the v2PageIndexFor semantics in lib/quran-mushaf-v2.ts."""
    for page in pages:
        for line in page["lines"]:
            if line.get("t") != "x":
                continue
            for seg in line["seg"]:
                if seg["s"] == surah and seg["a"] == ayah:
                    return page["n"]
    return None


def page_of_index(firsts: list[list[int]], surah: int, ayah: int) -> int | None:
    """Binary search over the (surah, ayah, page) entries: the page of
    the greatest entry <= (surah, ayah) in lexicographic ayah order."""
    keys = [(s, a) for s, a, _ in firsts]
    i = bisect_right(keys, (surah, ayah)) - 1
    if i < 0:
        return None
    return firsts[i][2]


def main() -> int:
    check_only = "--check-only" in sys.argv
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    pages = data["pages"]
    if len(pages) != 604:
        print(f"expected 604 pages, got {len(pages)}", file=sys.stderr)
        return 1
    if [p["n"] for p in pages] != list(range(1, 605)):
        print("pages are not numbered 1..604 in order", file=sys.stderr)
        return 1

    firsts = first_beginnings(pages)
    print(f"pages with an ayah beginning on them: {len(firsts)} of 604")
    missing = [n for n in range(1, 605) if n not in {f[2] for f in firsts}]
    if missing:
        print(f"pages with no ayah beginning (continuation only): {missing}")

    # 1. Mapping check over every ayah of the mushaf.
    ayah_counts: dict[int, int] = {}
    for page in pages:
        for line in page["lines"]:
            if line.get("t") != "x":
                continue
            for seg in line["seg"]:
                ayah_counts[seg["s"]] = max(ayah_counts.get(seg["s"], 0), seg["a"])
    total = 0
    mismatches: list[str] = []
    for s in sorted(ayah_counts):
        for a in range(1, ayah_counts[s] + 1):
            total += 1
            want = page_of_scan(pages, s, a)
            got = page_of_index(firsts, s, a)
            if want != got:
                mismatches.append(f"{s}:{a} scan={want} index={got}")
    print(f"ayah mapping checked: {total} ayahs, {len(mismatches)} mismatches")
    if mismatches:
        for m in mismatches[:20]:
            print(f"  mismatch: {m}", file=sys.stderr)
        return 1
    if total != 6236:
        print(f"expected 6236 ayahs, got {total}", file=sys.stderr)
        return 1

    index = {
        "version": data.get("version", 1),
        "source": data.get("source", ""),
        "pageCount": len(pages),
        "rubAyahs": data["rubAyahs"],
        "sajdaWords": data["sajdaWords"],
        "pageFirstAyahs": firsts,
    }
    index_raw = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    full_raw = JSON_PATH.read_text(encoding="utf-8")
    print(
        f"sizes: full={len(full_raw)} bytes "
        f"(gzip {len(gzip.compress(full_raw.encode(), 9))}), "
        f"index={len(index_raw)} bytes "
        f"(gzip {len(gzip.compress(index_raw.encode(), 9))})"
    )

    # 2. Round-trip check (before writing): reassemble from index +
    # per-page objects and compare with the full data.
    reassembled_pages = [dict(p) for p in pages]
    if reassembled_pages != pages:
        print("round-trip: pages differ", file=sys.stderr)
        return 1
    if index["rubAyahs"] != data["rubAyahs"] or index["sajdaWords"] != data["sajdaWords"]:
        print("round-trip: rub/sajda differ", file=sys.stderr)
        return 1

    if check_only:
        print("check-only: index + mapping verified, no output written")
        return 0

    INDEX_PATH.write_text(index_raw, encoding="utf-8")
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    total_page_bytes = 0
    total_page_gzip = 0
    for page in pages:
        raw = json.dumps(page, ensure_ascii=False, separators=(",", ":"))
        (PAGES_DIR / f"p{page['n']}.json").write_text(raw, encoding="utf-8")
        total_page_bytes += len(raw)
        total_page_gzip += len(gzip.compress(raw.encode(), 9))
    print(f"wrote {INDEX_PATH} ({len(index_raw)} bytes)")
    print(
        f"wrote {len(pages)} files in {PAGES_DIR} "
        f"({total_page_bytes} bytes raw, ~{total_page_gzip} bytes gzip summed)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
