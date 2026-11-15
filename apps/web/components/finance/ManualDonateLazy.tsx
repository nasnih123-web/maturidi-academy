'use client';

import dynamic from 'next/dynamic';

// Same code-split pattern as DonateFlowLazy: the manual-donation form
// never enters the shared bundle; it hydrates client-side only.

export const ManualDonate = dynamic(
  () => import('@/components/finance/ManualDonate').then((m) => m.ManualDonate),
  { ssr: false, loading: () => null },
);
