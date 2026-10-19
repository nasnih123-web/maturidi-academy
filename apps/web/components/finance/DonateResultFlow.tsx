'use client';

/**
 * DonateResultFlow — client container for the gateway return page (Phase 15).
 * Thin glue: useDonateResult owns verification + receipt download;
 * DonateResult renders (ADR-001).
 */
import { useSearchParams } from 'next/navigation';
import { useDonateResult } from '@/lib/hooks/useDonateResult';
import { DonateResult, type DonateResultLabels } from './DonateResult';

export function DonateResultFlow({
  locale,
  currencySuffix,
  campaignsHref,
  labels,
}: {
  locale: string;
  currencySuffix: string;
  campaignsHref: string;
  labels: DonateResultLabels;
}) {
  const searchParams = useSearchParams();
  const authority = searchParams.get('Authority') ?? searchParams.get('authority');
  const statusParam = (searchParams.get('Status') ?? searchParams.get('status') ?? '').toUpperCase();

  const result = useDonateResult({ authority, statusParam, locale, currencySuffix, campaignsHref });

  return (
    <DonateResult
      status={result.phase}
      campaignTitle={result.campaignTitle}
      amountLabel={result.amountLabel}
      authority={result.authority}
      showReceipt={result.canDownloadReceipt}
      receiptBusy={result.receiptPhase === 'downloading'}
      receiptFailed={result.receiptPhase === 'error'}
      receiptForbidden={result.receiptForbidden}
      onReceipt={result.downloadReceipt}
      retryHref={result.retryHref}
      campaignsHref={campaignsHref}
      labels={labels}
    />
  );
}
