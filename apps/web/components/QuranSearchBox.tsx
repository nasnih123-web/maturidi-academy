'use client';

/**
 * QuranSearchBox — the ONE Quran search, used on the index page (above
 * the section cards) and inside the umum reader.
 *
 * One box, three result kinds (user-locked):
 * - Digits only → mushaf page jump (1..604). Out-of-range numbers show
 *   an honest message, never an empty silent page.
 * - Otherwise → surah-name matches over the local surah list (fa/ar/en,
 *   Persian/Arabic keyboards unified) AND whole-Quran ayah-text matches
 *   by a few words (Persian or Arabic typed, diacritic-insensitive).
 *
 * The ayah index (6236 rows) and the page boundaries load lazily on
 * the first search, never on page load. Results navigate to the reader:
 * surah → its surah view, ayah → its ayah view, page → its page view.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import {
  isNumericQuery,
  matchSurahs,
  searchAyahs,
  toLatinDigits,
  type SearchIndexRow,
} from '@/lib/quran-search';
import type { SurahSummary } from '@/lib/quran';

export interface QuranSearchLabels {
  searchPlaceholder: string;
  searchAria: string;
  /** Short hint under the box (digits → page, text → surah or ayah). */
  searchHint: string;
  searchLoading: string;
  noResults: string;
  searchSurahHeading: string;
  searchAyahHeading: string;
  searchPageHeading: string;
  /** Template with %max% (604). */
  searchPageOutOfRange: string;
  /** Template with %n% (remaining matches beyond the shown hits). */
  searchMore: string;
}

type Results =
  | { kind: 'idle' }
  | { kind: 'page'; page: number; surah: number }
  | { kind: 'pageInvalid'; page: number }
  | {
      kind: 'results';
      surahMatches: SurahSummary[];
      ayahHits: SearchIndexRow[];
      ayahTotal: number;
    };

export function QuranSearchBox({
  locale,
  surahs,
  labels,
}: {
  locale: string;
  surahs: SurahSummary[];
  labels: QuranSearchLabels;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Results>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setResults({ kind: 'idle' });
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (isNumericQuery(q)) {
      setLoading(true);
      loadBoundaries()
        .then((b) => {
          if (cancelled) return;
          const p = Number(toLatinDigits(q));
          if (p >= 1 && p <= 604) {
            setResults({ kind: 'page', page: p, surah: b.page[p - 1].surah });
          } else {
            setResults({ kind: 'pageInvalid', page: p });
          }
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setResults({ kind: 'idle' });
          setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    const surahMatches = matchSurahs(surahs, q);
    setLoading(true);
    searchAyahs(q, 30)
      .then((r) => {
        if (cancelled) return;
        setResults({ kind: 'results', surahMatches, ayahHits: r.hits, ayahTotal: r.total });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResults({ kind: 'results', surahMatches, ayahHits: [], ayahTotal: 0 });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, surahs]);

  const surahName = (n: number): string => {
    const s = surahs.find((x) => x.number === n);
    return s ? s.nameAr : String(n);
  };

  const showEmpty =
    !loading &&
    ((results.kind === 'results' &&
      results.surahMatches.length === 0 &&
      results.ayahHits.length === 0) ||
      results.kind === 'pageInvalid');

  return (
    <div className="quran-search-box">
      <input
        type="search"
        className="quran-search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setDebounced(query);
        }}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchAria}
      />
      <p className="quran-search-hint">{labels.searchHint}</p>
      {loading ? <p className="quran-search-status">{labels.searchLoading}</p> : null}
      {results.kind === 'page' ? (
        <div className="quran-search-results">
          <h3>{labels.searchPageHeading}</h3>
          <Link
            href={`/${locale}/quran/${results.surah}?view=page&target=${results.page}`}
            className="quran-search-row"
          >
            {labels.searchPageHeading} {results.page}
          </Link>
        </div>
      ) : null}
      {results.kind === 'results' ? (
        <div className="quran-search-results">
          {results.surahMatches.length > 0 ? (
            <>
              <h3>{labels.searchSurahHeading}</h3>
              <ul>
                {results.surahMatches.map((s) => (
                  <li key={s.number}>
                    <Link href={`/${locale}/quran/${s.number}`} className="quran-search-row">
                      <span lang="ar" dir="rtl">
                        {s.nameAr}
                      </span>{' '}
                      · {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {results.ayahHits.length > 0 ? (
            <>
              <h3>{labels.searchAyahHeading}</h3>
              <ul>
                {results.ayahHits.map((h) => (
                  <li key={h.g}>
                    <Link
                      href={`/${locale}/quran/${h.s}?view=ayah&ayah=${h.a}`}
                      className="quran-search-row"
                    >
                      <span lang="ar" dir="rtl">
                        {surahName(h.s)}
                      </span>{' '}
                      · {h.a}
                    </Link>
                  </li>
                ))}
              </ul>
              {results.ayahTotal > results.ayahHits.length ? (
                <p className="quran-search-status">
                  {labels.searchMore.replace('%n%', String(results.ayahTotal - results.ayahHits.length))}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {showEmpty ? (
        <p className="quran-search-status" role="status">
          {results.kind === 'pageInvalid'
            ? labels.searchPageOutOfRange.replace('%max%', '604')
            : labels.noResults}
        </p>
      ) : null}
    </div>
  );
}
