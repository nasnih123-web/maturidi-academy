import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { MadhabKey, ZakatAssetKey } from '@/lib/calculators';
import { ZakatCalculator } from '@/components/ZakatCalculatorLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'calculators' });
  return { title: t('zakat.metaTitle'), description: t('zakat.metaDescription') };
}

/**
 * Zakat calculator page (Phase 7 — web track).
 *
 * Pure server component: the interactive calculator is code-split
 * (ssr: false) so the route stays inside the First Load JS budget
 * (docs/performance-budget.md). All strings are server-rendered and
 * passed as props — the client chunk carries no i18n runtime.
 */
export default async function ZakatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'calculators' });
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('zakat.title')}</h1>
      <p className="page-sub">{t('zakat.subtitle')}</p>
      <ZakatCalculator
        locale={locale}
        labels={{
          madhabLabel: t('zakat.madhabLabel'),
          madhabs: t.raw('madhabs') as Record<MadhabKey, string>,
          assetsTitle: t('zakat.assetsTitle'),
          assetLabels: t.raw('zakat.assetLabels') as Record<ZakatAssetKey, string>,
          assetHints: t.raw('zakat.assetHints') as Record<ZakatAssetKey, string>,
          debtsLabel: t('zakat.debtsLabel'),
          debtsHint: t('zakat.debtsHint'),
          calculate: t('zakat.calculate'),
          calculating: t('zakat.calculating'),
          invalidInput: t('zakat.invalidInput'),
          failed: t('zakat.failed'),
          pendingTitle: t('zakat.pendingTitle'),
          pendingBody: t('zakat.pendingBody'),
          recalculate: t('zakat.recalculate'),
          resultTitle: t('zakat.resultTitle'),
          zakatableTotalLabel: t('zakat.zakatableTotalLabel'),
          debtsDeductedLabel: t('zakat.debtsDeductedLabel'),
          nisabThresholdLabel: t('zakat.nisabThresholdLabel'),
          zakatDueLabel: t('zakat.zakatDueLabel'),
          ruleVersion: t.raw('zakat.ruleVersion') as string,
          rateNote: t.raw('zakat.rateNote') as string,
          rateFresh: t('zakat.rateFresh'),
          rateStale: t('zakat.rateStale'),
          rateAsOf: t.raw('zakat.rateAsOf') as string,
          ratePending: t('zakat.ratePending'),
          rateFailed: t('zakat.rateFailed'),
          print: t('zakat.print'),
        }}
      />
    </div>
  );
}
