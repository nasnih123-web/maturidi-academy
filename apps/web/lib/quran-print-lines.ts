/**
 * Printed mushaf lines — parsing one printed text line into per-ayah
 * segments (pure, no hooks, unit-testable).
 *
 * A printed line is whitespace-split tokens. An Arabic-Indic digit
 * token is an ayah-end marker: the words before it belong to that
 * ayah, the next ayah starts after it.
 *
 * The rub el hizb ornament (۞, U+06DE) is NOT a word: it appears in
 * the printed lines (199 standalone tokens in 199 lines) but never in
 * the Tanzil provider text (0 occurrences). Counting it as a word
 * broke the positional print→provider mapping (R-03): the ayah
 * containing it failed the totals check in `buildPageRender` and was
 * never placed, so its words could never be revealed on that page.
 * ۞ is therefore parsed as an ornament (its word-offset inside the
 * segment), rendered in place, and never consumes a provider index.
 * Pause marks (ۖۗۘۙۚۛۜ) are different: they ARE separate tokens in
 * Tanzil too, so they stay ordinary words here — do not touch them.
 */

import type { MushafExactLine } from './quran-mushaf-lines';

/** Arabic-Indic digits, as printed at ayah ends. */
export const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** The rub el hizb ornament printed at quarter-hizb boundaries. */
export const RUB_EL_HIZB = '۞';

/** A number in Eastern Arabic digits (page numbers, surah:ayah). */
export function toArabicIndic(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** True for a pure Arabic-Indic digit token: an ayah-end marker. */
export function isMarkerToken(tok: string): boolean {
  return tok.length > 0 && [...tok].every((c) => ARABIC_INDIC.includes(c));
}

/** True for the rub el hizb ornament token (never a word). */
export function isRubElHizbToken(tok: string): boolean {
  return tok === RUB_EL_HIZB;
}

export interface LineSegment {
  ayah: number;
  /** Printed words of this ayah on this line, in order (۞ excluded). */
  words: string[];
  /** Ayah-end marker printed after these words, if any. */
  marker: string | null;
  /** Word-offsets before which a ۞ ornament sits (0 = before the
      first word of this segment). Never consumes a provider index. */
  ornaments: number[];
}

export interface ParsedTextLine {
  surah: number;
  segments: LineSegment[];
}

/**
 * Parse one printed text line into per-ayah segments. A marker token
 * ends its ayah: the words before it belong to that ayah, the next
 * ayah starts after it. A ۞ token is recorded as an ornament at the
 * current word-offset and never lands in `words`. Returns null for
 * non-text lines, lines without a verse range, or lines whose range
 * spans two surahs (never happens in the data; defensive).
 */
export function parseTextLine(line: MushafExactLine): ParsedTextLine | null {
  if (line.t !== 'text' || !line.x || !line.v || !line.w) return null;
  const [vs, va] = line.v.split(':').map(Number);
  const [ws] = line.w.split(':').map(Number);
  if (!Number.isFinite(vs) || !Number.isFinite(va) || ws !== vs) return null;
  const segments: LineSegment[] = [];
  let ayah = va;
  let words: string[] = [];
  let ornaments: number[] = [];
  for (const tok of line.x.split(/\s+/).filter(Boolean)) {
    if (isMarkerToken(tok)) {
      segments.push({ ayah, words, marker: tok, ornaments });
      words = [];
      ornaments = [];
      ayah += 1;
    } else if (isRubElHizbToken(tok)) {
      ornaments.push(words.length);
    } else {
      words.push(tok);
    }
  }
  if (words.length > 0 || ornaments.length > 0) {
    segments.push({ ayah, words, marker: null, ornaments });
  }
  return { surah: vs, segments };
}

export interface PrintedCountMismatch {
  surah: number;
  ayah: number;
  /** Printed words (۞ excluded) across all pages. */
  printed: number;
  /** Provider (Tanzil) words for the ayah (minus 4 for ayah 1 of a
      surah whose Basmalah lives on a basmala line, not a text line). */
  expected: number;
}

export interface PrintedAudit {
  /** Ayahs whose printed word total differs from the provider total. */
  mismatches: PrintedCountMismatch[];
  /** Standalone ۞ ornaments found (each in its own line). */
  rubElHizbTokens: number;
  /** Ayahs that contain at least one ۞ ornament. */
  rubElHizbAyahs: string[];
}

/**
 * Audit all printed pages against provider word counts: for every
 * ayah, the printed words (۞ excluded) must equal the provider words.
 * A surah's Basmalah (4 words) lives on a basmala line for every
 * surah except 1 and 9, so ayah 1 of those surahs expects 4 fewer
 * printed words. Known data diffs (R-16, not ۞) must be allow-listed
 * by the caller, never silently ignored here.
 */
export function auditPrintedAyatCounts(
  pages: MushafExactLine[][],
  tanzilWordCounts: Map<string, number>,
): PrintedAudit {
  const basmalaSurahs = new Set<number>();
  for (const page of pages) {
    for (let i = 0; i < page.length; i += 1) {
      if (page[i].t !== 'basmala') continue;
      const next = page[i + 1];
      if (next?.t === 'text' && next.v) {
        const [s, a] = next.v.split(':').map(Number);
        if (a === 1 && s !== 1 && s !== 9) basmalaSurahs.add(s);
      }
    }
  }
  const printed = new Map<string, number>();
  const rubAyahs = new Set<string>();
  let rubTokens = 0;
  for (const page of pages) {
    for (const line of page) {
      const parsed = parseTextLine(line);
      if (!parsed) continue;
      for (const seg of parsed.segments) {
        const key = `${parsed.surah}:${seg.ayah}`;
        printed.set(key, (printed.get(key) ?? 0) + seg.words.length);
        if (seg.ornaments.length > 0) {
          rubTokens += seg.ornaments.length;
          rubAyahs.add(key);
        }
      }
    }
  }
  const mismatches: PrintedCountMismatch[] = [];
  for (const [key, expectedRaw] of tanzilWordCounts) {
    const [s, a] = key.split(':').map(Number);
    const expected =
      a === 1 && basmalaSurahs.has(s) ? expectedRaw - 4 : expectedRaw;
    const got = printed.get(key) ?? 0;
    if (got !== expected) {
      mismatches.push({ surah: s, ayah: a, printed: got, expected });
    }
  }
  mismatches.sort((x, y) => x.surah - y.surah || x.ayah - y.ayah);
  return {
    mismatches,
    rubElHizbTokens: rubTokens,
    rubElHizbAyahs: [...rubAyahs].sort(),
  };
}
