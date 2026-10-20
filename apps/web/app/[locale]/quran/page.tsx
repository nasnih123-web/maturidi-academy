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
 * Quran index — server-rendered from GET /api/v1/quran/surahs.
 * Quran text is never hardcoded; on API failure an error state renders.
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
  let failed = false;
  try {
    surahs = await getSurahs();
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="page-wrap">
        <h1 className="page-title">{t('title')}</h1>
        <p className="error-state" role="alert">
          {t('loadFailed')}
        </p>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <SurahIndex
        locale={locale}
        surahs={surahs}
        labels={{
          title: t('title'),
          searchPlaceholder: t('searchPlaceholder'),
          searchAria: t('searchAria'),
          juzLabel: t('juzLabel'),
          allJuz: t('allJuz'),
          ayahsCount: t('ayahsCount'),
          noResults: t('noResults'),
          meccan: t('meccan'),
          medinan: t('medinan'),
        }}
      />
    </div>
  );
}
