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
  fetchMySessions,
  fetchQuranBookmarks,
  fetchSavedFatwas,
  fetchSavedItems,
  revokeMySession,
  type MySession,
  regenerateRecoveryCodes,
  setup2fa,
  unsaveFatwa,
  unsaveLibraryItem,
  updateMe,
  uploadAvatar,
  type MeProfile,
  type SavedFatwa,
  type SavedLibraryItem,
  type TwoFAStatus,
} from '@/lib/profile-client';
import { pickText } from '@/lib/localize';
import { bookmarkHref, type Bookmark } from '@/lib/quran-bookmarks';
import DateOfBirthField from '@/components/DateOfBirthField';
import { toJalali } from '@/lib/jalali';

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
  verified: string;
  completeness: string;
  twofaShortOn: string;
  twofaShortOff: string;
  dobJalali: string;
  dobGregorian: string;
  dobAutoJalali: string;
  dobAutoGregorian: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  dobEquivalentGregorian: string;
  dobEquivalentJalali: string;
  memberSince: string;
  tabSessions: string;
  tabSaved: string;
  savedVideosTitle: string;
  savedLessonsTitle: string;
  savedFatwasTitle: string;
  savedBookmarksTitle: string;
  savedEmpty: string;
  savedVideosEmpty: string;
  savedLessonsEmpty: string;
  savedFatwasEmpty: string;
  savedBookmarksEmpty: string;
  savedLoadFailed: string;
  savedRemove: string;
  sessionsEmpty: string;
  sessionsLoadFailed: string;
  sessionIp: string;
  sessionLastActive: string;
  sessionStarted: string;
  sessionRevoke: string;
  sessionRevoked: string;
  sessionUnknownDevice: string;
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
  const [activeTab, setActiveTab] = useState<'personal' | 'security' | 'sessions' | 'saved'>('personal');
  const [sessions, setSessions] = useState<MySession[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const [savedData, setSavedData] = useState<{
    items: SavedLibraryItem[];
    fatwas: SavedFatwa[];
    bookmarks: Bookmark[];
  } | null>(null);
  const [savedError, setSavedError] = useState(false);
  const [unsaveBusy, setUnsaveBusy] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'sessions' || sessions !== null) return;
    let cancelled = false;
    fetchMySessions()
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch(() => {
        if (!cancelled) setSessionsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, sessions]);

  useEffect(() => {
    if (activeTab !== 'saved' || savedData !== null) return;
    let cancelled = false;
    Promise.all([fetchSavedItems(), fetchSavedFatwas(), fetchQuranBookmarks()])
      .then(([items, fatwas, bookmarks]) => {
        if (!cancelled) setSavedData({ items, fatwas, bookmarks });
      })
      .catch(() => {
        if (!cancelled) setSavedError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, savedData]);

  async function removeSavedItem(id: string) {
    setUnsaveBusy(id);
    try {
      await unsaveLibraryItem(id);
      setSavedData((prev) =>
        prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev,
      );
    } catch {
      setSavedError(true);
    } finally {
      setUnsaveBusy(null);
    }
  }

  async function removeSavedFatwa(id: string) {
    setUnsaveBusy(id);
    try {
      await unsaveFatwa(id);
      setSavedData((prev) =>
        prev ? { ...prev, fatwas: prev.fatwas.filter((f) => f.id !== id) } : prev,
      );
    } catch {
      setSavedError(true);
    } finally {
      setUnsaveBusy(null);
    }
  }

  async function endSession(id: string) {
    setSessionBusy(id);
    try {
      await revokeMySession(id);
      setSessions((prev) => prev?.map((s) => (s.id === id ? { ...s, revoked: true } : s)) ?? null);
    } catch {
      setSessionsError(true);
    } finally {
      setSessionBusy(null);
    }
  }

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

  const totalProfileFields = 5;
  const missingFields = me.missing_profile_fields;
  const completenessPct = me.profile_complete
    ? 100
    : Math.round(((totalProfileFields - missingFields.length) / totalProfileFields) * 100);
  const donutC = 2 * Math.PI * 31;
  const numFmt = new Intl.NumberFormat(
    locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar-EG' : 'en-US',
    { useGrouping: false },
  );
  const pctText = locale === 'en' ? `${completenessPct}%` : `${numFmt.format(completenessPct)}٪`;
  const initials =
    me.full_name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('') || '?';
  const memberDate = new Date(me.created_at);
  const memberSinceYear = numFmt.format(locale === 'en' ? memberDate.getFullYear() : toJalali(memberDate).y);
  const fmtDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar' : 'en-GB', {
      dateStyle: 'medium',
    }).format(new Date(iso));
  const savedVideos =
    savedData?.items.filter((i) => i.kind === 'video' || i.kind === 'video_360') ?? [];
  const savedLessons =
    savedData?.items.filter((i) => i.kind !== 'video' && i.kind !== 'video_360') ?? [];
  const savedTotal =
    (savedData?.items.length ?? 0) +
    (savedData?.fatwas.length ?? 0) +
    (savedData?.bookmarks.length ?? 0);

  return (
    <div className="pf3-layout">
      <aside className="pf3-rail">
        <div className="pf3-avatar-wrap">
          <div className="pf3-avatar-ring" />
          <div className="pf3-avatar-ring2" />
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pf3-avatar-img" src={avatarPreview} alt="" />
          ) : (
            <div className="pf3-avatar-fallback" aria-hidden="true">
              {initials}
            </div>
          )}
          <label className="pf3-cam" title={labels.avatarUpload}>
            ✎
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void pickAvatar(e)}
              disabled={avatarBusy}
              hidden
            />
          </label>
        </div>
        <h2 className="pf3-name">{me.full_name}</h2>
        <p className="pf3-mail" dir="ltr">
          {me.email ?? ''}
        </p>
        {me.is_verified && <span className="pf3-verified">✓ {labels.verified}</span>}

        <div className="pf3-donut-zone">
          <div className="pf3-donut" role="img" aria-label={`${labels.completeness}: ${pctText}`}>
            <svg width="64" height="64" viewBox="0 0 74 74">
              <circle cx="37" cy="37" r="31" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="7" />
              <circle
                cx="37"
                cy="37"
                r="31"
                fill="none"
                stroke="#d4af37"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={donutC}
                strokeDashoffset={donutC * (1 - completenessPct / 100)}
              />
            </svg>
            <span className="pf3-pct">{pctText}</span>
          </div>
          <div>
            <div className="pf3-donut-title">{labels.completeness}</div>
            {me.profile_complete ? (
              <div className="pf3-donut-sub">{labels.completeTitle}</div>
            ) : (
              <div className="pf3-missing">
                {missingFields.map((f) => (
                  <span key={f} className="pf3-mchip">
                    {labels.fieldLabels[f] ?? f}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <dl className="pf3-stats">
          <div>
            <dt>{labels.country}</dt>
            <dd>{countryCode ? (countryNames?.of(countryCode) ?? countryCode) : '—'}</dd>
          </div>
          <div>
            <dt>{labels.memberSince}</dt>
            <dd>{memberSinceYear}</dd>
          </div>
          <div>
            <dt>{labels.securityTitle}</dt>
            <dd>{twofa ? (twofa.enabled ? labels.twofaShortOn : labels.twofaShortOff) : '…'}</dd>
          </div>
        </dl>

        <label className="pf3-upload-btn">
          {labels.avatarUpload}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void pickAvatar(e)}
            disabled={avatarBusy}
            hidden
          />
        </label>
        <p className="pf3-up-note">
          {me.avatar_media_id ? labels.avatarSet : labels.avatarMissing} · {labels.avatarHint}
        </p>
        {avatarBusy && <p className="page-sub">{labels.avatarUploading}</p>}
        {avatarError && (
          <p className="auth-error" role="alert">
            {labels.avatarUploadFailed}
          </p>
        )}
        {me.profile_complete && next && (
          <p>
            <Link className="soc-btn soc-btn-primary" href={next}>
              {labels.continue}
            </Link>
          </p>
        )}
      </aside>

      <section className="pf3-main">
        <div className="pf3-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'personal'}
            className={`pf3-tab${activeTab === 'personal' ? ' on' : ''}`}
            onClick={() => setActiveTab('personal')}
          >
            {labels.personalTitle}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'security'}
            className={`pf3-tab${activeTab === 'security' ? ' on' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            {labels.securityTitle}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sessions'}
            className={`pf3-tab${activeTab === 'sessions' ? ' on' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            {labels.tabSessions}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'saved'}
            className={`pf3-tab${activeTab === 'saved' ? ' on' : ''}`}
            onClick={() => setActiveTab('saved')}
          >
            {labels.tabSaved}
          </button>
        </div>

        {activeTab === 'personal' && (
          <form onSubmit={savePersonal} className="auth-form pf3-form">
            <div className="pf3-grid">
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
                    const nextPhone = e.target.value;
                    setPhone(nextPhone);
                    const derived = countryIsoFromPhone(nextPhone);
                    if (derived && (countryCode === '' || countryCode === countryIso)) {
                      setCountryCode(derived);
                    }
                  }}
                  placeholder="+989120000000"
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
            </div>

            <DateOfBirthField
              value={dob}
              onChange={setDob}
              locale={locale}
              countryCode={countryCode}
              labels={{
                title: labels.dateOfBirth,
                jalali: labels.dobJalali,
                gregorian: labels.dobGregorian,
                autoJalali: labels.dobAutoJalali,
                autoGregorian: labels.dobAutoGregorian,
                day: labels.dobDay,
                month: labels.dobMonth,
                year: labels.dobYear,
                equivalentGregorian: labels.dobEquivalentGregorian,
                equivalentJalali: labels.dobEquivalentJalali,
              }}
            />

            <div className="pf3-grid">
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
            </div>

            {saveError && (
              <p className="auth-error" role="alert">
                {labels.saveFailed}
              </p>
            )}
            <button type="submit" disabled={saving}>
              {saving ? labels.saving : labels.save}
            </button>
            {saved && <p className="page-sub">{labels.saved}</p>}
          </form>
        )}

        {activeTab === 'security' && <div className="pf3-security">
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
        </div>}
        {activeTab === 'sessions' && (
          <div className="pf3-security">
            {sessionsError && (
              <p className="auth-error" role="alert">
                {labels.sessionsLoadFailed}
              </p>
            )}
            {!sessions && !sessionsError && <p className="auth-loading">{labels.loading}</p>}
            {sessions && sessions.length === 0 && <p className="page-sub">{labels.sessionsEmpty}</p>}
            {sessions && sessions.length > 0 && (
              <ul className="pf3-sessions">
                {sessions.map((s) => (
                  <li key={s.id} className="pf3-session">
                    <div className="pf3-session-main">
                      <div className="pf3-session-device">{s.device_info || labels.sessionUnknownDevice}</div>
                      <div className="pf3-session-meta">
                        {s.ip && (
                          <span>
                            {labels.sessionIp}: <span dir="ltr">{s.ip}</span>
                          </span>
                        )}
                        <span>
                          {labels.sessionStarted}: {fmtDateTime(s.created_at)}
                        </span>
                        <span>
                          {labels.sessionLastActive}: {fmtDateTime(s.last_active_at)}
                        </span>
                      </div>
                    </div>
                    {s.revoked ? (
                      <span className="pf3-session-off">{labels.sessionRevoked}</span>
                    ) : (
                      <button
                        type="button"
                        className="pf3-session-btn"
                        disabled={sessionBusy === s.id}
                        onClick={() => void endSession(s.id)}
                      >
                        {labels.sessionRevoke}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {activeTab === 'saved' && (
          <div className="pf3-security">
            {savedError && (
              <p className="auth-error" role="alert">
                {labels.savedLoadFailed}
              </p>
            )}
            {!savedData && !savedError && <p className="auth-loading">{labels.loading}</p>}
            {savedData && savedTotal === 0 && <p className="page-sub">{labels.savedEmpty}</p>}
            {savedData && savedTotal > 0 && (
              <>
                <div className="pf3-saved-section">
                  <h3 className="pf3-saved-title">
                    {labels.savedVideosTitle}
                    <span className="pf3-saved-count">{numFmt.format(savedVideos.length)}</span>
                  </h3>
                  {savedVideos.length === 0 ? (
                    <p className="page-sub">{labels.savedVideosEmpty}</p>
                  ) : (
                    <ul className="pf3-saved-list">
                      {savedVideos.map((it) => (
                        <SavedItemRow
                          key={it.id}
                          item={it}
                          locale={locale}
                          href={`/${locale}/videos/${it.id}`}
                          dateLabel={fmtDate(it.published_at ?? it.created_at)}
                          removeLabel={labels.savedRemove}
                          busy={unsaveBusy === it.id}
                          onRemove={() => void removeSavedItem(it.id)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pf3-saved-section">
                  <h3 className="pf3-saved-title">
                    {labels.savedLessonsTitle}
                    <span className="pf3-saved-count">{numFmt.format(savedLessons.length)}</span>
                  </h3>
                  {savedLessons.length === 0 ? (
                    <p className="page-sub">{labels.savedLessonsEmpty}</p>
                  ) : (
                    <ul className="pf3-saved-list">
                      {savedLessons.map((it) => (
                        <SavedItemRow
                          key={it.id}
                          item={it}
                          locale={locale}
                          href={`/${locale}/library/${it.id}`}
                          dateLabel={fmtDate(it.published_at ?? it.created_at)}
                          removeLabel={labels.savedRemove}
                          busy={unsaveBusy === it.id}
                          onRemove={() => void removeSavedItem(it.id)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pf3-saved-section">
                  <h3 className="pf3-saved-title">
                    {labels.savedFatwasTitle}
                    <span className="pf3-saved-count">{numFmt.format(savedData.fatwas.length)}</span>
                  </h3>
                  {savedData.fatwas.length === 0 ? (
                    <p className="page-sub">{labels.savedFatwasEmpty}</p>
                  ) : (
                    <ul className="pf3-saved-list">
                      {savedData.fatwas.map((f) => (
                        <li key={f.id} className="pf3-saved-row">
                          <Link href={`/${locale}/fatwa/${f.id}`} className="pf3-saved-link">
                            {f.featured_image_url ? (
                              <span className="pf3-saved-thumb">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={f.featured_image_url} alt="" loading="lazy" />
                              </span>
                            ) : null}
                            <span className="pf3-saved-info">
                              <span className="pf3-saved-name">
                                {pickText(f.title, locale) || '—'}
                              </span>
                              <span className="pf3-saved-meta">
                                {[
                                  f.category ? pickText(f.category.title, locale) : '',
                                  f.published_at ? fmtDate(f.published_at) : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                          </Link>
                          <button
                            type="button"
                            className="pf3-saved-remove"
                            disabled={unsaveBusy === f.id}
                            onClick={() => void removeSavedFatwa(f.id)}
                          >
                            {labels.savedRemove}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pf3-saved-section">
                  <h3 className="pf3-saved-title">
                    {labels.savedBookmarksTitle}
                    <span className="pf3-saved-count">{numFmt.format(savedData.bookmarks.length)}</span>
                  </h3>
                  {savedData.bookmarks.length === 0 ? (
                    <p className="page-sub">{labels.savedBookmarksEmpty}</p>
                  ) : (
                    <ul className="pf3-saved-list">
                      {savedData.bookmarks.map((b) => (
                        <li key={b.id} className="pf3-saved-row">
                          <Link href={bookmarkHref(b, locale)} className="pf3-saved-link">
                            <span className="pf3-saved-info">
                              <span className="pf3-saved-name">{b.label || '—'}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const KIND_ICONS: Record<string, string> = {
  video: '▶',
  video_360: '🌐',
  audio: '🎧',
  pdf: '📄',
  mindmap: '🗺',
};

function SavedItemRow({
  item,
  locale,
  href,
  dateLabel,
  removeLabel,
  busy,
  onRemove,
}: {
  item: SavedLibraryItem;
  locale: string;
  href: string;
  dateLabel: string;
  removeLabel: string;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="pf3-saved-row">
      <Link href={href} className="pf3-saved-link">
        <span className="pf3-saved-thumb">
          {item.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.cover_url} alt="" loading="lazy" />
          ) : (
            <span aria-hidden="true">{KIND_ICONS[item.kind] ?? '🔖'}</span>
          )}
        </span>
        <span className="pf3-saved-info">
          <span className="pf3-saved-name">{pickText(item.title, locale) || '—'}</span>
          <span className="pf3-saved-meta">
            {[item.scholar_name ?? '', dateLabel].filter(Boolean).join(' · ')}
          </span>
        </span>
      </Link>
      <button
        type="button"
        className="pf3-saved-remove"
        disabled={busy}
        onClick={onRemove}
      >
        {removeLabel}
      </button>
    </li>
  );
}
