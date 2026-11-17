'use client';

/**
 * RegisterForm — Phase A sign-up in three steps:
 *  1) short form: first/last name, email, phone with a country picker
 *     (flag + dial code, per-country length check — the site is global);
 *  2) verify: email link, or SMS code (Iranian +98 numbers must use SMS —
 *     the API enforces it; the UI just guides);
 *  3) set password → signed in and redirected to `next` (or home).
 * All rules live in the API (ADR-001); this is presentation + wiring.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  completeRegistration,
  fetchTurnstileSiteKey,
  registerStart,
  requestRegisterPhoneCode,
  resendRegistration,
  verifyRegisterPhoneCode,
} from '@/lib/auth-client';
import { COUNTRIES, flagEmoji, normalizeNational, type CountryDef } from '@/lib/countries';
import TurnstileWidget from './TurnstileWidget';
import { SetPasswordForm } from './SetPasswordForm';

export interface RegisterFormLabels {
  signUp: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  terms: string;
  registerFailed: string;
  nameInvalid: string;
  emailInvalid: string;
  phoneInvalid: string;
  verifyStepTitle: string;
  verifyEmailSent: string;
  iranPhoneNote: string;
  orBySms: string;
  sendCode: string;
  codeLabel: string;
  codeHint: string;
  verifyCode: string;
  codeFailed: string;
  resendLink: string;
  resendDone: string;
  setPasswordTitle: string;
  setPasswordHint: string;
  password: string;
  confirmPassword: string;
  finish: string;
  passwordMismatch: string;
  passwordShort: string;
  haveAccount: string;
  signIn: string;
}

function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export const REGISTER_NEXT_KEY = 'ma.register_next';

export default function RegisterForm({
  locale,
  labels,
}: {
  locale: string;
  labels: RegisterFormLabels;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [step, setStep] = useState<'form' | 'verify' | 'password'>('form');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<CountryDef>(COUNTRIES[0]);
  const [national, setNational] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  useEffect(() => {
    void fetchTurnstileSiteKey().then(setSiteKey);
  }, []);

  const countryNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);

  const phoneE164 = `+${country.dial}${normalizeNational(national)}`;
  const isIran = country.iso === 'IR';

  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const [setupToken, setSetupToken] = useState<string | null>(null);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error && err.message ? err.message : fallback);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const first = firstName.trim();
    const last = lastName.trim();
    if (first.length < 1 || last.length < 1) {
      setError(labels.nameInvalid);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(labels.emailInvalid);
      return;
    }
    const nat = normalizeNational(national);
    if (nat.length < country.min || nat.length > country.max) {
      setError(labels.phoneInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerStart({
        fullName: `${first} ${last}`,
        email: email.trim(),
        phone: phoneE164,
        locale,
        captchaToken: captchaToken ?? undefined,
      });
      try {
        window.localStorage.setItem(REGISTER_NEXT_KEY, next);
      } catch {
        /* storage unavailable — the verify page falls back to home */
      }
      setStep('verify');
    } catch (err) {
      fail(err, labels.registerFailed);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestRegisterPhoneCode(phoneE164);
      setCodeSent(true);
    } catch (err) {
      fail(err, labels.registerFailed);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await verifyRegisterPhoneCode(phoneE164, code.trim());
      setSetupToken(token);
      setStep('password');
    } catch {
      setError(labels.codeFailed);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resendRegistration(email.trim());
      setResent(true);
    } catch {
      /* resend is silent by design */
    } finally {
      setBusy(false);
    }
  };

  const finish = async (pw: string) => {
    if (!setupToken) throw new Error(labels.registerFailed);
    await completeRegistration(setupToken, pw);
    router.push(next);
    router.refresh();
  };

  if (step === 'password') {
    return (
      <div>
        <h2 className="auth-step-title">{labels.setPasswordTitle}</h2>
        <p className="page-sub">{labels.setPasswordHint}</p>
        <SetPasswordForm
          labels={{
            password: labels.password,
            confirmPassword: labels.confirmPassword,
            finish: labels.finish,
            mismatch: labels.passwordMismatch,
            tooShort: labels.passwordShort,
            failed: labels.registerFailed,
          }}
          onComplete={finish}
        />
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div>
        <h2 className="auth-step-title">{labels.verifyStepTitle}</h2>
        {isIran ? (
          <p className="page-sub">{labels.iranPhoneNote}</p>
        ) : (
          <>
            <p className="page-sub">{labels.verifyEmailSent}</p>
            <p className="auth-inline-action">
              <button type="button" className="auth-link-btn" onClick={() => void resend()} disabled={busy}>
                {labels.resendLink}
              </button>
            </p>
            {resent ? <p className="page-sub">{labels.resendDone}</p> : null}
            <p className="page-sub">{labels.orBySms}</p>
          </>
        )}
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
          <div className="auth-form">
            <button type="button" onClick={() => void sendCode()} disabled={busy}>
              {busy ? '…' : labels.sendCode}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={submitForm} className="auth-form">
        <label>
          <span>{labels.firstName}</span>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            required
          />
        </label>
        <label>
          <span>{labels.lastName}</span>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            required
          />
        </label>
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
        <label>
          <span>{labels.country}</span>
          <select
            value={country.iso}
            onChange={(e) =>
              setCountry(COUNTRIES.find((c) => c.iso === e.target.value) ?? COUNTRIES[0])
            }
          >
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {flagEmoji(c.iso)} {countryNames?.of(c.iso) ?? c.iso} (+{c.dial})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{labels.phone}</span>
          <span className="phone-field">
            <span className="phone-prefix" dir="ltr">
              +{country.dial}
            </span>
            <input
              type="tel"
              value={national}
              onChange={(e) => setNational(e.target.value)}
              autoComplete="tel-national"
              required
              dir="ltr"
            />
          </span>
        </label>
        <label className="auth-terms">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            required
          />
          <span>{labels.terms}</span>
        </label>
        {siteKey ? <TurnstileWidget siteKey={siteKey} onToken={setCaptchaToken} /> : null}
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? '…' : labels.signUp}
        </button>
      </form>
      <p className="auth-links">
        <span>{labels.haveAccount}</span>
        <Link href={`/${locale}/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>
          {labels.signIn}
        </Link>
      </p>
    </div>
  );
}
