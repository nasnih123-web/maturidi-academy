/**
 * Lazily-loaded Quran boundaries.
 *
 * V2-first (hifz completion, section 4, item 5): page starts come
 * from the QPC V2 layout (lib/quran-mushaf-v2-boundaries.ts), juz /
 * hizb starts are layout-independent and reused from
 * lib/quran-boundaries.json. When the V2 data cannot be loaded, the
 * QPC1 boundaries are returned instead — navigation keeps working,
 * on QPC1 page numbers, consistently. The JSON is imported
 * dynamically, so the initial page bundles stay light: it loads on
 * the first list/range view or page-jump search, never on page load.
 * The promise is cached, so concurrent callers share one import.
 */
import type { QuranBoundaries } from './quran-view-modes';
import { loadV2Boundaries } from './quran-mushaf-v2-boundaries';

let promise: Promise<QuranBoundaries> | null = null;

/** V2 boundaries, with the QPC1 boundaries as the load-failure fallback. */
export function loadBoundaries(): Promise<QuranBoundaries> {
  if (!promise) {
    promise = loadV2Boundaries().then(
      (v2) =>
        v2 ??
        import('./quran-boundaries.json').then(
          (m) => (m as unknown as { default: QuranBoundaries }).default,
        ),
    );
  }
  return promise;
}
