'use client';

/**
 * useManualDonate — manual-donation state machine (card / crypto / PayPal).
 *
 * Loads the server-published donation methods (GET /donation-methods —
 * disabled or unconfigured methods are simply absent), owns the form
 * state and the multipart submit. A successful submit means PENDING:
 * the donation is finalised only after an admin reviews the proof.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDonationMethods,
  submitManualDonation,
  type DonationMethod,
} from '../finance-client';

export type ManualPhase = 'loading' | 'idle' | 'submitting' | 'done' | 'error';

export type ManualMethod = DonationMethod & { method: 'card' | 'crypto' | 'paypal' };

export interface UseManualDonateOptions {
  campaignId: string;
}

export function useManualDonate({ campaignId }: UseManualDonateOptions) {
  const [methods, setMethods] = useState<ManualMethod[]>([]);
  const [online, setOnline] = useState<DonationMethod | null>(null);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [phase, setPhase] = useState<ManualPhase>('loading');
  const [selected, setSelected] = useState<string>('card');
  const [amount, setAmountRaw] = useState('');
  const [donorName, setDonorName] = useState('');
  const [proofText, setProofText] = useState('');
  const [walletIndex, setWalletIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getDonationMethods()
      .then((all) => {
        if (cancelled) return;
        const manual = all.filter(
          (m): m is ManualMethod => m.method === 'card' || m.method === 'crypto' || m.method === 'paypal',
        );
        setMethods(manual);
        setOnline(all.find((m) => m.method === 'online') ?? null);
        setMethodsLoaded(true);
        if (manual.length > 0) setSelected(manual[0].method);
        setPhase('idle');
      })
      .catch(() => {
        if (!cancelled) setPhase('idle'); // honest absence: section just hides
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const method = methods.find((m) => m.method === selected) ?? null;

  const setAmount = useCallback((raw: string) => {
    setAmountRaw(raw.replace(/[^0-9]/g, '').slice(0, 12));
    setError(null);
  }, []);

  const amountValue = amount ? parseInt(amount, 10) : 0;
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;
  const proofValid = proofText.trim().length > 0 || file !== null;

  const submit = useCallback(async () => {
    if (submittingRef.current || !method || !amountValid || !proofValid) return;
    submittingRef.current = true;
    setPhase('submitting');
    setError(null);
    try {
      const wallet = method.method === 'crypto' ? method.wallets[walletIndex] : undefined;
      await submitManualDonation({
        method: method.method,
        // The card form speaks TOMAN like the gateway form on this page;
        // the API speaks IRR (×10). Other methods: whole currency units.
        amount: method.method === 'card' ? amountValue * 10 : amountValue,
        campaignId,
        donorName,
        proofText,
        walletCurrency: wallet?.currency,
        walletNetwork: wallet?.network,
        receiptFile: file,
      });
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'unknown');
      submittingRef.current = false;
    }
  }, [method, amountValid, proofValid, amountValue, campaignId, donorName, proofText, walletIndex, file]);

  return {
    methods,
    online,
    methodsLoaded,
    method,
    phase,
    error,
    amount,
    donorName,
    proofText,
    walletIndex,
    file,
    amountValid,
    proofValid,
    setSelected,
    setAmount,
    setDonorName,
    setProofText,
    setWalletIndex,
    setFile,
    submit,
  };
}
