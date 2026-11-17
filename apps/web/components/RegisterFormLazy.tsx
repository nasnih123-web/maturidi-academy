'use client';

import dynamic from 'next/dynamic';

// Next 15: `ssr: false` is not allowed inside a Server Component; this
// client wrapper keeps the register route code-split like the login one
// (First Load JS budget — docs/performance-budget.md).

export const RegisterForm = dynamic(() => import('@/components/RegisterForm'), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});
