import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OfflineSettingsClient, type OfflineSettingsLabels } from '@/components/OfflineSettingsClient';

/**
 * Offline & notification settings page — download priorities
 * (GET /api/v1/sync/offline-pack) + web-push subscription.
 */

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'offline' });
  return { title: t('settingsMetaTitle') };
}

export default async function OfflineSettingsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'offline' });
  const labels: OfflineSettingsLabels = {
    title: t('settingsTitle'),
    subtitle: t('settingsSubtitle'),
    tiersTitle: t('tiersTitle'),
    tiersHint: t('tiersHint'),
    tierStarted: t('tierStarted'),
    tierFollowed: t('tierFollowed'),
    tierPopular: t('tierPopular'),
    tierStartedDesc: t('tierStartedDesc'),
    tierFollowedDesc: t('tierFollowedDesc'),
    tierPopularDesc: t('tierPopularDesc'),
    items: t('items'),
    prefetch: t('prefetch'),
    prefetching: t('prefetching'),
    prefetched: t('prefetched'),
    prefetchFailed: t('prefetchFailed'),
    loading: t('loading'),
    loadFailed: t('loadFailed'),
    packEmpty: t('packEmpty'),
    pushTitle: t('pushTitle'),
    pushHint: t('pushHint'),
    pushEnable: t('pushEnable'),
    pushDisable: t('pushDisable'),
    pushWorking: t('pushWorking'),
    pushFailed: t('pushFailed'),
    pushUnsupported: t('pushUnsupported'),
    pushDenied: t('pushDenied'),
    pushSubscribed: t('pushSubscribed'),
    pushUnsubscribed: t('pushUnsubscribed'),
  };
  return (
    <main className="offline-settings-page">
      <OfflineSettingsClient locale={locale} labels={labels} />
    </main>
  );
}
