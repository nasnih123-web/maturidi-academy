import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';

const FeedView = dynamic(() => import('@/components/social/FeedView').then((m) => m.FeedView), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('feedMetaTitle'), description: t('feedMetaDescription') };
}

/** Personal feed (Phase 10): composer + follows/groups posts. Code-split per the JS budget. */
export default async function FeedPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <FeedView locale={locale} labels={buildSocialLabels(t)} />;
}
