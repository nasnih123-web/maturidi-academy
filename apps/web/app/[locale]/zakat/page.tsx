import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { MadhabKey, ZakatAssetKey } from '@/lib/calculators';
import { ZakatCalculator } from '@/components/ZakatCalculatorLazy';
import { ZakatExtendedCalculator } from '@/components/ZakatExtendedCalculatorLazy';
import type { ZakatExtendedLabels } from '@/components/ZakatExtendedCalculator';

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
      <h2 className="page-title">{t('zakatExtended.title')}</h2>
      <p className="page-sub">{t('zakatExtended.subtitle')}</p>
      <ZakatExtendedCalculator
        locale={locale}
        labels={{
          moneyTitle: t('zakatExtended.moneyTitle'),
          moneyAmountLabel: t('zakatExtended.moneyAmountLabel'),
          coinPriceLabel: t('zakatExtended.coinPriceLabel'),
          goldLabel: t('zakatExtended.goldLabel'),
          silverLabel: t('zakatExtended.silverLabel'),
          gramsHint: t('zakatExtended.gramsHint'),
          livestockTitle: t('zakatExtended.livestockTitle'),
          sheepLabel: t('zakatExtended.sheepLabel'),
          cowsLabel: t('zakatExtended.cowsLabel'),
          musinnaPriceLabel: t('zakatExtended.musinnaPriceLabel'),
          camelsLabel: t('zakatExtended.camelsLabel'),
          horsesLabel: t('zakatExtended.horsesLabel'),
          horsesValueLabel: t('zakatExtended.horsesValueLabel'),
          oshrTitle: t('zakatExtended.oshrTitle'),
          oshrAmountLabel: t('zakatExtended.oshrAmountLabel'),
          irrigationLabel: t('zakatExtended.irrigationLabel'),
          rainFed: t('zakatExtended.rainFed'),
          irrigated: t('zakatExtended.irrigated'),
          khomsTitle: t('zakatExtended.khomsTitle'),
          khomsAmountLabel: t('zakatExtended.khomsAmountLabel'),
          calculate: t('zakatExtended.calculate'),
          calculating: t('zakatExtended.calculating'),
          invalidInput: t('zakatExtended.invalidInput'),
          failed: t('zakatExtended.failed'),
          pendingTitle: t('zakatExtended.pendingTitle'),
          pendingBody: t('zakatExtended.pendingBody'),
          recalculate: t('zakatExtended.recalculate'),
          resultTitle: t('zakatExtended.resultTitle'),
          nisabMet: t('zakatExtended.nisabMet'),
          nisabNotMet: t('zakatExtended.nisabNotMet'),
          zakatCoinsLabel: t('zakatExtended.zakatCoinsLabel'),
          zakatAmountLabel: t('zakatExtended.zakatAmountLabel'),
          zakatGramsLabel: t('zakatExtended.zakatGramsLabel'),
          dueLabel: t('zakatExtended.dueLabel'),
          dueKinds: t.raw('zakatExtended.dueKinds') as Record<string, string>,
          ageYears: t('zakatExtended.ageYears'),
          fortiethsLabel: t('zakatExtended.fortiethsLabel'),
          extraMoneyLabel: t('zakatExtended.extraMoneyLabel'),
          horseRuleNote: t('zakatExtended.horseRuleNote'),
          horseDinarLabel: t('zakatExtended.horseDinarLabel'),
          horseValueLabel: t('zakatExtended.horseValueLabel'),
          oshrDueLabel: t('zakatExtended.oshrDueLabel'),
          khomsDueLabel: t('zakatExtended.khomsDueLabel'),
          ruleVersion: t.raw('zakatExtended.ruleVersion') as string,
          draftNote: t('zakatExtended.draftNote'),
        }}
      />
    </div>
  );
}
