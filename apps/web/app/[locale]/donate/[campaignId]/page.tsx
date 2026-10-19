import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCampaign, toCampaignView, formatToman, MIN_DONATE_AMOUNT } from '@/lib/finance';
import type { DonateFlowLabels } from '@/components/finance/DonateFlow';
import '../finance.css';

// Code-split: the interactive form + hook never enters the shared bundle
// (homepage First Load JS budget). SSR renders the campaign summary; the
// form hydrates client-side.
const DonateFlow = dynamic(
  () => import('@/components/finance/DonateFlow').then((m) => m.DonateFlow),
  { ssr: false, loading: () => <p className="fin-hint">…</p> },
);

export async function generateMetadata({
  params: { locale, campaignId },
}: {
  params: { locale: string; campaignId: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'donate' });
  try {
    const campaign = await getCampaign(campaignId, locale);
    return { title: `${campaign.title} — ${t('metaTitle')}` };
  } catch {
    return { title: t('metaTitle') };
  }
}

/**
 * Donate flow (Phase 15).
 *
 * Thin RSC shell: server-fetches the campaign (GET
 * /api/v1/finance/campaigns/{id}) for the summary header and localized
 * labels, then mounts the code-split DonateFlow. The idempotency key is
 * generated once per form session inside useDonate and reused on resubmit —
 * the anti-double-charge guarantee.
 */
export default async function DonateCampaignPage({
  params: { locale, campaignId },
}: {
  params: { locale: string; campaignId: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'donate' });
  const currencyLabel = t('currency');
  const minAmountLabel = `${formatToman(MIN_DONATE_AMOUNT, locale)} ${currencyLabel}`;

  let campaign;
  try {
    campaign = await getCampaign(campaignId, locale);
  } catch {
    notFound();
  }
  const view = toCampaignView(campaign, locale, currencyLabel);

  const labels: DonateFlowLabels = {
    amountTitle: t('amountTitle'),
    customAmountLabel: t('customAmountLabel'),
    customAmountPlaceholder: t('customAmountPlaceholder'),
    currencySuffix: currencyLabel,
    donorNameLabel: t('donorNameLabel'),
    donorNameOptional: t('donorNameOptional'),
    donorNamePlaceholder: t('donorNamePlaceholder'),
    minAmountHint: t('minAmountHint', { min: minAmountLabel }),
    submit: t('submit'),
    submitting: t('submitting'),
    redirecting: t('redirecting'),
    secureNote: t('secureNote'),
    oneTimeNote: t('oneTimeNote'),
    campaignSummary: t('campaignSummary'),
  };

  return (
    <div className="fin-page">
      <div className="fin-page-inner fin-narrow">
        <h1 className="fin-title">{t('donateTo', { title: view.title })}</h1>
        <p className="fin-subtitle">{t('donateSubtitle')}</p>
        <DonateFlow
          campaign={campaign}
          campaignTitle={view.title}
          raisedLabel={view.raisedLabel}
          goalLabel={view.goalLabel}
          progressLabel={view.progressLabel}
          currencySuffix={currencyLabel}
          locale={locale}
          labels={labels}
        />
        <p className="fin-back">
          <a className="fin-link" href={`/${locale}/donate`}>
            {t('backToCampaigns')}
          </a>
        </p>
      </div>
    </div>
  );
}
