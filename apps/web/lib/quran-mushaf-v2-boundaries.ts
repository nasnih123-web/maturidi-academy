/**
 * Reader navigation on QPC V2 boundaries (hifz completion, section 4,
 * item 5) — the study-page header already navigated on V2 while the
 * rest of the reader (all 5 view modes, picker, search jump, reading
 * view, playback follow) still used the QPC1 boundaries, so the same
 * ayah landed on two different page numbers (5:77 → 120 on the study
 * page, 121 in the reader; 56 ayahs differ).
 *
 * Juz / hizb starts are layout-independent (a juz or hizb starts at a
 * fixed ayah, whichever print carries it), so they are reused verbatim
 * from the QPC1 boundaries — verified: every one of the 30 juz starts
 * and 120 hizb starts sits on a V2 page whose own juz/hizb field
 * equals the start number (0 mismatches). Only the PAGE starts are
 * re-derived, from the V2 layout itself: the first ayah of each of
 * the 604 V2 pages.
 *
 * The QPC1 boundaries stay as the emergency fallback: when the V2
 * data fails to load, loadBoundaries() returns the QPC1 boundaries
 * (and the QPC1 exact lines stay the render fallback), so navigation
 * never breaks — it just falls back to QPC1 page numbers, consistently.
 * The hizb scale stays 120 (half-hizb, the reader-wide convention;
 * Bayan is 120 too) — changing it is a separate, global product
 * decision (Wave-1 inventory, item 1).
 */
import type { BoundaryStart, QuranBoundaries } from './quran-view-modes';
import { loadMushafV2, v2FirstAyahOfPage, type V2MushafData } from './quran-mushaf-v2';

async function loadQpc1Boundaries(): Promise<QuranBoundaries> {
  const m = await import('./quran-boundaries.json');
  return (m as unknown as { default: QuranBoundaries }).default;
}

/**
 * First-ayah starts of the 604 V2 pages, in order. `text` is empty
 * here — buildV2Boundaries fills it from the QPC1 preview where the
 * same ayah starts a QPC1 range (the preview is never rendered for
 * page rows today; the picker shows surah + ayah number).
 */
export function v2PageStarts(pages: V2MushafData['pages']): BoundaryStart[] {
  return pages.map((page, i) => {
    const first = v2FirstAyahOfPage(page);
    if (!first) throw new Error(`V2 page ${page.n} has no text line`);
    return { n: i + 1, surah: first.surah, ayah: first.ayah, text: '' };
  });
}

/**
 * Pure merge: juz/hizb starts from QPC1 (layout-independent), page
 * starts from V2. Throws when the V2 data has no usable first ayah
 * on some page — callers treat that as a failed load and fall back
 * to QPC1 (loadV2Boundaries catches it).
 */
export function buildV2Boundaries(
  v2: V2MushafData,
  qpc1: QuranBoundaries,
): QuranBoundaries {
  const textByRef = new Map<string, string>();
  for (const kind of ['juz', 'hizb', 'page'] as const) {
    for (const e of qpc1[kind]) textByRef.set(`${e.surah}:${e.ayah}`, e.text);
  }
  const page = v2PageStarts(v2.pages).map((s) => ({
    ...s,
    text: textByRef.get(`${s.surah}:${s.ayah}`) ?? '',
  }));
  return { juz: qpc1.juz, hizb: qpc1.hizb, page };
}

/**
 * Merged V2 boundaries, or null when the V2 data cannot be loaded
 * (callers fall back to the QPC1 boundaries).
 */
export async function loadV2Boundaries(): Promise<QuranBoundaries | null> {
  try {
    const [v2, qpc1] = await Promise.all([loadMushafV2(), loadQpc1Boundaries()]);
    if (!v2) return null;
    return buildV2Boundaries(v2, qpc1);
  } catch {
    return null;
  }
}
