import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';
import { PostView } from '@/components/social/PostViewLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('postMetaTitle'), description: t('metaDescription') };
}

/** Post detail (Phase 10): post + like/follow + report + comments. Code-split. */
export default async function PostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <PostView postId={decodeURIComponent(id)} locale={locale} labels={buildSocialLabels(t)} />;
}
