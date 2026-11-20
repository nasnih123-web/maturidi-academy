import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileSettings } from '@/components/ProfileSettingsLazy';
import type { ProfileLabels as ProfileLabelsType } from '@/components/ProfileSettings';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'profile' });
  return { title: t('title'), robots: { index: false, follow: true } };
}

/**
 * Profile & account security (Phase B). Server shell only: the
 * interactive panel is code-split (ssr: false) like the auth pages,
 * and every string is rendered here and passed down as props.
 *
 * `?next=` carries the return-to-section target used by the section
 * gates (fatwa question, advanced hifz): only same-site absolute paths
 * are honoured.
 */
export default async function ProfilePage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'profile' });
  const tAuth = await getTranslations({ locale, namespace: 'auth' });

  const rawNext = typeof searchParams.next === 'string' ? searchParams.next : undefined;
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : undefined;

  const labels: ProfileLabelsType = {
    title: t('title'),
    subtitle: t('subtitle'),
    personalTitle: t('personalTitle'),
    fullName: t('fullName'),
    email: t('email'),
    phone: t('phone'),
    dateOfBirth: t('dateOfBirth'),
    gender: t('gender'),
    genderMale: t('genderMale'),
    genderFemale: t('genderFemale'),
    genderPlaceholder: t('genderPlaceholder'),
    country: t('country'),
    countryFromPhone: t('countryFromPhone'),
    countryPlaceholder: t('countryPlaceholder'),
    language: t('language'),
    save: t('save'),
    saving: t('saving'),
    saved: t('saved'),
    saveFailed: t('saveFailed'),
    loading: t('loading'),
    loadFailed: t('loadFailed'),
    loginRequired: t('loginRequired'),
    signIn: tAuth('signIn'),
    signUp: tAuth('signUp'),
    avatarTitle: t('avatarTitle'),
    avatarSet: t('avatarSet'),
    avatarMissing: t('avatarMissing'),
    avatarUpload: t('avatarUpload'),
    avatarUploading: t('avatarUploading'),
    avatarUploadFailed: t('avatarUploadFailed'),
    avatarHint: t('avatarHint'),
    completeTitle: t('completeTitle'),
    incompleteTitle: t('incompleteTitle'),
    missingIntro: t('missingIntro'),
    fieldLabels: {
      full_name: t('fields.full_name'),
      avatar_media_id: t('fields.avatar_media_id'),
      date_of_birth: t('fields.date_of_birth'),
      gender: t('fields.gender'),
      country_code: t('fields.country_code'),
    },
    continue: t('continue'),
    securityTitle: t('securityTitle'),
    twofaOn: t('twofaOn'),
    twofaOff: t('twofaOff'),
    twofaEnable: t('twofaEnable'),
    twofaDisable: t('twofaDisable'),
    twofaSetupHint: t('twofaSetupHint'),
    twofaSecretLabel: t('twofaSecretLabel'),
    twofaCodeLabel: t('twofaCodeLabel'),
    twofaConfirmEnable: t('twofaConfirmEnable'),
    twofaRecoveryTitle: t('twofaRecoveryTitle'),
    twofaRecoveryRemaining: t('twofaRecoveryRemaining'),
    twofaRegenerate: t('twofaRegenerate'),
    passwordLabel: t('passwordLabel'),
    twofaFailed: t('twofaFailed'),
    twofaEnabledDone: t('twofaEnabledDone'),
    twofaDisabledDone: t('twofaDisabledDone'),
    verified: t('verified'),
    completeness: t('completeness'),
    twofaShortOn: t('twofaShortOn'),
    twofaShortOff: t('twofaShortOff'),
    dobJalali: t('dobJalali'),
    dobGregorian: t('dobGregorian'),
    dobAutoJalali: t('dobAutoJalali'),
    dobAutoGregorian: t('dobAutoGregorian'),
    dobDay: t('dobDay'),
    dobMonth: t('dobMonth'),
    dobYear: t('dobYear'),
    dobEquivalentGregorian: t('dobEquivalentGregorian'),
    dobEquivalentJalali: t('dobEquivalentJalali'),
    memberSince: t('memberSince'),
    tabSessions: t('tabSessions'),
    sessionsEmpty: t('sessionsEmpty'),
    sessionsLoadFailed: t('sessionsLoadFailed'),
    sessionIp: t('sessionIp'),
    sessionLastActive: t('sessionLastActive'),
    sessionStarted: t('sessionStarted'),
    sessionRevoke: t('sessionRevoke'),
    sessionRevoked: t('sessionRevoked'),
    sessionUnknownDevice: t('sessionUnknownDevice'),
  };

  return (
    <div className="page-wrap">
      <div className="auth-card pf3-shell">
        <h1 className="page-title">{t('title')}</h1>
        <p className="page-sub">{t('subtitle')}</p>
        <ProfileSettings locale={locale} labels={labels} next={next} />
      </div>
    </div>
  );
}
