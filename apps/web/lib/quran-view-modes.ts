/**
 * Quran reader view modes — pure grouping helpers, no components.
 *
 * Modes (switcher order, user-locked): آیه (single ayah), صفحه (mushaf
 * page), سوره (full surah, the historical behavior), جزء (one juz).
 * Initial mode is سوره.
 *
 * Boundaries come ONLY from the provider's per-ayah metadata
 * (ayah.juz / ayah.page, passed through from AlQuran Cloud). Nothing
 * here invents a boundary: ayahs with a null page/juz are simply
 * absent from that mode's groups, and when a mode has no groups at
 * all the reader shows an honest fallback note instead of guessed
 * ranges.
 *
 * Scope note: groups are built from the CURRENT surah's ayahs only.
 * A Madani page or juz that spans two surahs therefore shows just
 * this surah's part of it; cross-surah assembly is future work, not
 * silently faked here.
 */
import type { DisplayAyah } from './quran-madhhab';

export type QuranViewMode = 'ayah' | 'page' | 'surah' | 'juz';

/** Switcher order — user-locked, do not reorder. */
export const VIEW_MODE_ORDER: QuranViewMode[] = ['ayah', 'page', 'surah', 'juz'];

export interface AyahGroup {
  /** Page number (1..604) or juz number (1..30). */
  key: number;
  ayahs: DisplayAyah[];
}

function groupBy(
  displayAyahs: DisplayAyah[],
  pick: (d: DisplayAyah) => number | null,
): AyahGroup[] {
  const byKey = new Map<number, DisplayAyah[]>();
  for (const d of displayAyahs) {
    const key = pick(d);
    if (key === null || key < 1) continue;
    const list = byKey.get(key);
    if (list) list.push(d);
    else byKey.set(key, [d]);
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, ayahs]) => ({ key, ayahs }));
}

/** Groups of this surah's ayahs by Madani mushaf page (empty = no data). */
export function groupByPage(displayAyahs: DisplayAyah[]): AyahGroup[] {
  return groupBy(displayAyahs, (d) => d.ayah.page);
}

/** Groups of this surah's ayahs by juz (empty = no data). */
export function groupByJuz(displayAyahs: DisplayAyah[]): AyahGroup[] {
  return groupBy(displayAyahs, (d) => d.ayah.juz);
}
