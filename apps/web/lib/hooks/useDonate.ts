'use client';

/**
 * useDonate — donate-form state machine (Phase 15).
 *
 * Owns: amount (preset/custom), donor name, validation, the idempotency key
 * lifecycle, the POST /api/v1/finance/donate call and the gateway redirect.
 * The component only renders (ADR-001).
 *
 * Idempotency guarantee: the key is generated ONCE per form session
 * (useState initializer; reloaded tabs reuse the pending key from
 * sessionStorage). Every resubmit of the same attempt sends the SAME key, so
 * a double-click or a retry after a network failure can never mint a second
 * payment intent server-side.
 */
import { useCallback, useRef, useState } from 'react';
import {
  createDonateIntent,
  findPendingKeyForCampaign,
  generateIdempotencyKey,
  savePendingDonation,
  type DonateIntent,
} from '../finance-client';
import { donatePresets, MIN_DONATE_AMOUNT, type FinanceCampaign } from '../finance';

export type DonatePhase = 'idle' | 'submitting' | 'redirecting' | 'error';

export interface DonateFormState {
  amount: string;
  donorName: string;
  selectedPreset: number | null;
}

export interface UseDonateOptions {
  campaign: FinanceCampaign;
  campaignTitle: string;
  locale: string;
}

const MIN_AMOUNT = MIN_DONATE_AMOUNT;

export function useDonate({ campaign, campaignTitle, locale }: UseDonateOptions) {
  const [form, setForm] = useState<DonateFormState>({ amount: '', donorName: '', selectedPreset: null });
  const [phase, setPhase] = useState<DonatePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastIntent, setLastIntent] = useState<DonateIntent | null>(null);

  // Generated once per form session — never regenerated on resubmit.
  const [idempotencyKey] = useState<string>(() => {
    const reused = findPendingKeyForCampaign(campaign.id);
    return reused ?? generateIdempotencyKey();
  });
  const submittingRef = useRef(false);

  const setAmount = useCallback((raw: string) => {
    // Keep only Latin digits; components format for display.
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 10);
    setForm((f) => ({ ...f, amount: digits, selectedPreset: null }));
    setError(null);
  }, []);

  const selectPreset = useCallback((preset: number) => {
    setForm((f) => ({ ...f, amount: String(preset), selectedPreset: preset }));
    setError(null);
  }, []);

  const setDonorName = useCallback((name: string) => {
    setForm((f) => ({ ...f, donorName: name.slice(0, 120) }));
  }, []);

  const amountValue = form.amount ? parseInt(form.amount, 10) : 0;
  const amountValid = Number.isFinite(amountValue) && amountValue >= MIN_AMOUNT;

  const submit = useCallback(async () => {
    if (submittingRef.current) return; // in-memory double-click guard
    if (!amountValid) return;
    submittingRef.current = true;
    setPhase('submitting');
    setError(null);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const callbackUrl = `${origin}/${locale}/donate/result`;
      const intent = await createDonateIntent({
        campaignId: campaign.id,
        amountToman: amountValue,
        donorName: form.donorName,
        callbackUrl,
        idempotencyKey,
      });
      setLastIntent(intent);
      savePendingDonation({
        campaignId: campaign.id,
        campaignTitle,
        amount: amountValue,
        donorName: form.donorName.trim() ? form.donorName.trim() : null,
        intentId: intent.intentId,
        authority: intent.authority,
        idempotencyKey,
        createdAt: Date.now(),
      });
      setPhase('redirecting');
      // Full navigation: the gateway lives on another origin.
      window.location.assign(intent.payUrl);
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'unknown');
      submittingRef.current = false;
    }
  }, [amountValid, amountValue, campaign.id, campaignTitle, form.donorName, idempotencyKey, locale]);

  return {
    form,
    phase,
    error,
    lastIntent,
    amountValue,
    amountValid,
    presets: donatePresets(),
    minAmount: MIN_AMOUNT,
    setAmount,
    selectPreset,
    setDonorName,
    submit,
  };
}
