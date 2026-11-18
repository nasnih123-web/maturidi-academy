'use client';

/**
 * ResetPasswordForm — set a new password from the emailed reset link
 * (Phase A). The token rides in the query string; without it the page
 * shows the invalid-link note instead of a form.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { confirmPasswordReset } from '@/lib/auth-client';
import { SetPasswordForm } from './SetPasswordForm';

export interface ResetPasswordLabels {
  password: string;
  confirmPassword: string;
  finish: string;
  mismatch: string;
  tooShort: string;
  failed: string;
  showPassword: string;
  hidePassword: string;
  passwordStrength: string;
  strengthWeak: string;
  strengthMedium: string;
  strengthStrong: string;
  invalid: string;
  done: string;
  goToLogin: string;
}

export default function ResetPasswordForm({
  locale,
  labels,
}: {
  locale: string;
  labels: ResetPasswordLabels;
}) {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <p className="auth-error" role="alert">
        {labels.invalid}
      </p>
    );
  }

  if (done) {
    return (
      <div>
        <p className="page-sub">{labels.done}</p>
        <p className="auth-links">
          <Link href={`/${locale}/login`}>{labels.goToLogin}</Link>
        </p>
      </div>
    );
  }

  return (
    <SetPasswordForm
      labels={{
        password: labels.password,
        confirmPassword: labels.confirmPassword,
        finish: labels.finish,
        mismatch: labels.mismatch,
        tooShort: labels.tooShort,
        failed: labels.failed,
        showPassword: labels.showPassword,
        hidePassword: labels.hidePassword,
        passwordStrength: labels.passwordStrength,
        strengthWeak: labels.strengthWeak,
        strengthMedium: labels.strengthMedium,
        strengthStrong: labels.strengthStrong,
      }}
      onComplete={async (pw) => {
        await confirmPasswordReset(token, pw);
        setDone(true);
      }}
    />
  );
}
