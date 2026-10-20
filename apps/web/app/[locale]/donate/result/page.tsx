import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DonateResultLabels } from '@/components/finance/DonateResult';
import '../finance.css';
import { DonateResultFlow } from '@/components/finance/DonateResultFlowLazy';

// Code-split: the return-state reader (useSearchParams + sessionStorage)
// never enters the shared bundle.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'donate' });
  return { title: t('resultMetaTitle') };
}

/**
 * Gateway return page (Phase 15).
 *
 * The gateway redirects here with `?Authority=…&Status=OK|NOK`.
 * DonateResultFlow matches Authority against the pending donation saved
 * before the redirect, shows success/failure, and links the receipt PDF
 * (GET /api/v1/finance/receipts/{intent_id}).
 */
export default async function DonateResultPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'donate' });

  const labels: DonateResultLabels = {
    verifyingTitle: t('verifyingTitle'),
    verifyingBody: t('verifyingBody'),
    successTitle: t('successTitle'),
    successBody: t('successBody'),
    failedTitle: t('failedTitle'),
    failedBody: t('failedBody'),
    unknownTitle: t('unknownTitle'),
    unknownBody: t('unknownBody'),
    amountRow: t('amountRow'),
    campaignRow: t('campaignRow'),
    authorityRow: t('authorityRow'),
    receiptButton: t('receiptButton'),
    receiptDownloading: t('receiptDownloading'),
    receiptFailed: t('receiptFailed'),
    receiptAuthHint: t('receiptAuthHint'),
    receiptHint: t('receiptHint'),
    retryPayment: t('retryPayment'),
    backToCampaigns: t('backToCampaigns'),
  };

  return (
    <div className="fin-page">
      <div className="fin-page-inner fin-narrow">
        <Suspense fallback={<p className="fin-hint">…</p>}>
          <DonateResultFlow
            locale={locale}
            currencySuffix={t('currency')}
            campaignsHref={`/${locale}/donate`}
            labels={labels}
          />
        </Suspense>
      </div>
    </div>
  );
}
