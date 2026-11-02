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
 *
 * Round 8 — live strip (index page only, `liveStrip` prop): results
 * render as a scrollable strip below the box with an exact total-count
 * line (the search layer's TOTAL, never the rendered count), windowed
 * ayah rows (first 50, more on scroll), highlighted snippets, surah
 * alias matches, and a recent-searches row. The reader keeps the old
 * capped rendering. Normalization is unchanged — fa/ar-insensitive,
 * exactly as before.
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import {
  findAyahMatchSpan,
  isNumericQuery,
  matchSurahs,
  matchSurahsWithAliases,
  normalizeQuranText,
  resetSearchIndex,
  searchAyahs,
  searchAyahsRanked,
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
  /** Round 8 (live strip only, all optional): */
  /** Template with %n% (true total) and %q% (query). */
  searchResultCount?: string;
  /** Template with %n% (surah count) and %q% (query). */
  searchSurahResultCount?: string;
  searchRecent?: string;
  searchRecentClear?: string;
  searchLoadMore?: string;
  searchError?: string;
  searchRetry?: string;
  searchSurahWord?: string;
  searchAyahWord?: string;
}

/** Fallbacks for the round-8 labels when a caller omits them. */
const STRIP_FALLBACKS: Record<string, Record<string, string>> = {
  fa: {
    searchResultCount: '%n% نتیجه برای «%q%»',
    searchSurahResultCount: '%n% سوره برای «%q%»',
    searchRecent: 'جستجوهای اخیر',
    searchRecentClear: 'پاک کردن',
    searchLoadMore: 'نمایش بیشتر',
    searchError: 'بارگذاری فهرست جستجو ناموفق بود؛ دوباره تلاش کنید',
    searchRetry: 'تلاش دوباره',
    searchSurahWord: 'سوره',
    searchAyahWord: 'آیه',
  },
  ar: {
    searchResultCount: '%n% نتيجة لـ«%q%»',
    searchSurahResultCount: '%n% سورة لـ«%q%»',
    searchRecent: 'عمليات البحث الأخيرة',
    searchRecentClear: 'مسح',
    searchLoadMore: 'عرض المزيد',
    searchError: 'فشل تحميل فهرس البحث؛ حاول مجددًا',
    searchRetry: 'إعادة المحاولة',
    searchSurahWord: 'سورة',
    searchAyahWord: 'آية',
  },
  en: {
    searchResultCount: '%n% results for "%q%"',
    searchSurahResultCount: '%n% surahs for "%q%"',
    searchRecent: 'Recent searches',
    searchRecentClear: 'Clear',
    searchLoadMore: 'Show more',
    searchError: 'Search index failed to load; try again',
    searchRetry: 'Retry',
    searchSurahWord: 'Surah',
    searchAyahWord: 'Ayah',
  },
};

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

const RECENT_KEY = 'quran-recent-searches';
/* Round 9: store up to 10 (Bayan-style newest-first prune), show only the
 * last 3 — the user's explicit display rule. */
const RECENT_STORE_MAX = 10;
const RECENT_SHOW_MAX = 3;
const STRIP_WINDOW = 50;
const SNIPPET_RADIUS = 45;

/** Newest-first, deduped by normalized text. An entry that is a strict
 *  prefix of a newer kept entry is typing pollution (e.g. تنا next to
 *  تناوش) and is dropped — this also repairs lists polluted by round 8. */
function cleanRecents(list: string[]): string[] {
  const kept: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const q = raw.trim();
    if (!q) continue;
    const nq = normalizeQuranText(q);
    if (!nq) continue;
    if (kept.some((k) => normalizeQuranText(k) === nq)) continue;
    if (
      kept.some((k) => {
        const nk = normalizeQuranText(k);
        return nk.length > nq.length && nk.startsWith(nq);
      })
    )
      continue;
    kept.push(q);
  }
  return kept.slice(0, RECENT_STORE_MAX);
}

function loadRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? cleanRecents(parsed.filter((x): x is string => typeof x === 'string'))
      : [];
  } catch {
    return [];
  }
}

function saveRecents(list: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(cleanRecents(list)));
  } catch {
    /* private mode — recents are best-effort only */
  }
}

