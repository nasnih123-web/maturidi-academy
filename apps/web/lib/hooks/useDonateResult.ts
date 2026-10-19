'use client';

/**
 * useDonateResult — gateway-return verification state machine (Phase 15).
 *
 * Owns: reading the gateway's Authority/Status, verifying them server-side
 * via GET /api/v1/finance/callback (the source of truth — ZarinPal is
 * re-verified there, re-entrantly), and the authenticated receipt-PDF
 * download. The component only renders (ADR-001).
 *
 * Honesty rule: when verification is impossible (no authority, unknown
 * authority, network failure) the state is `unknown`/`verifying`, never a
 * guessed success or failure.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DonateApiError,
  downloadReceiptPdf,
  findPendingDonation,
  verifyCallback,
} from '../finance-client';
import { getAccessToken } from '../auth-client';
import { formatToman } from '../finance';

export type DonateResultPhase = 'verifying' | 'success' | 'failed' | 'unknown';
export type ReceiptPhase = 'idle' | 'downloading' | 'error';

export interface UseDonateResultOptions {
  authority: string | null;
  statusParam: string;
  locale: string;
  currencySuffix: string;
  campaignsHref: string;
}

export function useDonateResult({
  authority,
  statusParam,
  locale,
  currencySuffix,
  campaignsHref,
}: UseDonateResultOptions) {
  const [phase, setPhase] = useState<DonateResultPhase>(authority ? 'verifying' : 'unknown');
  const [donationId, setDonationId] = useState<string | null>(null);
  const [receiptPhase, setReceiptPhase] = useState<ReceiptPhase>('idle');
  const [receiptForbidden, setReceiptForbidden] = useState(false);
  const ranRef = useRef(false);

  const pending = authority ? findPendingDonation(authority) : null;
  const campaignTitle = pending?.campaignTitle ?? null;
  const amountLabel = pending ? `${formatToman(pending.amount, locale)} ${currencySuffix}` : null;

  useEffect(() => {
    if (!authority || ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const v = await verifyCallback(authority, statusParam);
        if (cancelled) return;
        if (v.status === 'succeeded') {
          setDonationId(v.donationId);
          setPhase('success');
        } else {
          setPhase('failed');
        }
      } catch {
        if (cancelled) return;
        // Unknown authority or unreachable API: do not guess the outcome.
        setPhase('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authority, statusParam]);

  const downloadReceipt = useCallback(async () => {
    if (!donationId || receiptPhase === 'downloading') return;
    setReceiptPhase('downloading');
    setReceiptForbidden(false);
    try {
      const blob = await downloadReceiptPdf(donationId, getAccessToken());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${donationId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setReceiptPhase('idle');
    } catch (err) {
      setReceiptPhase('error');
      setReceiptForbidden(err instanceof DonateApiError && (err.status === 401 || err.status === 403));
    }
  }, [donationId, receiptPhase]);

  return {
    phase,
    campaignTitle,
    amountLabel,
    authority,
    receiptPhase,
    receiptForbidden,
    canDownloadReceipt: phase === 'success' && donationId !== null,
    downloadReceipt,
    retryHref: pending ? `/${locale}/donate/${encodeURIComponent(pending.campaignId)}` : campaignsHref,
  };
}
