import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MirasCalculator } from '@/components/MirasCalculatorLazy';
import type { MirasLabels } from '@/components/MirasCalculator';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'calculators.miras' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function MirasPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'calculators.miras' });
  const labels: MirasLabels = {
    groups: t.raw('groups') as Record<string, string>,
    heirLabels: t.raw('heirLabels') as Record<string, string>,
    genderLabel: t('genderLabel'),
    male: t('male'),
    female: t('female'),
    estateTitle: t('estateTitle'),
    estateValueLabel: t('estateValueLabel'),
    funeralLabel: t('funeralLabel'),
    debtLabel: t('debtLabel'),
    willLabel: t('willLabel'),
    willForHeirLabel: t('willForHeirLabel'),
    willApprovedLabel: t('willApprovedLabel'),
    impedimentsTitle: t('impedimentsTitle'),
    impedimentLabels: t.raw('impedimentLabels') as Record<string, string>,
    calculate: t('calculate'),
    calculating: t('calculating'),
    invalidInput: t('invalidInput'),
    failed: t('failed'),
    pendingTitle: t('pendingTitle'),
    pendingBody: t('pendingBody'),
    recalculate: t('recalculate'),
    resultTitle: t('resultTitle'),
    netEstateLabel: t('netEstateLabel'),
    willAppliedLabel: t('willAppliedLabel'),
    awlBadge: t('awlBadge'),
    raddBadge: t('raddBadge'),
    shareLabel: t('shareLabel'),
    countLabel: t('countLabel'),
    amountLabel: t('amountLabel'),
    perPersonLabel: t('perPersonLabel'),
    blockedTitle: t('blockedTitle'),
    stoppedTitle: t('stoppedTitle'),
    stopCodes: t.raw('stopCodes') as Record<string, string>,
    ruleVersion: t('ruleVersion'),
    draftNote: t('draftNote'),
  };
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <MirasCalculator labels={labels} locale={locale} />
    </div>
  );
}
