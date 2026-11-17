'use client';

import dynamic from 'next/dynamic';

// Client wrappers for the code-split auth forms (see RegisterFormLazy).

export const ForgotPasswordForm = dynamic(() => import('@/components/ForgotPasswordForm'), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});

export const ResetPasswordForm = dynamic(() => import('@/components/ResetPasswordForm'), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});
