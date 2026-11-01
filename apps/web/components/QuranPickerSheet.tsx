'use client';

/**
 * QuranPickerSheet — Bayan-style bottom-sheet picker (round 5).
 *
 * Four tabs (Bayan's sheet order): سوره / جزء / حزب / صفحه, a search
 * box, and a grid of light cards (number + name). Search filters the
 * CURRENT tab only: digits match the row number (any digit script),
 * otherwise the query matches the row's start-surah name after the
 * same fa/ar normalization as the round-4 text search
 * (normalizeQuranText). No names are invented here: range rows show
 * the range's real start surah + ayah from lib/quran-boundaries.json
 * (provider-derived, never hand-typed).
 *
 * Navigation uses the EXISTING deep links: a surah card is a real
 * <a href> to /{locale}/quran/{n}; a range card calls onSelectRange,
 * and the reader mirrors the choice into ?view=&target= with the same
 * replaceState effect the mode switcher already uses. onSelectRange
 * also receives the range's FIRST MUSHAR PAGE so a reading view can
 * jump straight to it (page tab: the page itself; juz: the juz's
 * first page; hizb: the page containing the hizb's start ayah).
 *
 * The sheet shell (backdrop + panel + header + close) is exported as
 * QuranSheetShell so the mushaf picker and the reading-view settings
 * / bookmarks sheets share one look and one close behaviour. Mobile:
 * slides from the bottom; desktop: a centered sheet. Backdrop click
 * closes; Escape is handled by the reader (which owns the open state).
 * All visuals are our own CSS — nothing is copied from any app.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import { normalizeQuranText, toLatinDigits } from '@/lib/quran-search';
import type { SurahSummary } from '@/lib/quran';
import {
  juzPages,
  rangeContaining,
  type QuranBoundaries,
  type RangeKind,
} from '@/lib/quran-view-modes';
import { toArabicIndicDigits } from './QuranMushafPage';

/** Shared sheet shell: backdrop (click closes) + panel + header. */
export function QuranSheetShell({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="quran-sheet-layer" role="presentation">
      <div className="quran-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="quran-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quran-sheet-head">
          <h2 className="quran-sheet-title">{title}</h2>
          <button type="button" className="quran-sheet-close" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export type PickerTab = 'surah' | 'juz' | 'hizb' | 'page';

export interface PickerSheetLabels {
  title: string;
  searchLabel: string;
  searchPlaceholder: string;
  closeLabel: string;
  noResults: string;
  loading: string;
  tabSurah: string;
  tabJuz: string;
  tabHizb: string;
  tabPage: string;
}

const PICKER_TABS: { id: PickerTab; kind: RangeKind | null }[] = [
  { id: 'surah', kind: null },
  { id: 'juz', kind: 'juz' },
  { id: 'hizb', kind: 'hizb' },
  { id: 'page', kind: 'page' },
];

export function QuranPickerSheet({
  locale,
  surahList,
  currentSurah,
  currentView,
  currentTarget,
  onSelectRange,
  onClose,
  labels,
}: {
  locale: string;
  surahList: SurahSummary[];
  /** Currently open surah (highlighted in the surah tab). */
  currentSurah: number;
  /** Currently open range mode ('surah' | 'ayah' | range kind). */
  currentView: string;
  /** Currently open range target (range modes) or null. */
  currentTarget: number | null;
  /** Range choice: (kind, target, first mushaf page of the range). */
  onSelectRange: (kind: RangeKind, target: number, firstPage: number) => void;
  onClose: () => void;
  labels: PickerSheetLabels;
}) {
  const [tab, setTab] = useState<PickerTab>('surah');
  const [query, setQuery] = useState('');
  const [boundaries, setBoundaries] = useState<QuranBoundaries | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBoundaries()
      .then((b) => {
        if (!cancelled) setBoundaries(b);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the search box on open / tab change (the sheet's main tool).
  useEffect(() => {
    searchRef.current?.focus();
  }, [tab]);

  // Body scroll lock while the sheet is open (restored on close).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Display name is ALWAYS the Arabic name (nameAr): the provider's
  // `name` field is the English transliteration even on the fa page,
  // and the reader's own headers show nameAr — the picker must match
  // the reader, not show a different name system. Search still matches
  // both fields (fa/ar/en typing all work).
  const surahName = (n: number): string => {
    const s = surahList.find((x) => x.number === n);
    return s ? s.nameAr : String(n);
  };

  const tabLabel: Record<PickerTab, string> = {
    surah: labels.tabSurah,
    juz: labels.tabJuz,
    hizb: labels.tabHizb,
    page: labels.tabPage,
  };

  const filteredSurahs = useMemo(() => {
    const q = query.trim();
    if (!q) return surahList;
    const digits = toLatinDigits(q);
    if (/^[0-9]+$/.test(digits)) {
      const n = Number(digits);
      return surahList.filter((s) => s.number === n);
    }
    const nq = normalizeQuranText(q);
    return surahList.filter(
      (s) => normalizeQuranText(s.name).includes(nq) || normalizeQuranText(s.nameAr).includes(nq),
    );
  }, [query, surahList]);

  const activeKind: RangeKind | null = PICKER_TABS.find((t) => t.id === tab)?.kind ?? null;
  const rangeEntries = activeKind && boundaries ? boundaries[activeKind] : null;
  const filteredRanges = useMemo(() => {
    if (!rangeEntries) return null;
    const q = query.trim();
    if (!q) return rangeEntries;
    const digits = toLatinDigits(q);
    if (/^[0-9]+$/.test(digits)) {
      const n = Number(digits);
      return rangeEntries.filter((e) => e.n === n);
    }
    const nq = normalizeQuranText(q);
    return rangeEntries.filter((e) => normalizeQuranText(surahName(e.surah)).includes(nq));
  }, [query, rangeEntries, surahList]);

  const firstPageOf = (kind: RangeKind, target: number): number => {
    if (!boundaries) return 1;
    if (kind === 'page') return target;
    if (kind === 'juz') {
      const pages = juzPages(boundaries, target);
      if (pages.length > 0) return pages[0];
    }
    const entry = boundaries[kind][target - 1];
    if (entry) {
      const p = rangeContaining(boundaries, entry.surah, entry.ayah).page;
      if (p !== null) return p;
    }
    return 1;
  };

  return (
    <QuranSheetShell title={labels.title} closeLabel={labels.closeLabel} onClose={onClose}>
      <div className="quran-sheet-tabs" role="tablist" aria-label={labels.title}>
        {PICKER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'quran-sheet-tab quran-sheet-tab-active' : 'quran-sheet-tab'}
            onClick={() => {
              setTab(t.id);
              setQuery('');
            }}
          >
            {tabLabel[t.id]}
          </button>
        ))}
      </div>
      <label className="quran-sheet-search">
        <span className="quran-sheet-search-label">{labels.searchLabel}</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchLabel}
        />
      </label>
      {tab === 'surah' ? (
        filteredSurahs.length === 0 ? (
          <p className="quran-sheet-empty" role="status">
            {labels.noResults}
          </p>
        ) : (
          <ul className="quran-picker-grid">
            {filteredSurahs.map((s) => (
              <li key={s.number}>
                <Link
                  href={`/${locale}/quran/${s.number}`}
                  className={
                    s.number === currentSurah
                      ? 'quran-picker-card quran-picker-card-current'
                      : 'quran-picker-card'
                  }
                  aria-current={s.number === currentSurah ? 'true' : undefined}
                >
                  <span className="quran-picker-num" lang="ar" dir="rtl">
                    {toArabicIndicDigits(s.number)}
                  </span>
                  <span className="quran-picker-name" lang="ar" dir="rtl">
                    {s.nameAr}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : !filteredRanges ? (
        <p className="quran-sheet-empty" role="status">
          {labels.loading}
        </p>
      ) : filteredRanges.length === 0 ? (
        <p className="quran-sheet-empty" role="status">
          {labels.noResults}
        </p>
      ) : (
        <ul className="quran-picker-grid">
          {filteredRanges.map((e) => {
            const isCurrent = currentView === activeKind && currentTarget === e.n;
            return (
              <li key={e.n}>
                <button
                  type="button"
                  className={
                    isCurrent
                      ? 'quran-picker-card quran-picker-card-current'
                      : 'quran-picker-card'
                  }
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() =>
                    activeKind && onSelectRange(activeKind, e.n, firstPageOf(activeKind, e.n))
                  }
                >
                  <span className="quran-picker-num" lang="ar" dir="rtl">
                    {toArabicIndicDigits(e.n)}
                  </span>
                  <span className="quran-picker-name" lang="ar" dir="rtl">
                    {surahName(e.surah)} · {toArabicIndicDigits(e.ayah)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </QuranSheetShell>
  );
}
