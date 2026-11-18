'use client';

/**
 * VerifyEmailPanel — landing page for the emailed verification link
 * (Phase A). Consumes the token once via POST /auth/register/verify-email
 * and branches on the API's verdict:
 *  verified       → set-password form, then redirect to `next`/home;
 *  phone_required → the number's country is on the CRM SMS-required
 *                   list: SMS-code step first (the visitor re-enters
 *                   their number — the link carries no phone);
 *  already_active → the account already signs in; link to login;
 *  anything else  → invalid/expired link message.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  completeRegistration,
  requestRegisterPhoneCode,
  verifyRegisterEmail,
  verifyRegisterPhoneCode,
} from '@/lib/auth-client';
import { toE164 } from '@/lib/countries';
import { REGISTER_NEXT_KEY } from './RegisterForm';
import { SetPasswordForm } from './SetPasswordForm';

export interface VerifyEmailLabels {
  verifying: string;
  verifiedSetPassword: string;
  alreadyActive: string;
  invalidLink: string;
  phoneRequiredTitle: string;
  phoneRequiredBody: string;
  phonePlaceholder: string;
  phoneInvalid: string;
  sendCode: string;
  codeLabel: string;
  codeHint: string;
  verifyCode: string;
  codeFailed: string;
  goToLogin: string;
  signUp: string;
  phone: string;
  password: string;
  confirmPassword: string;
  finish: string;
  passwordMismatch: string;
  passwordShort: string;
  showPassword: string;
  hidePassword: string;
  passwordStrength: string;
  strengthWeak: string;
  strengthMedium: string;
  strengthStrong: string;
  registerFailed: string;
}

type PanelState = 'checking' | 'password' | 'phone' | 'active' | 'invalid';

function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export default function VerifyEmailPanel({
  locale,
  labels,
}: {
  locale: string;
  labels: VerifyEmailLabels;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<PanelState>('checking');
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const ranRef = useRef(false);

  const [phoneInput, setPhoneInput] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!token) {
      setState('invalid');
      return;
    }
    verifyRegisterEmail(token)
      .then((r) => {
        if (r.status === 'verified' && r.setupToken) {
          setSetupToken(r.setupToken);
          setState('password');
        } else if (r.status === 'phone_required') {
          setState('phone');
        } else {
          setState('active');
        }
      })
      .catch(() => setState('invalid'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveNext = (): string => {
    const fromParam = safeNext(searchParams.get('next'));
    if (fromParam !== '/') return fromParam;
    try {
      return safeNext(window.localStorage.getItem(REGISTER_NEXT_KEY));
    } catch {
      return '/';
    }
  };

  const finish = async (pw: string) => {
    if (!setupToken) throw new Error(labels.registerFailed);
    await completeRegistration(setupToken, pw);
    router.push(resolveNext());
    router.refresh();
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const e164 = toE164(phoneInput);
    if (!e164) {
      setError(labels.phoneInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestRegisterPhoneCode(e164);
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : labels.registerFailed);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const e164 = toE164(phoneInput);
    if (!e164) {
      setError(labels.phoneInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const t = await verifyRegisterPhoneCode(e164, code.trim());
      setSetupToken(t);
      setState('password');
    } catch {
      setError(labels.codeFailed);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking') {
    return <p className="auth-loading">{labels.verifying}</p>;
  }

  if (state === 'invalid') {
    return (
      <div>
        <p className="auth-error" role="alert">
          {labels.invalidLink}
        </p>
        <p className="auth-links">
          <Link href={`/${locale}/register`}>{labels.signUp}</Link>
        </p>
      </div>
    );
  }

  if (state === 'active') {
    return (
      <div>
        <p className="page-sub">{labels.alreadyActive}</p>
        <p className="auth-links">
          <Link href={`/${locale}/login`}>{labels.goToLogin}</Link>
        </p>
      </div>
    );
  }

  if (state === 'phone') {
    return (
      <div>
        <h2 className="auth-step-title">{labels.phoneRequiredTitle}</h2>
        <p className="page-sub">{labels.phoneRequiredBody}</p>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        {codeSent ? (
          <form onSubmit={verifyCode} className="auth-form">
            <label>
              <span>{labels.codeLabel}</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                dir="ltr"
              />
            </label>
            <p className="page-sub">{labels.codeHint}</p>
            <button type="submit" disabled={busy}>
              {busy ? '…' : labels.verifyCode}
            </button>
          </form>
        ) : (
          <form onSubmit={sendCode} className="auth-form">
            <label>
              <span>{labels.phone}</span>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder={labels.phonePlaceholder}
                required
                dir="ltr"
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? '…' : labels.sendCode}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="page-sub">{labels.verifiedSetPassword}</p>
      <SetPasswordForm
        labels={{
          password: labels.password,
          confirmPassword: labels.confirmPassword,
          finish: labels.finish,
          mismatch: labels.passwordMismatch,
          tooShort: labels.passwordShort,
          failed: labels.registerFailed,
          showPassword: labels.showPassword,
          hidePassword: labels.hidePassword,
          passwordStrength: labels.passwordStrength,
          strengthWeak: labels.strengthWeak,
          strengthMedium: labels.strengthMedium,
          strengthStrong: labels.strengthStrong,
        }}
        onComplete={finish}
      />
    </div>
  );
}