export function QuranSearchBox({
  locale,
  surahs,
  labels,
  liveStrip = false,
}: {
  locale: string;
  surahs: SurahSummary[];
  labels: QuranSearchLabels;
  /** Round 8 live strip (index page). Reader omits it and keeps the old rendering. */
  liveStrip?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Results>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [visibleCount, setVisibleCount] = useState(STRIP_WINDOW);
  const [recents, setRecents] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  const fb = STRIP_FALLBACKS[locale] ?? STRIP_FALLBACKS.en;
  const stripLabel = (key: keyof typeof fb): string =>
    (labels[key as keyof QuranSearchLabels] as string | undefined) ?? fb[key];

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const loaded = loadRecents();
    setRecents(loaded);
    /* Round 9: repair a polluted stored list in place, so storage matches
     * the cleaned display even before the next intentional save. */
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw !== null && raw !== JSON.stringify(loaded)) saveRecents(loaded);
    } catch {
      /* private mode — best-effort only */
    }
  }, []);

  /* Round 9: a query becomes "recent" only when the user intentionally
   * confirms it (Enter) or navigates from a result — never while typing,
   * so debounced intermediates never pollute the list. */
  const rememberQuery = (raw: string): void => {
    const q = raw.trim();
    if (!q) return;
    setRecents((prev) => {
      const next = cleanRecents([q, ...prev]);
      saveRecents(next);
      return next;
    });
  };

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setResults({ kind: 'idle' });
      setLoading(false);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoadError(false);
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
    setVisibleCount(STRIP_WINDOW);
    if (liveStrip) {
      const surahMatches = matchSurahsWithAliases(surahs, q);
      setLoading(true);
      searchAyahsRanked(q)
        .then((r) => {
          if (cancelled) return;
          setResults({ kind: 'results', surahMatches, ayahHits: r.hits, ayahTotal: r.total });
          setLoading(false);
          /* Round 9: no save here — a completed debounced search is not
           * an intentional search, and saving it is what polluted recents
           * with typing intermediates. Saving happens on Enter / result tap. */
        })
        .catch(() => {
          if (cancelled) return;
          setResults({ kind: 'results', surahMatches, ayahHits: [], ayahTotal: 0 });
          setLoading(false);
          setLoadError(true);
        });
    } else {
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
    }
    return () => {
      cancelled = true;
    };
  }, [debounced, surahs, liveStrip, retryNonce]);

  const surahByNumber = (n: number): SurahSummary | undefined =>
    surahs.find((x) => x.number === n);

  const surahNameAr = (n: number): string => {
    const s = surahByNumber(n);
    return s ? s.nameAr : String(n);
  };

  const surahNameLocal = (n: number): string => {
    const s = surahByNumber(n);
    return s ? s.name : String(n);
  };

  const showEmpty =
    !loading &&
    !loadError &&
    ((results.kind === 'results' &&
      results.surahMatches.length === 0 &&
      results.ayahHits.length === 0) ||
      results.kind === 'pageInvalid');

  const onStripScroll = (): void => {
    const el = listRef.current;
    if (!el || results.kind !== 'results') return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      setVisibleCount((v) => Math.min(v + STRIP_WINDOW, results.ayahTotal));
    }
  };

  const snippetFor = (row: SearchIndexRow): { before: string; match: string; after: string } => {
    const span = findAyahMatchSpan(row.t, debounced.trim());
    if (!span) {
      const head = row.t.slice(0, 90);
      return { before: head, match: '', after: row.t.length > 90 ? '…' : '' };
    }
    const start = Math.max(0, span.start - SNIPPET_RADIUS);
    const end = Math.min(row.t.length, span.end + SNIPPET_RADIUS);
    return {
      before: (start > 0 ? '…' : '') + row.t.slice(start, span.start),
      match: row.t.slice(span.start, span.end),
      after: row.t.slice(span.end, end) + (end < row.t.length ? '…' : ''),
    };
  };

  const countLine =
    results.kind === 'results' && !loading
      ? results.ayahTotal > 0
        ? stripLabel('searchResultCount')
            .replace('%n%', String(results.ayahTotal))
            .replace('%q%', debounced.trim())
        : results.surahMatches.length > 0
          ? stripLabel('searchSurahResultCount')
              .replace('%n%', String(results.surahMatches.length))
              .replace('%q%', debounced.trim())
          : null
      : null;

  return (
    <div className="quran-search-box">
      <input
        type="search"
        className="quran-search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setDebounced(query);
            rememberQuery(query);
          }
        }}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchAria}
      />
      <p className="quran-search-hint">{labels.searchHint}</p>

      {/* Round 9 recent searches: only when the strip is closed, last 3 shown. */}
      {liveStrip && results.kind === 'idle' && !loading && recents.length > 0 ? (
        <div className="quran-search-recent">
          <span className="quran-search-recent-label">{stripLabel('searchRecent')}</span>
          <ul>
            {recents.slice(0, RECENT_SHOW_MAX).map((r) => (
              <li key={r}>
                <button
                  type="button"
                  className="quran-search-recent-chip"
                  onClick={() => {
                    rememberQuery(r);
                    setQuery(r);
                    setDebounced(r);
                  }}
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="quran-search-recent-clear"
            onClick={() => {
              saveRecents([]);
              setRecents([]);
            }}
          >
            {stripLabel('searchRecentClear')}
          </button>
        </div>
      ) : null}

      {loading ? <p className="quran-search-status">{labels.searchLoading}</p> : null}

      {loadError && liveStrip ? (
        <p className="quran-search-status" role="status">
          {stripLabel('searchError')}{' '}
          <button
            type="button"
            className="quran-search-retry"
            onClick={() => {
              resetSearchIndex();
              setRetryNonce((n) => n + 1);
            }}
          >
            {stripLabel('searchRetry')}
          </button>
        </p>
      ) : null}

      {results.kind === 'page' ? (
        <div className="quran-search-results">
          <h3>{labels.searchPageHeading}</h3>
          <Link
            href={`/${locale}/quran/${results.surah}?view=page&target=${results.page}`}
            className="quran-search-row"
            onClick={() => {
              /* Index strip only — the reader keeps no recents. */
              if (liveStrip) rememberQuery(debounced.trim());
            }}
          >
            {labels.searchPageHeading} {results.page}
          </Link>
        </div>
      ) : null}

      {/* Round 8 live strip (index page). */}
      {liveStrip && results.kind === 'results' ? (
        <div className="quran-search-strip">
          {countLine ? (
            <p className="quran-search-count" role="status">
              {countLine}
            </p>
          ) : null}
          {results.surahMatches.length > 0 ? (
            <>
              <h3>{labels.searchSurahHeading}</h3>
              <ul>
                {results.surahMatches.map((s) => (
                  <li key={s.number}>
                    <Link
                      href={`/${locale}/quran/${s.number}`}
                      className="quran-search-row"
                      onClick={() => rememberQuery(debounced.trim())}
                    >
                      {stripLabel('searchSurahWord')} {s.name} ·{' '}
                      <span lang="ar" dir="rtl">
                        {s.nameAr}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {results.ayahHits.length > 0 ? (
            <>
              <h3>{labels.searchAyahHeading}</h3>
              <div
                ref={listRef}
                className="quran-search-strip-list"
                onScroll={onStripScroll}
                aria-label={labels.searchAyahHeading}
              >
                <ul>
                  {results.ayahHits.slice(0, visibleCount).map((h) => {
                    const sn = snippetFor(h);
                    return (
                      <li key={h.g}>
                        <Link
                          href={`/${locale}/quran/${h.s}?view=ayah&ayah=${h.a}`}
                          className="quran-search-ayah-row"
                          onClick={() => rememberQuery(debounced.trim())}
                        >
                          <span className="quran-search-ayah-meta">
                            {stripLabel('searchSurahWord')} {surahNameLocal(h.s)} ·{' '}
                            {stripLabel('searchAyahWord')} {h.a} ·{' '}
                            <span lang="ar" dir="rtl">
                              {surahNameAr(h.s)}
                            </span>
                          </span>
                          <span lang="ar" dir="rtl" className="quran-search-snippet">
                            {sn.before}
                            {sn.match ? <mark>{sn.match}</mark> : null}
                            {sn.after}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {visibleCount < results.ayahTotal ? (
                  <button
                    type="button"
                    className="quran-search-more-btn"
                    onClick={() =>
                      setVisibleCount((v) => Math.min(v + STRIP_WINDOW, results.ayahTotal))
                    }
                  >
                    {stripLabel('searchLoadMore')}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Old capped rendering (reader). */}
      {!liveStrip && results.kind === 'results' ? (
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
                        {surahNameAr(h.s)}
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
