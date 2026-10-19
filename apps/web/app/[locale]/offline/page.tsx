import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

/**
 * Offline fallback page — served by the service worker when a navigation
 * fails and the user is offline. Fully static, no API calls.
 */

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'offline' });
  return { title: t('pageMetaTitle'), robots: { index: false } };
}

export default async function OfflinePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'offline' });
  return (
    <main className="offline-page" aria-labelledby="offline-title">
      <div className="offline-card">
        <div className="offline-orb" aria-hidden="true" />
        <h1 id="offline-title">{t('pageTitle')}</h1>
        <p>{t('pageBody')}</p>
        <a className="offline-retry" href={`/${locale}`}>
          {t('retry')}
        </a>
      </div>
    </main>
  );
}
