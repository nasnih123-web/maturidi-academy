/**
 * Browser-side surah fetcher for cross-surah range views (juz / hizb /
 * page). The reader's entry surah arrives from the RSC page; every OTHER
 * surah a range spans is fetched here, from the same public API the
 * server uses, and parsed with the SAME parseSurahView — so range ayahs
 * (text, translation, tafsir, audio, juz, page) are identical in shape
 * to the entry surah's ayahs.
 *
 * Failures surface as thrown errors; the reader renders an honest
 * error state instead of a partial range.
 */
import { apiBaseUrl } from './api-base';
import { parseSurahView, type SurahView } from './quran';

export async function fetchSurahClient(
  number: number,
  opts: {
    translation?: string | null;
    tafsir?: string | null;
  } = {},
): Promise<SurahView> {
  const params = new URLSearchParams();
  if (opts.translation) params.set('translation', opts.translation);
  if (opts.tafsir) params.set('tafsir', opts.tafsir);
  const qs = params.toString();
  const res = await fetch(`${apiBaseUrl()}/api/v1/quran/surah/${number}${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET surah ${number} → ${res.status}`);
  const body = await res.json();
  return parseSurahView(body, number, {
    translationEdition: opts.translation ?? null,
    tafsirEdition: opts.tafsir ?? null,
  });
}
