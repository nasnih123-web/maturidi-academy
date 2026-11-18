'use client';

/**
 * ProfileSettings — Phase B account page.
 *
 * Sections:
 * 1. Completeness banner — driven entirely by the backend's
 *    profile_complete / missing_profile_fields (never recomputed here).
 * 2. Personal info — full name, date of birth, gender, country,
 *    language and phone are editable via PATCH /users/me; only the
 *    email stays read-only. With a verified phone, the country is
 *    preselected to the phone's country and locked (the API enforces
 *    the same rule); editing the phone re-derives the country.
 * 3. Profile picture — real upload via POST /users/me/avatar; after a
 *    successful upload the just-picked file is previewed locally (the
 *    API exposes the media id, not a public URL).
 * 4. Two-factor auth — full self-service over the existing
 *    /auth/2fa/* endpoints (setup/enable/disable/regenerate).
 *
 * `next` mirrors the Phase A return-to-section flow: when the profile
 * becomes complete, a continue button takes the user back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth-client';
import { COUNTRIES, flagEmoji } from '@/lib/countries';
import {
  countryIsoFromPhone,
  disable2fa,
  enable2fa,
  fetch2faStatus,
  fetchMe,
  regenerateRecoveryCodes,
  setup2fa,
  updateMe,
  uploadAvatar,
  type MeProfile,
  type TwoFAStatus,
} from '@/lib/profile-client';

export interface ProfileLabels {
  title: string;
  subtitle: string;
  personalTitle: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  genderMale: string;
  genderFemale: string;
  genderPlaceholder: string;
  country: string;
  countryFromPhone: string;
  countryPlaceholder: string;
  language: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  loading: string;
  loadFailed: string;
  loginRequired: string;
  signIn: string;
  signUp: string;
  avatarTitle: string;
  avatarSet: string;
  avatarMissing: string;
  avatarUpload: string;
  avatarUploading: string;
  avatarUploadFailed: string;
  avatarHint: string;
  completeTitle: string;
  incompleteTitle: string;
  missingIntro: string;
  fieldLabels: Record<string, string>;
  continue: string;
  securityTitle: string;
  twofaOn: string;
  twofaOff: string;
  twofaEnable: string;
  twofaDisable: string;
  twofaSetupHint: string;
  twofaSecretLabel: string;
  twofaCodeLabel: string;
  twofaConfirmEnable: string;
  twofaRecoveryTitle: string;
  twofaRecoveryRemaining: string;
  twofaRegenerate: string;
  passwordLabel: string;
  twofaFailed: string;
  twofaEnabledDone: string;
  twofaDisabledDone: string;
}

interface ProfileSettingsProps {
  locale: string;
  labels: ProfileLabels;
  next?: string;
}

export default function ProfileSettings({ locale, labels, next }: ProfileSettingsProps) {
  const router = useRouter();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [fullName, setFullName] = useState('');
  const [localeSel, setLocaleSel] = useState(locale);
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const [twofa, setTwofa] = useState<TwoFAStatus | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupUri, setSetupUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [twofaBusy, setTwofaBusy] = useState(false);
  const [twofaError, setTwofaError] = useState(false);
  const [twofaNotice, setTwofaNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      setSignedOut(true);
      return;
    }
    try {
      const [meData, status] = await Promise.all([fetchMe(), fetch2faStatus()]);
      setMe(meData);
      setFullName(meData.full_name);
      setLocaleSel(meData.locale);
      setDob(meData.date_of_birth ?? '');
      setGender(meData.gender ?? '');
      setCountryCode(meData.country_code ?? countryIsoFromPhone(meData.phone) ?? '');
      setPhone(meData.phone ?? '');
      setTwofa(status);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const countryNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);

  const countryIso = me ? countryIsoFromPhone(me.phone) : null;
  // شمارهٔ تأییدشده کشور را قفل می‌کند — API هم همان سازگاری را enforce می‌کند.
  const countryLocked = Boolean(countryIso && me?.is_verified);

  async function savePersonal(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      const updated = await updateMe({
        full_name: fullName.trim(),
        locale: localeSel,
        ...(dob ? { date_of_birth: dob } : {}),
        ...(gender ? { gender } : {}),
        ...(countryCode ? { country_code: countryCode } : {}),
        ...(phone.trim() !== (me?.phone ?? '') ? { phone: phone.trim() } : {}),
      });
      setMe(updated);
      setPhone(updated.phone ?? '');
      setSaved(true);
      if (localeSel !== locale) router.refresh();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError(false);
    try {
      const updated = await uploadAvatar(file);
      setMe(updated);
      setAvatarPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    } catch {
      setAvatarError(true);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function startSetup() {
    setTwofaBusy(true);
    setTwofaError(false);
    try {
      const s = await setup2fa();
      setSetupSecret(s.secret);
      setSetupUri(s.provisioning_uri);
    } catch {
      setTwofaError(true);
    } finally {
      setTwofaBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    if (!setupSecret) return;
    setTwofaBusy(true);
    setTwofaError(false);
    try {
      const out = await enable2fa(setupSecret, code.trim());
      setRecoveryCodes(out.recovery_codes);
      setSetupSecret(null);
      setSetupUri(null);
      setCode('');
      setTwofa(await fetch2faStatus());
      setTwofaNotice(labels.twofaEnabledDone);
    } catch {
      setTwofaError(true);
    } finally {
      setTwofaBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setTwofaBusy(true);
    setTwofaError(false);
    try {
      await disable2fa({ password: reauthPassword, code: reauthCode.trim() || undefined });
      setReauthPassword('');
      setReauthCode('');
      setTwofa(await fetch2faStatus());
      setTwofaNotice(labels.twofaDisabledDone);
    } catch {
      setTwofaError(true);
    } finally {
      setTwofaBusy(false);
    }
  }

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    setTwofaBusy(true);
    setTwofaError(false);
    try {
      const out = await regenerateRecoveryCodes({
        password: reauthPassword,
        code: reauthCode.trim() || undefined,
      });
      setRecoveryCodes(out.recovery_codes);
      setReauthPassword('');
      setReauthCode('');
      setTwofa(await fetch2faStatus());
    } catch {
      setTwofaError(true);
    } finally {
      setTwofaBusy(false);
    }
  }

  if (signedOut) {
    const nextParam = `?next=${encodeURIComponent(`/${locale}/profile${next ? `?next=${encodeURIComponent(next)}` : ''}`)}`;
    return (
      <div>
        <p>{labels.loginRequired}</p>
        <div className="soc-composer-foot">
          <Link className="soc-btn soc-btn-primary" href={`/${locale}/register${nextParam}`}>
            {labels.signUp}
          </Link>
          <Link className="soc-btn" href={`/${locale}/login${nextParam}`}>
            {labels.signIn}
          </Link>
        </div>
      </div>
    );
  }

  if (loadError) return <p className="auth-error" role="alert">{labels.loadFailed}</p>;
  if (!me) return <p className="auth-loading">{labels.loading}</p>;

  return (
    <div>
      <section aria-live="polite">
        {me.profile_complete ? (
          <p className="soc-status" role="status">{labels.completeTitle}</p>
        ) : (
          <>
            <p className="soc-status" role="status">{labels.incompleteTitle}</p>
            <p className="page-sub">{labels.missingIntro}</p>
            <ul>
              {me.missing_profile_fields.map((f) => (
                <li key={f}>{labels.fieldLabels[f] ?? f}</li>
              ))}
            </ul>
          </>
        )}
        {me.profile_complete && next && (
          <p>
            <Link className="soc-btn soc-btn-primary" href={next}>
              {labels.continue}
            </Link>
          </p>
        )}
      </section>

      <h2 className="auth-step-title">{labels.personalTitle}</h2>
      <form onSubmit={savePersonal} className="auth-form">
        <label>
          <span>{labels.fullName}</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
            minLength={2}
          />
        </label>
        <label>
          <span>{labels.email}</span>
          <input type="email" value={me.email ?? ''} readOnly dir="ltr" />
        </label>
        <label>
          <span>{labels.phone}</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              const next = e.target.value;
              setPhone(next);
              // Keep the country in step when it was derived from the
              // phone (or unset): a new number means a new phone country.
              const derived = countryIsoFromPhone(next);
              if (derived && (countryCode === '' || countryCode === countryIso)) {
                setCountryCode(derived);
              }
            }}
            placeholder="+989120000000"
            dir="ltr"
          />
        </label>
        <label>
          <span>{labels.dateOfBirth}</span>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            dir="ltr"
          />
        </label>
        <label>
          <span>{labels.gender}</span>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">{labels.genderPlaceholder}</option>
            <option value="male">{labels.genderMale}</option>
            <option value="female">{labels.genderFemale}</option>
          </select>
        </label>
        <label>
          <span>{labels.country}</span>
          <select
            value={countryLocked ? (countryIso ?? '') : countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            disabled={countryLocked}
          >
            <option value="">{labels.countryPlaceholder}</option>
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {flagEmoji(c.iso)} {countryNames?.of(c.iso) ?? c.iso}
              </option>
            ))}
          </select>
          {countryLocked && <span className="page-sub">{labels.countryFromPhone}</span>}
        </label>
        <label>
          <span>{labels.language}</span>
          <select value={localeSel} onChange={(e) => setLocaleSel(e.target.value)}>
            <option value="fa">فارسی</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        {saveError && (
          <p className="auth-error" role="alert">{labels.saveFailed}</p>
        )}
        <button type="submit" disabled={saving}>
          {saving ? labels.saving : labels.save}
        </button>
        {saved && <p className="page-sub">{labels.saved}</p>}
      </form>

      <h2 className="auth-step-title">{labels.avatarTitle}</h2>
      <p className="page-sub">{me.avatar_media_id ? labels.avatarSet : labels.avatarMissing}</p>
      {avatarPreview && (
        <p>
          {/* پیش‌نمایش محلیِ همان فایلی که کاربر انتخاب کرده — API فقط
              شناسهٔ رسانه را برمی‌گرداند، نه URL عمومی. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarPreview}
            alt=""
            width={96}
            height={96}
            style={{ borderRadius: '50%', objectFit: 'cover' }}
          />
        </p>
      )}
      <div className="auth-form">
        <label>
          <span>{labels.avatarUpload}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void pickAvatar(e)}
            disabled={avatarBusy}
          />
        </label>
        <p className="page-sub">{labels.avatarHint}</p>
        {avatarBusy && <p className="page-sub">{labels.avatarUploading}</p>}
        {avatarError && (
          <p className="auth-error" role="alert">{labels.avatarUploadFailed}</p>
        )}
      </div>

      <h2 className="auth-step-title">{labels.securityTitle}</h2>
      {twofaNotice && <p className="page-sub">{twofaNotice}</p>}
      {twofaError && (
        <p className="auth-error" role="alert">{labels.twofaFailed}</p>
      )}
      {twofa && (
        <p className="page-sub">
          {twofa.enabled
            ? `${labels.twofaOn} ${labels.twofaRecoveryRemaining.replace('{count}', String(twofa.recovery_codes_remaining))}`
            : labels.twofaOff}
        </p>
      )}

      {recoveryCodes && (
        <div>
          <p className="page-sub">{labels.twofaRecoveryTitle}</p>
          <ul dir="ltr">
            {recoveryCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {twofa && !twofa.enabled && !setupSecret && (
        <div className="auth-form">
          <button type="button" onClick={() => void startSetup()} disabled={twofaBusy}>
            {labels.twofaEnable}
          </button>
        </div>
      )}

      {setupSecret && (
        <form onSubmit={confirmEnable} className="auth-form">
          <p className="page-sub">{labels.twofaSetupHint}</p>
          <label>
            <span>{labels.twofaSecretLabel}</span>
            <input type="text" value={setupSecret} readOnly dir="ltr" />
          </label>
          {setupUri && (
            <label>
              <span>otpauth</span>
              <input type="text" value={setupUri} readOnly dir="ltr" />
            </label>
          )}
          <label>
            <span>{labels.twofaCodeLabel}</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              dir="ltr"
              inputMode="numeric"
              required
            />
          </label>
          <button type="submit" disabled={twofaBusy}>
            {labels.twofaConfirmEnable}
          </button>
        </form>
      )}

      {twofa?.enabled && (
        <>
          <form onSubmit={disable} className="auth-form">
            <label>
              <span>{labels.passwordLabel}</span>
              <input
                type="password"
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                autoComplete="current-password"
                required
                dir="ltr"
              />
            </label>
            <label>
              <span>{labels.twofaCodeLabel}</span>
              <input
                type="text"
                value={reauthCode}
                onChange={(e) => setReauthCode(e.target.value)}
                dir="ltr"
                inputMode="numeric"
              />
            </label>
            <button type="submit" disabled={twofaBusy}>
              {labels.twofaDisable}
            </button>
          </form>
          <form onSubmit={regenerate} className="auth-form">
            <button type="submit" disabled={twofaBusy || !reauthPassword}>
              {labels.twofaRegenerate}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
