import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';
import { GroupView } from '@/components/social/GroupViewLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('groupMetaTitle'), description: t('metaDescription') };
}

/** Group page (Phase 10): header + join/leave + group posts. Code-split like the directory. */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ locale: string; groupId: string }>;
}) {
  const { locale, groupId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <GroupView groupId={decodeURIComponent(groupId)} locale={locale} labels={buildSocialLabels(t)} />;
}
