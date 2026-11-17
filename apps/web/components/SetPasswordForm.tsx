'use client';

/**
 * SetPasswordForm — shared "choose your password" step (Phase A):
 * used by the register flow, the verify-email landing page and the
 * password-reset page. Presentation + local validation only; the
 * caller performs the actual API call in onComplete.
 */
import { useState } from 'react';

export interface SetPasswordLabels {
  password: string;
  confirmPassword: string;
  finish: string;
  mismatch: string;
  tooShort: string;
  failed: string;
}

export function SetPasswordForm({
  labels,
  onComplete,
}: {
  labels: SetPasswordLabels;
  onComplete: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError(labels.tooShort);
      return;
    }
    if (password !== confirm) {
      setError(labels.mismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onComplete(password);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : labels.failed);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="auth-form">
      <label>
        <span>{labels.password}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          dir="ltr"
        />
      </label>
      <label>
        <span>{labels.confirmPassword}</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
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
        {busy ? '…' : labels.finish}
      </button>
    </form>
  );
}
