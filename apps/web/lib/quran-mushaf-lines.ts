/**
 * Quran mushaf exact lines — lazy-loaded Madani print line data.
 *
 * Data: lib/quran-mushaf-lines.json, derived from the open Madani
 * mushaf-layout dataset (Hafs 'an 'Asim; QPC1 line breaks, verified
 * line-by-line against the user's Bayan page-106 screenshot — all 15
 * lines match, including the 7 wrap points where QPC1 and QPC2 differ).
 * Only line text + line type + verse range are bundled: no QPC glyphs,
 * no per-word objects, no fonts. The Quran text itself is the Hafs
 * text; the line BREAKS are the dataset's contribution.
 *
 * Provenance / licence (stated honestly): QUL (Tarteel's Quranic
 * Universal Library) distributes its mushaf-layout resources with the
 * platform statement that resources are "intended for you to download
 * and package with your own project", and Tarteel describes this layout
 * data as open-sourced. No per-resource licence file is published for
 * the layout, so attribution is kept here and in the PR body: line
 * breaks from the open mushaf-layout dataset (Madani print, QPC1
 * breaks), via QUL / Tarteel.
 *
 * The JSON is lazy-loaded (dynamic import, like the search index) so
 * the mushaf page view is the only view that downloads it. A failed
 * load returns null and the reader falls back to flowing text — never
 * a blank page.
 */

export interface MushafExactLine {
  t: 'text' | 'surah-header' | 'basmala';
  /** Line text (omitted for basmala lines: standard Bismillah renders). */
  x?: string;
  /** First verse "S:A" of a text line (tap-to-play + highlight). */
  v?: string;
  /** Last verse "S:A" of a text line. */
  w?: string;
}

let linesPromise: Promise<MushafExactLine[][] | null> | null = null;

/** All 604 pages' exact lines (index = page - 1), or null on failure. */
export function loadMushafLines(): Promise<MushafExactLine[][] | null> {
  if (!linesPromise) {
    linesPromise = import('./quran-mushaf-lines.json')
      .then(
        (m) =>
          (m as unknown as { default: { pages: MushafExactLine[][] } }).default.pages,
      )
      .catch(() => null);
  }
  return linesPromise;
}
