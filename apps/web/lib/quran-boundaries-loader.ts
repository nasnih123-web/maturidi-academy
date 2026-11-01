/**
 * Lazily-loaded Quran boundaries (lib/quran-boundaries.json).
 *
 * The JSON is generated from the provider's per-ayah metadata (see
 * scripts/generate-quran-data.mjs) and is imported dynamically, so the
 * initial page bundles stay light: it loads on the first list/range
 * view or page-jump search, never on page load. The promise is cached,
 * so concurrent callers share one import.
 */
import type { QuranBoundaries } from './quran-view-modes';

let promise: Promise<QuranBoundaries> | null = null;

export function loadBoundaries(): Promise<QuranBoundaries> {
  if (!promise) {
    promise = import('./quran-boundaries.json').then(
      (m) => (m as unknown as { default: QuranBoundaries }).default,
    );
  }
  return promise;
}
