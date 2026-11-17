'use client';

import dynamic from 'next/dynamic';

// Client wrapper for the code-split verify-email panel (see RegisterFormLazy).

export const VerifyEmailPanel = dynamic(() => import('@/components/VerifyEmailPanel'), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});
