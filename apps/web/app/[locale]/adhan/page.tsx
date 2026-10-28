import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSiteConfig } from '@/lib/settings';
import { AdhanTimesPage, type AdhanTimesPageLabels } from '@/components/AdhanTimesPage';

/** Adhan page — full prayer-times page: hero, methods, city, week/month/year. */
export default async function AdhanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'adhan' });
  const siteConfig = await getSiteConfig();

  const labels: AdhanTimesPageLabels = {
    title: t('title'),
    subtitle: t('subtitle'),
    nextPrayer: t('nextPrayer'),
    prayers: t.raw('prayers'),
    methodLabel: t('methodLabel'),
    madhabLabel: t('madhabLabel'),
    madhabHanafi: t('madhabHanafi'),
    madhabShafi: t('madhabShafi'),
    madhabNote: t('madhabNote'),
    citySelectLabel: t('citySelectLabel'),
    useMyLocation: t('useMyLocation'),
    customLocation: t('customLocation'),
    customLocationHint: t('customLocationHint'),
    tabWeek: t('tabWeek'),
    tabMonth: t('tabMonth'),
    tabYear: t('tabYear'),
    methods: t.raw('methods'),
    cities: t.raw('cities'),
    jalaliMonths: t.raw('jalaliMonths'),
    diffLabel: t('diffLabel'),
    sourceTable: t('sourceTable'),
    sourceComputed: t('sourceComputed'),
    sourceMixed: t('sourceMixed'),
    transparencyTitle: t('transparencyTitle'),
    transparencyMethod: t('transparencyMethod'),
    transparencyAsr: t('transparencyAsr'),
    trueDawnNote: t('trueDawnNote'),
    scholarNote: t('scholarNote'),
    loading: t('loading'),
    loadFailed: t('loadFailed'),
    retry: t('retry'),
    jalaliLabel: t('jalaliLabel'),
    miladiLabel: t('miladiLabel'),
    qamariLabel: t('qamariLabel'),
    tableToday: t('tableToday'),
    methodUnavailable: t('methodUnavailable'),
    maghribSunset: t('maghribSunset'),
    stripPrefix: t('stripPrefix'),
    countdownAria: t('countdownAria'),
    gpsDenied: t('gpsDenied'),
    gpsUnsupported: t('gpsUnsupported'),
    timesFailed: t('timesFailed'),
  };

  return (
    <div className="page-wrap">
      <AdhanTimesPage locale={locale} settings={siteConfig.adhan} labels={labels} />
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'adhan' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}
