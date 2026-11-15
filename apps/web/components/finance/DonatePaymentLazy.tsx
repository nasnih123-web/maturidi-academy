'use client';

import dynamic from 'next/dynamic';

// Same code-split pattern as the former DonateFlowLazy/ManualDonateLazy:
// the unified payment section (hooks + forms) never enters the shared
// bundle; it hydrates client-side only.

export const DonatePayment = dynamic(
  () => import('@/components/finance/DonatePayment').then((m) => m.DonatePayment),
  { ssr: false, loading: () => <p className="fin-hint">…</p> },
);
