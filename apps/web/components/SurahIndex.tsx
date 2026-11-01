'use client';

/**
 * SurahIndex — the Quran menu page.
 *
 * User-locked 2026-11-01: ONLY the three section cards (عموم / حفاظ /
 * کودکان) plus the search box above them. NO surah list, NO surah
 * search tools, NO juz shortcuts on this page — finding a surah, ayah
 * or page happens through the search box.
 */
import Link from 'next/link';
import type { SurahSummary } from '@/lib/quran';
import { QuranSearchBox, type QuranSearchLabels } from './QuranSearchBox';

export interface SurahIndexLabels {
  title: string;
  /** Section title above the three section cards. */
  sectionsTitle: string;
  /** Card labels — the SAME strings as the old reader tabs. */
  sectionGeneral: string;
  sectionHifz: string;
  sectionChildren: string;
}

export function SurahIndex({
  locale,
  surahs,
  labels,
  searchLabels,
}: {
  locale: string;
  surahs: SurahSummary[];
  labels: SurahIndexLabels;
  searchLabels: QuranSearchLabels;
}) {
  return (
    <div className="surah-index">
      <h1 className="page-title">{labels.title}</h1>

      <QuranSearchBox locale={locale} surahs={surahs} labels={searchLabels} />

      <h2 className="quran-sections-title">{labels.sectionsTitle}</h2>
      <nav className="quran-section-cards" aria-label={labels.sectionsTitle}>
        <Link href={`/${locale}/quran/1`} className="quran-section-card">
          {labels.sectionGeneral}
        </Link>
        <Link href={`/${locale}/quran/1?tab=hifz`} className="quran-section-card">
          {labels.sectionHifz}
        </Link>
        <Link href={`/${locale}/quran/1?tab=children`} className="quran-section-card">
          {labels.sectionChildren}
        </Link>
      </nav>
    </div>
  );
}
