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
  showPassword: string;
  hidePassword: string;
  passwordStrength: string;
  strengthWeak: string;
  strengthMedium: string;
  strengthStrong: string;
}


/** Strength score 0..5: length steps + character variety. */
function passwordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}

export function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg viewBox="0 0 24 24" width="1.15rem" height="1.15rem" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 4l16 16" strokeLinecap="round" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 3.4 10 6a13.6 13.6 0 0 1-3 3.7M6.6 8.2A13.4 13.4 0 0 0 2 12c1.5 2.6 5 6 10 6 1.5 0 2.9-.3 4.1-.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="1.15rem" height="1.15rem" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2 12c1.5-2.6 5-6 10-6s8.5 3.4 10 6c-1.5 2.6-5 6-10 6s-8.5-3.4-10-6z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
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
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const score = passwordScore(password);
  const strengthLevel = password ? (score <= 2 ? 1 : score === 3 ? 2 : 3) : 0;
  const strengthLabel =
    strengthLevel === 1
      ? labels.strengthWeak
      : strengthLevel === 2
        ? labels.strengthMedium
        : labels.strengthStrong;

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
        <span className="pw-field">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
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
        {password ? (
          <span className="pw-strength">
            <span className="pw-bar">
              <i
                className={`lv${strengthLevel}`}
                style={{ width: `${(strengthLevel / 3) * 100}%` }}
              />
            </span>
            <span>
              {labels.passwordStrength}: {strengthLabel}
            </span>
          </span>
        ) : null}
      </label>
      <label>
        <span>{labels.confirmPassword}</span>
        <span className="pw-field">
          <input
            type={showConfirm ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            dir="ltr"
          />
          <button
            type="button"
            className="pw-eye"
            aria-label={showConfirm ? labels.hidePassword : labels.showPassword}
            onClick={() => setShowConfirm((v) => !v)}
          >
            <EyeIcon off={showConfirm} />
          </button>
        </span>
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
