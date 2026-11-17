'use client';

/**
 * ForgotPasswordForm — request a password-reset email (Phase A).
 * The API always answers 200 (anti-enumeration), so the UI shows the
 * same "sent" note either way.
 */
import { useState } from 'react';
import { requestPasswordReset } from '@/lib/auth-client';

export interface ForgotPasswordLabels {
  email: string;
  send: string;
  sent: string;
  failed: string;
}

export default function ForgotPasswordForm({ labels }: { labels: ForgotPasswordLabels }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : labels.failed);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return <p className="page-sub">{labels.sent}</p>;
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <label>
        <span>{labels.email}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          dir="ltr"
        />
      </label>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        {busy ? '…' : labels.send}
      </button>
    </form>
  );
}
