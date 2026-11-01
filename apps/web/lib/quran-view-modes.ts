/**
 * Quran reader view modes — pure grouping/range helpers, no components.
 *
 * Modes (switcher order, user-locked 2026-11-01): سوره (full surah),
 * آیه (single ayah), جزء (one juz), حزب (one hizb), صفحه (one mushaf
 * page). Initial mode is سوره.
 *
 * Juz / hizb / page views SPAN SURAH BOUNDARIES: a juz, hizb or page
 * may cover two or more surahs, and the reader assembles every spanned
 * surah's ayahs, filtered by the ayah's own position inside the range.
 * This supersedes the old "current surah only" grouping limit.
 *
 * Boundaries come ONLY from lib/quran-boundaries.json, which is
 * generated from the provider's per-ayah metadata (juz, hizbQuarter,
 * page) by scripts/generate-quran-data.mjs — never hand-typed. A hizb
 * is Bayan's حزب: the half-hizb division, 120 items (hizb n =
 * hizbQuarter 2n-1: the odd quarters are exactly the hizb starts and
 * the hizb middles). PROOF from the user's own reference: Bayan's page
 * 106 header reads جزء ۶ حزب ۲۲ — standard 60-hizb numbering cannot
 * put hizb 22 inside juz 6 (it falls in juz 11); only half-hizb
 * numbering does (half-hizbs 21–24 belong to juz 6).
 */
import type { Ayah } from './quran';

export type QuranViewMode = 'surah' | 'ayah' | 'juz' | 'hizb' | 'page';

/** Switcher order — user-locked, do not reorder. */
export const VIEW_MODE_ORDER: QuranViewMode[] = ['surah', 'ayah', 'juz', 'hizb', 'page'];

export type RangeKind = 'juz' | 'hizb' | 'page';

/** Item counts per range kind (provider-verified). */
export const RANGE_COUNTS: Record<RangeKind, number> = { juz: 30, hizb: 120, page: 604 };

/** First ayah of one juz / hizb / page (from quran-boundaries.json). */
export interface BoundaryStart {
  n: number;
  surah: number;
  ayah: number;
  /** First-ayah text preview for the lists (raw provider text). */
  text: string;
}

export interface QuranBoundaries {
  juz: BoundaryStart[];
  hizb: BoundaryStart[];
  page: BoundaryStart[];
}

/** A (surah, ayah) reference inside the mushaf. */
export interface AyahRef {
  surah: number;
  ayah: number;
}

/**
 * One range view's span: [start, end) in mushaf order. `end` is null
 * for the last range of its kind (it runs to the end of the Quran).
 */
export interface RangeSpan {
  kind: RangeKind;
  target: number;
  start: AyahRef;
  end: AyahRef | null;
  /** Surah numbers spanned, in order. */
  surahs: number[];
}

function cmpRef(a: AyahRef, b: AyahRef): number {
  if (a.surah !== b.surah) return a.surah - b.surah;
  return a.ayah - b.ayah;
}

/** Span for one juz / hizb / page, or null for an out-of-range target. */
export function rangeSpan(
  boundaries: QuranBoundaries,
  kind: RangeKind,
  target: number,
): RangeSpan | null {
  const list = boundaries[kind];
  if (target < 1 || target > list.length) return null;
  const startEntry = list[target - 1];
  const endEntry = target < list.length ? list[target] : null;
  const start: AyahRef = { surah: startEntry.surah, ayah: startEntry.ayah };
  const end: AyahRef | null = endEntry ? { surah: endEntry.surah, ayah: endEntry.ayah } : null;
  const surahs: number[] = [];
  for (let s = start.surah; s <= (end ? end.surah : 114); s++) surahs.push(s);
  return { kind, target, start, end, surahs };
}

/** True when (surah, ayah) lies inside [span.start, span.end). */
export function inRangeSpan(surah: number, ayah: number, span: RangeSpan): boolean {
  const ref: AyahRef = { surah, ayah };
  if (cmpRef(ref, span.start) < 0) return false;
  if (span.end && cmpRef(ref, span.end) >= 0) return false;
  return true;
}

/** Filter one surah's ayahs to those inside the span. */
export function filterRangeAyahs(surahNumber: number, ayahs: Ayah[], span: RangeSpan): Ayah[] {
  return ayahs.filter((a) => inRangeSpan(surahNumber, a.number, span));
}

/**
 * Which juz / hizb / page contains (surah, ayah), derived from the
 * boundary starts (last start at or before the reference). Null when
 * the reference precedes the first start (impossible for real ayahs).
 */
export function rangeContaining(
  boundaries: QuranBoundaries,
  surah: number,
  ayah: number,
): { juz: number | null; hizb: number | null; page: number | null } {
  const ref: AyahRef = { surah, ayah };
  const find = (list: BoundaryStart[]): number | null => {
    let found: number | null = null;
    for (const entry of list) {
      if (cmpRef({ surah: entry.surah, ayah: entry.ayah }, ref) <= 0) found = entry.n;
      else break;
    }
    return found;
  };
  return { juz: find(boundaries.juz), hizb: find(boundaries.hizb), page: find(boundaries.page) };
}
