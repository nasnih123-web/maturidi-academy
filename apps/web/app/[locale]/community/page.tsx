import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildSocialLabels } from '@/lib/social-labels';
import { CommunityView } from '@/components/social/CommunityViewLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Community group directory (Phase 10 — web track).
 *
 * Pure server component: the interactive directory is code-split
 * (ssr: false) so the route stays inside the First Load JS budget
 * (docs/performance-budget.md). All strings are server-rendered and
 * passed as props; all I/O lives in lib/social.ts + lib/hooks/useSocial.ts
 * (ADR-001).
 */
export default async function CommunityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  return <CommunityView locale={locale} labels={buildSocialLabels(t)} />;
}
