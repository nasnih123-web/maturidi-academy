'use client';

import dynamic from 'next/dynamic';

// Code-split like the login/register routes (First Load JS budget).
export const ProfileSettings = dynamic(() => import('@/components/ProfileSettings'), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});
