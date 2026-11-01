import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSurahs } from '@/lib/quran';
import { SurahIndex } from '@/components/SurahIndex';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Quran index — user-locked 2026-11-01: ONLY the three section cards
 * (عموم / حفاظ / کودکان) plus a search box above them. No surah list,
 * no surah search tools, no juz shortcuts. The surah list is fetched
 * only so the search box can match surah names (fa/ar/en); if it fails,
 * the cards still render and search falls back to ayah/page search.
 */
export default async function QuranIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });

  let surahs: Awaited<ReturnType<typeof getSurahs>> = [];
  try {
    surahs = await getSurahs();
  } catch {
    surahs = [];
  }

  return (
    <div className="page-wrap">
      <SurahIndex
        locale={locale}
        surahs={surahs}
        labels={{
          title: t('title'),
          sectionsTitle: t('sectionsTitle'),
          sectionGeneral: t('tabGeneral'),
          sectionHifz: t('tabHifz'),
          sectionChildren: t('tabChildren'),
        }}
        searchLabels={{
          searchPlaceholder: t('searchPlaceholder'),
          searchAria: t('searchAria'),
          searchHint: t('searchHint'),
          searchLoading: t('searchLoading'),
          noResults: t('noResults'),
          searchSurahHeading: t('searchSurahHeading'),
          searchAyahHeading: t('searchAyahHeading'),
          searchPageHeading: t('searchPageHeading'),
          searchPageOutOfRange: t('searchPageOutOfRange'),
          searchMore: t('searchMore'),
        }}
      />
    </div>
  );
}
