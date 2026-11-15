'use client';

/**
 * ManualDonate — client container for manual donation methods
 * (card-to-card / crypto / PayPal). Thin glue: useManualDonate owns the
 * state machine; ManualDonateForm renders (ADR-001). Renders nothing
 * when no manual method is enabled/configured server-side.
 */
import { useManualDonate } from '@/lib/hooks/useManualDonate';
import { ManualDonateForm, type ManualDonateLabels } from './ManualDonateForm';

export type { ManualDonateLabels };

export function ManualDonate({
  campaignId,
  locale,
  labels,
}: {
  campaignId: string;
  locale: string;
  labels: ManualDonateLabels;
}) {
  const manual = useManualDonate({ campaignId });
  if (manual.phase === 'loading') return null;
  return (
    <ManualDonateForm
      methods={manual.methods}
      method={manual.method}
      phase={manual.phase}
      error={manual.error}
      amount={manual.amount}
      donorName={manual.donorName}
      proofText={manual.proofText}
      walletIndex={manual.walletIndex}
      amountValid={manual.amountValid}
      proofValid={manual.proofValid}
      locale={locale}
      labels={labels}
      onSelect={manual.setSelected}
      onAmount={manual.setAmount}
      onDonorName={manual.setDonorName}
      onProofText={manual.setProofText}
      onWalletIndex={manual.setWalletIndex}
      onFile={manual.setFile}
      onSubmit={manual.submit}
    />
  );
}
