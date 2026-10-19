'use client';

/**
 * SurahIndex — the 114-surah browser.
 *
 * Search/filter + juz shortcuts. Filtering is the pure `filterSurahs`
 * from lib/quran.ts; this component only renders and forwards the query.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { JUZ_LIST, filterSurahs, type SurahSummary } from '@/lib/quran';

export interface SurahIndexLabels {
  title: string;
  searchPlaceholder: string;
  searchAria: string;
  juzLabel: string;
  allJuz: string;
  ayahsCount: string;
  noResults: string;
  meccan: string;
  medinan: string;
}

export function SurahIndex({
  locale,
  surahs,
  labels,
}: {
  locale: string;
  surahs: SurahSummary[];
  labels: SurahIndexLabels;
}) {
  const [query, setQuery] = useState('');
  const [juz, setJuz] = useState<number | null>(null);

  const visible = useMemo(() => {
    const byQuery = filterSurahs(surahs, query);
    if (juz === null) return byQuery;
    return byQuery.filter((s) => s.juz.includes(juz));
  }, [surahs, query, juz]);

  // Juz shortcuts only make sense when the API provides juz spans.
  const hasJuz = useMemo(() => surahs.some((s) => s.juz.length > 0), [surahs]);

  return (
    <div className="surah-index">
      <h1 className="page-title">{labels.title}</h1>

      <div className="surah-index-tools">
        <input
          type="search"
          className="surah-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchAria}
        />
        {hasJuz ? (
          <div className="juz-shortcuts" role="group" aria-label={labels.juzLabel}>
            <button
              type="button"
              className={`juz-chip${juz === null ? ' juz-active' : ''}`}
              onClick={() => setJuz(null)}
            >
              {labels.allJuz}
            </button>
            {JUZ_LIST.map((j) => (
              <button
                key={j}
                type="button"
                className={`juz-chip${juz === j ? ' juz-active' : ''}`}
                aria-pressed={juz === j}
                onClick={() => setJuz(juz === j ? null : j)}
              >
                {j}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="empty-state">{labels.noResults}</p>
      ) : (
        <ol className="surah-grid">
          {visible.map((s) => (
            <li key={s.number} className="surah-card">
              <Link href={`/${locale}/quran/${s.number}`}>
                <span className="surah-card-num">{s.number}</span>
                <span className="surah-card-names">
                  <span className="surah-card-ar" lang="ar" dir="rtl">
                    {s.nameAr}
                  </span>
                  <span className="surah-card-name">{s.name}</span>
                </span>
                <span className="surah-card-meta">
                  {s.ayahCount} {labels.ayahsCount} ·{' '}
                  {s.revelationType === 'Medinan' ? labels.medinan : labels.meccan}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
