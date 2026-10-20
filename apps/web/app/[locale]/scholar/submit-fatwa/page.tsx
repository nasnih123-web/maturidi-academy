import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { FatwaSubmitLabels } from '@/components/social/labels';
import { SubmitFatwaView } from '@/components/fatwa/SubmitFatwaViewLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return { title: t('submit.metaTitle'), description: t('submit.metaDescription') };
}

/**
 * Scholar fatwa submission (Phase 10): title/body/madhab/evidence form,
 * visible only to the scholar_author role. POST /api/v1/fatwa/submissions
 * enters the shared workflow (draft → in_review → …). Code-split.
 */
export default async function SubmitFatwaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const tCalc = await getTranslations({ locale, namespace: 'calculators' });
  const madhabOptions: Record<string, string> = {};
  for (const m of ['hanafi', 'maliki', 'shafi', 'hanbali']) {
    madhabOptions[m] = tCalc(`madhabs.${m}`);
  }
  const labels: FatwaSubmitLabels = {
    title: t('submit.title'),
    subtitle: t('submit.subtitle'),
    titleLabel: t('submit.titleLabel'),
    titlePlaceholder: t('submit.titlePlaceholder'),
    bodyLabel: t('submit.bodyLabel'),
    bodyPlaceholder: t('submit.bodyPlaceholder'),
    madhabLabel: t('submit.madhabLabel'),
    madhabOptions,
    evidenceLabel: t('submit.evidenceLabel'),
    evidencePlaceholder: t('submit.evidencePlaceholder'),
    submit: t('submit.submit'),
    submitting: t('submit.submitting'),
    successTitle: t('submit.successTitle'),
    successBody: t('submit.successBody'),
    error: t('submit.error'),
    forbidden: t('submit.forbidden'),
  };
  return <SubmitFatwaView labels={labels} />;
}
