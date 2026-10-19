import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';

const GroupView = dynamic(() => import('@/components/social/GroupView').then((m) => m.GroupView), {
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
  return { title: t('groupMetaTitle'), description: t('metaDescription') };
}

/** Group page (Phase 10): header + join/leave + group posts. Code-split like the directory. */
export default async function GroupPage({
  params: { locale, groupId },
}: {
  params: { locale: string; groupId: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <GroupView groupId={decodeURIComponent(groupId)} locale={locale} labels={buildSocialLabels(t)} />;
}
