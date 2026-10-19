import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';

const PostView = dynamic(() => import('@/components/social/PostView').then((m) => m.PostView), {
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
  return { title: t('postMetaTitle'), description: t('metaDescription') };
}

/** Post detail (Phase 10): post + like/follow + report + comments. Code-split. */
export default async function PostPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <PostView postId={decodeURIComponent(id)} locale={locale} labels={buildSocialLabels(t)} />;
}
