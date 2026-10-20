import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VerifyPanel } from '@/components/VerifyPanelLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'verify' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Content verification page (Phase 6 — web track).
 *
 * Paste a text/quote; POST /api/v1/verify/check returns a verdict with
 * source links or "not found" plus the nearest match. Interactive panel
 * is code-split (ssr: false) per the First Load JS budget.
 */
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'verify' });
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <VerifyPanel
        locale={locale}
        labels={{
          inputLabel: t('inputLabel'),
          inputPlaceholder: t('inputPlaceholder'),
          check: t('check'),
          checking: t('checking'),
          cancel: t('cancel'),
          inputEmpty: t('inputEmpty'),
          checkFailed: t('checkFailed'),
          verdictVerifiedTitle: t('verdictVerifiedTitle'),
          verdictVerifiedBody: t('verdictVerifiedBody'),
          verdictNotFoundTitle: t('verdictNotFoundTitle'),
          verdictNotFoundBody: t('verdictNotFoundBody'),
          verdictConflictTitle: t('verdictConflictTitle'),
          verdictConflictBody: t('verdictConflictBody'),
          sourcesTitle: t('sourcesTitle'),
          nearestLabel: t('nearestLabel'),
        }}
      />
    </div>
  );
}
