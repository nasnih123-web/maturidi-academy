import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSiteConfig } from '@/lib/settings';
import { AdhanWidget } from '@/components/AdhanWidget';

/** Adhan widget page — prayer times from GET /api/v1/adhan/times only. */
export default async function AdhanPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'adhan' });
  const siteConfig = await getSiteConfig();

  return (
    <div className="page-wrap">
      <AdhanWidget
        locale={locale}
        settings={siteConfig.adhan}
        labels={{
          title: t('title'),
          subtitle: t('subtitle'),
          nextPrayer: t('nextPrayer'),
          prayerNames: {
            imsak: t('prayers.imsak'),
            fajr: t('prayers.fajr'),
            sunrise: t('prayers.sunrise'),
            dhuhr: t('prayers.dhuhr'),
            asr: t('prayers.asr'),
            maghrib: t('prayers.maghrib'),
            isha: t('prayers.isha'),
            midnight: t('prayers.midnight'),
          },
          useGps: t('useGps'),
          manualTitle: t('manualTitle'),
          latLabel: t('latLabel'),
          lngLabel: t('lngLabel'),
          cityLabel: t('cityLabel'),
          applyLocation: t('applyLocation'),
          changeLocation: t('changeLocation'),
          hijriLabel: t('hijriLabel'),
          methodLabel: t('methodLabel'),
          needsLocation: t('needsLocation'),
          timesFailed: t('timesFailed'),
          timesInvalid: t('timesInvalid'),
          gpsDenied: t('gpsDenied'),
          gpsUnsupported: t('gpsUnsupported'),
          invalidCoords: t('invalidCoords'),
          countdownAria: t('countdownAria'),
        }}
      />
    </div>
  );
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'adhan' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}
