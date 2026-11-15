import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCampaign, toCampaignView, formatToman, MIN_DONATE_AMOUNT } from '@/lib/finance';
import type { DonateFormLabels } from '@/components/finance/DonateForm';
import type { ManualDonateLabels } from '@/components/finance/ManualDonateForm';
import type { DonatePaymentLabels } from '@/components/finance/DonatePayment';
import '../finance.css';
import { DonatePayment } from '@/components/finance/DonatePaymentLazy';

// Code-split: the interactive payment section + hooks never enter the
// shared bundle (homepage First Load JS budget). SSR renders the
// campaign summary; the payment section hydrates client-side.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; campaignId: string }>;
}): Promise<Metadata> {
  const { locale, campaignId } = await params;
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
 * Donate page (Phase 15; unified payment section).
 *
 * Thin RSC shell: server-fetches the campaign (GET
 * /api/v1/finance/campaigns/{id}) for the summary header and localized
 * labels, then mounts the code-split DonatePayment section — one panel
 * with rial (gateway / card-to-card) and dollar (crypto / PayPal)
 * branches; only server-published methods render. The idempotency key
 * is generated once per form session inside useDonate and reused on
 * resubmit — the anti-double-charge guarantee.
 */
export default async function DonateCampaignPage({
  params,
}: {
  params: Promise<{ locale: string; campaignId: string }>;
}) {
  const { locale, campaignId } = await params;
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

  const labels: DonateFormLabels = {
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
  };

  const manualLabels: ManualDonateLabels = {
    title: t('manualTitle'),
    intro: t('manualIntro'),
    amountLabel: t('manualAmountLabel'),
    tomanSuffix: currencyLabel,
    usdSuffix: t('manualUsdSuffix'),
    donorNameLabel: t('donorNameLabel'),
    donorNameOptional: t('donorNameOptional'),
    donorNamePlaceholder: t('donorNamePlaceholder'),
    proofTextLabel: t('manualProofTextLabel'),
    proofTextPlaceholder: t('manualProofTextPlaceholder'),
    receiptLabel: t('manualReceiptLabel'),
    submit: t('manualSubmit'),
    submitting: t('manualSubmitting'),
    successTitle: t('manualSuccessTitle'),
    successBody: t('manualSuccessBody'),
    copy: t('manualCopy'),
    copied: t('manualCopied'),
    cardNumberLabel: t('manualCardNumberLabel'),
    cardHolderLabel: t('manualCardHolderLabel'),
    walletLabel: t('manualWalletLabel'),
    paypalAccountLabel: t('manualPaypalAccountLabel'),
    errorGeneric: t('manualErrorGeneric'),
  };

  const payLabels: DonatePaymentLabels = {
    payTitle: t('payTitle'),
    branchRial: t('branchRial'),
    branchUsd: t('branchUsd'),
    onlineTitle: t('onlineMethodTitle'),
  };

  return (
    <div className="fin-page">
      <div className="fin-page-inner fin-narrow">
        <h1 className="fin-title">{t('donateTo', { title: view.title })}</h1>
        <p className="fin-subtitle">{t('donateSubtitle')}</p>
        <div className="fin-summary" aria-label={t('campaignSummary')}>
          <p className="fin-summary-title">{view.title}</p>
          <p className="fin-summary-amounts">
            <span>{view.raisedLabel}</span>
            <span className="fin-of"> / </span>
            <span>{view.goalLabel}</span>
            <span className="fin-pct">{view.progressLabel}</span>
          </p>
        </div>
        <DonatePayment
          campaign={campaign}
          campaignTitle={view.title}
          locale={locale}
          currencySuffix={currencyLabel}
          flowLabels={labels}
          manualLabels={manualLabels}
          payLabels={payLabels}
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
