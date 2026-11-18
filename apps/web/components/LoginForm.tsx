'use client';

/**
 * LoginForm — sign-in form (code-split from the login page so the route
 * stays inside the performance budget; see docs/performance-budget.md).
 * Auth logic lives in lib/auth-client.ts; this is presentation + wiring.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { EyeIcon } from './SetPasswordForm';

function safeNext(raw: string | null): string {
  if (!raw) return '/';
  // Same-origin path only — never an absolute URL or protocol-relative.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export interface LoginFormLabels {
  identifier: string;
  password: string;
  totp: string;
  signIn: string;
  loginFailed: string;
  forgot: string;
  noAccount: string;
  signUp: string;
  showPassword: string;
  hidePassword: string;
}

export default function LoginForm({ labels, locale }: { labels: LoginFormLabels; locale: string }) {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password, showTotp ? totp.trim() || undefined : undefined);
      router.push(safeNext(searchParams.get('next')));
      router.refresh();
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 2FA-gated accounts: the API answers 401 with a TOTP hint; simplest
      // honest UX is to reveal the TOTP field and let the user retry.
      if (status === 401 && !showTotp) setShowTotp(true);
      setError(err instanceof Error ? err.message : labels.loginFailed);
    } finally {
      setBusy(false);
    }
  };

  const rawNext = searchParams.get('next');
  const registerHref = `/${locale}/register${rawNext ? `?next=${encodeURIComponent(rawNext)}` : ''}`;

  return (
    <>
      <form onSubmit={submit} className="auth-form">
          <label>
            <span>{labels.identifier}</span>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
              dir="ltr"
            />
          </label>
          <label>
            <span>{labels.password}</span>
            <span className="pw-field">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                dir="ltr"
              />
              <button
                type="button"
                className="pw-eye"
                aria-label={showPw ? labels.hidePassword : labels.showPassword}
                onClick={() => setShowPw((v) => !v)}
              >
                <EyeIcon off={showPw} />
              </button>
            </span>
          </label>
          {showTotp ? (
            <label>
              <span>{labels.totp}</span>
              <input
                type="text"
                inputMode="numeric"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                autoComplete="one-time-code"
                dir="ltr"
              />
            </label>
          ) : null}
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy}>
            {busy ? '…' : labels.signIn}
          </button>
      </form>
      <div className="auth-links">
        <Link href={`/${locale}/forgot-password`}>{labels.forgot}</Link>
        <span>
          {labels.noAccount} <Link href={registerHref}>{labels.signUp}</Link>
        </span>
      </div>
    </>
  );
}
