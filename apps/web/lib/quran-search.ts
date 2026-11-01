/**
 * Quran search — pure matching helpers + lazily-loaded ayah index.
 *
 * The ayah index (lib/quran-search-index.json, 6236 rows) is generated
 * from the SAME quran-uthmani text the reader displays (see
 * scripts/generate-quran-data.mjs). It is loaded ONLY on the first
 * search, never on page load, via a dynamic import.
 *
 * Matching rule (user-locked): a few words, typed in Persian OR Arabic,
 * must find the ayah. Both the query and the indexed text are normalized
 * the same way: Persian yeh/kaf mapped to Arabic, alif wasla mapped to
 * plain alef, Arabic diacritics and tatweel stripped. The normalization
 * is built from code points (ASCII-only source) so no invisible
 * character can ever be mangled — it MUST stay identical to the
 * generator's normalize().
 */
import type { SurahSummary } from './quran';

const PERSIAN_YEH = String.fromCharCode(0x06cc);
const ARABIC_YEH = String.fromCharCode(0x064a);
const PERSIAN_KAF = String.fromCharCode(0x06a9);
const ARABIC_KAF = String.fromCharCode(0x0643);
const ALIF_WASLA = String.fromCharCode(0x0671);
const ALEF = String.fromCharCode(0x0627);
const DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x064b)}-${String.fromCharCode(0x0652)}${String.fromCharCode(0x0670)}${String.fromCharCode(0x0640)}]`,
  'g',
);

/** Normalize Arabic-script text for search matching (both query and index). */
export function normalizeQuranText(text: string): string {
  return text
    .split(PERSIAN_YEH)
    .join(ARABIC_YEH)
    .split(PERSIAN_KAF)
    .join(ARABIC_KAF)
    .split(ALIF_WASLA)
    .join(ALEF)
    .replace(DIACRITICS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Query words after normalization (empty list = no searchable words). */
export function normalizeQueryWords(query: string): string[] {
  return normalizeQuranText(query)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/** Persian/Arabic-Indic digits -> ASCII digits (code-point ranges only). */
export function toLatinDigits(text: string): string {
  return [...text]
    .map((d) => {
      const code = d.charCodeAt(0);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      return d;
    })
    .join('');
}

/** True when the trimmed input is digits only (any digit script). */
export function isNumericQuery(query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  return [...q].every((d) => {
    const code = d.charCodeAt(0);
    return (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x06f0 && code <= 0x06f9) ||
      (code >= 0x0660 && code <= 0x0669)
    );
  });
}

export interface SearchIndexRow {
  /** Global mushaf number (1..6236). */
  g: number;
  /** Surah number (1..114). */
  s: number;
  /** Ayah number inside the surah. */
  a: number;
  /** NORMALIZED Arabic text (diacritics stripped, yeh/kaf unified). */
  t: string;
}

let indexPromise: Promise<SearchIndexRow[]> | null = null;

/** Lazily load the full-Quran search index (first search only). */
export function loadSearchIndex(): Promise<SearchIndexRow[]> {
  if (!indexPromise) {
    indexPromise = import('./quran-search-index.json').then(
      (m) => (m as unknown as { default: SearchIndexRow[] }).default,
    );
  }
  return indexPromise;
}

export interface AyahSearchResult {
  hits: SearchIndexRow[];
  /** Total matches (hits may be capped by `limit`). */
  total: number;
}

/**
 * Whole-Quran ayah-text search: every query word must appear, in order,
 * as a consecutive word sequence in the normalized ayah text. Returns
 * hits capped at `limit` plus the true total.
 */
export async function searchAyahs(query: string, limit = 30): Promise<AyahSearchResult> {
  const words = normalizeQueryWords(query);
  if (words.length === 0) return { hits: [], total: 0 };
  const needle = words.join(' ');
  const rows = await loadSearchIndex();
  const matches = rows.filter((r) => r.t.includes(needle));
  return { hits: matches.slice(0, limit), total: matches.length };
}

/**
 * Surah-name match over the local surah list (fa/ar/en names + number).
 * Arabic-script names match after normalization, so a Persian-keyboard
 * query finds the Arabic name and vice versa.
 */
export function matchSurahs(surahs: SurahSummary[], query: string): SurahSummary[] {
  const raw = query.trim();
  if (!raw) return [];
  const digits = toLatinDigits(raw);
  if (/^[0-9]+$/.test(digits)) {
    const n = Number(digits);
    return surahs.filter((s) => s.number === n);
  }
  const nq = normalizeQuranText(raw);
  const lq = raw.toLowerCase();
  return surahs.filter(
    (s) =>
      normalizeQuranText(s.nameAr).includes(nq) ||
      normalizeQuranText(s.name).includes(nq) ||
      s.name.toLowerCase().includes(lq) ||
      s.englishName.toLowerCase().includes(lq),
  );
}
