import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';
import { FeedView } from '@/components/social/FeedViewLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('feedMetaTitle'), description: t('feedMetaDescription') };
}

/** Personal feed (Phase 10): composer + follows/groups posts. Code-split per the JS budget. */
export default async function FeedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <FeedView locale={locale} labels={buildSocialLabels(t)} />;
}
