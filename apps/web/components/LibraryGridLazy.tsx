'use client';

import dynamic from 'next/dynamic';

// Next 15: `ssr: false` داخل Server Component مجاز نیست؛ این wrapper
// کلاینتی همان code-split قبلیِ صفحات RSC را حفظ می‌کند
// (بودجهٔ First Load JS — docs/performance-budget.md).

export const LibraryGrid = dynamic(
  () => import('@/components/LibraryGrid').then((m) => m.LibraryGrid),
  { ssr: false, loading: () => <p className="lib-status">…</p> },
);
