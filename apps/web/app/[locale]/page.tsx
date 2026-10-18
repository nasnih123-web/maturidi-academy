import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getHomeSections, API_BASE_URL, ApiError } from '@/lib/api';
import { themeCssText } from '@/lib/theme';
import { getNavColumns } from '@/lib/section-data';
import { HomeSections } from '@/components/home/HomeSections';
import { SiteFooter } from '@/components/home/SiteFooter';
import type { SearchLabels } from '@/components/home/SearchBox';
import type { HomeSection } from '@/lib/types';

export function generateStaticParams() {
  return [{ locale: 'fa' }, { locale: 'ar' }, { locale: 'en' }];
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'home' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

function searchLabels(t: Awaited<ReturnType<typeof getTranslations>>): SearchLabels {
  return {
    label: t('search.label'),
    placeholder: t('search.placeholder'),
    loading: t('search.loading'),
    noResults: t('search.noResults'),
    resultsSummaryTemplate: t('search.resultsSummary'),
    searchUnavailable: t('search.searchUnavailable'),
    clear: t('search.clear'),
    typeNames: {
      fatwa: t('search.types.fatwa'),
      lesson: t('search.types.lesson'),
      book: t('search.types.book'),
      verse: t('search.types.verse'),
      article: t('search.types.article'),
      course: t('search.types.course'),
      page: t('search.types.page'),
    },
  };
}

/**
 * Homepage (Phase 3): React Server Component.
 * All 10 sections come from GET /api/v1/home/sections — rendered in `order`,
 * skipping `visible: false`. If the API is unreachable we render a graceful,
 * localized error state (contract §15: no mock data, never fake sections).
 * The only client-side JS on this page is the search box.
 */
export default async function HomePage({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'home' });
  const tRoot = await getTranslations({ locale });

  let sections: HomeSection[] = [];
  let themeCss = '';
  let footerSection: HomeSection | null = null;
  let apiFailed = false;

  try {
    const res = await getHomeSections();
    sections = res.sections;
    themeCss = themeCssText(res.theme);
    footerSection = res.sections.find((s) => s.key === 'footer' && s.visible !== false) ?? null;
  } catch (err) {
    apiFailed = true;
    // eslint-disable-next-line no-console
    console.error('[web] home sections fetch failed:', err instanceof ApiError ? err.message : err);
  }

  const year = String(new Date().getFullYear());

  return (
    <div className="ma-page">
      {themeCss ? <style>{themeCss}</style> : null}
      <a className="ma-skip" href="#ma-main">
        {t('skipToContent')}
      </a>

      <header className="ma-header" aria-label={t('headerLandmark')}>
        <div className="ma-header__inner">
          <a className="ma-brand" href={`/${locale}`}>
            {tRoot('appName')}
          </a>
        </div>
      </header>

      <main id="ma-main" className="ma-main" aria-label={t('mainLandmark')}>
        {apiFailed ? (
          <div className="ma-error" role="alert">
            <h1>{t('errorTitle')}</h1>
            <p>{t('errorDescription')}</p>
            <a className="ma-error__retry" href={`/${locale}`}>
              {t('errorRetry')}
            </a>
          </div>
        ) : (
          <HomeSections
            sections={sections}
            locale={locale}
            apiBaseUrl={API_BASE_URL}
            searchLabels={searchLabels(t)}
            emptyFallback={t('emptyFallback')}
          />
        )}
      </main>

      <SiteFooter
        brand={tRoot('appName')}
        tagline={tRoot('tagline')}
        navLabel={t('footer.navLabel')}
        localeLabel={t('footer.localeLabel')}
        rights={t('footer.rights', { year })}
        locale={locale}
        columns={footerSection ? getNavColumns(footerSection.data, locale) : []}
      />
    </div>
  );
}
