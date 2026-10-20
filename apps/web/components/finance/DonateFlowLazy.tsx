'use client';

import dynamic from 'next/dynamic';

// Next 15: `ssr: false` داخل Server Component مجاز نیست؛ این wrapper
// کلاینتی همان code-split قبلیِ صفحات RSC را حفظ می‌کند
// (بودجهٔ First Load JS — docs/performance-budget.md).

export const DonateFlow = dynamic(
  () => import('@/components/finance/DonateFlow').then((m) => m.DonateFlow),
  { ssr: false, loading: () => <p className="fin-hint">…</p> },
);
