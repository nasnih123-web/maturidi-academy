'use client';

/**
 * DonateFlow — client container for the donate form (Phase 15).
 * Thin glue: useDonate owns the state machine; DonateForm renders (ADR-001).
 */
import { useMemo } from 'react';
import { useDonate } from '@/lib/hooks/useDonate';
import { formatToman, type FinanceCampaign } from '@/lib/finance';
import { DonateForm, type DonateFormLabels } from './DonateForm';

export interface DonateFlowLabels extends DonateFormLabels {
  campaignSummary: string;
}

export function DonateFlow({
  campaign,
  campaignTitle,
  raisedLabel,
  goalLabel,
  progressLabel,
  currencySuffix,
  locale,
  labels,
}: {
  campaign: FinanceCampaign;
  campaignTitle: string;
  raisedLabel: string;
  goalLabel: string;
  progressLabel: string;
  currencySuffix: string;
  locale: string;
  labels: DonateFlowLabels;
}) {
  const donate = useDonate({ campaign, campaignTitle, locale });

  const presets = useMemo(
    () =>
      donate.presets.map((value) => ({
        value,
        label: `${formatToman(value, locale)} ${currencySuffix}`,
      })),
    [donate.presets, locale, currencySuffix],
  );

  return (
    <div className="fin-flow">
      <div className="fin-summary" aria-label={labels.campaignSummary}>
        <p className="fin-summary-title">{campaignTitle}</p>
        <p className="fin-summary-amounts">
          <span>{raisedLabel}</span>
          <span className="fin-of"> / </span>
          <span>{goalLabel}</span>
          <span className="fin-pct">{progressLabel}</span>
        </p>
      </div>
      <DonateForm
        form={donate.form}
        phase={donate.phase}
        error={donate.error}
        amountValid={donate.amountValid}
        presets={presets}
        labels={labels}
        onAmount={donate.setAmount}
        onPreset={donate.selectPreset}
        onDonorName={donate.setDonorName}
        onSubmit={donate.submit}
      />
    </div>
  );
}
