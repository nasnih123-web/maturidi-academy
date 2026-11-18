import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RegisterForm } from '@/components/RegisterFormLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signUp'), robots: { index: false, follow: true } };
}

/**
 * Sign-up page (Phase A). Server shell only: the interactive 3-step
 * form is code-split (ssr: false) like the login page, and every
 * string is rendered here and passed down as props.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return (
    <div className="page-wrap">
      <div className="auth-card">
        <h1 className="page-title">{t('signUp')}</h1>
        <p className="page-sub">{t('signUpHint')}</p>
        <RegisterForm
          locale={locale}
          labels={{
            signUp: t('signUp'),
            firstName: t('firstName'),
            lastName: t('lastName'),
            email: t('email'),
            phone: t('phone'),
            country: t('country'),
            terms: t('terms'),
            registerFailed: t('registerFailed'),
            nameInvalid: t('nameInvalid'),
            emailInvalid: t('emailInvalid'),
            phoneInvalid: t('phoneInvalid'),
            verifyStepTitle: t('verifyStepTitle'),
            verifyEmailSent: t('verifyEmailSent'),
            iranPhoneNote: t('iranPhoneNote'),
            orBySms: t('orBySms'),
            sendCode: t('sendCode'),
            codeLabel: t('codeLabel'),
            codeHint: t('codeHint'),
            verifyCode: t('verifyCode'),
            codeFailed: t('codeFailed'),
            resendLink: t('resendLink'),
            resendDone: t('resendDone'),
            setPasswordTitle: t('setPasswordTitle'),
            setPasswordHint: t('setPasswordHint'),
            password: t('password'),
            confirmPassword: t('confirmPassword'),
            showPassword: t('showPassword'),
            hidePassword: t('hidePassword'),
            passwordStrength: t('passwordStrength'),
            strengthWeak: t('strengthWeak'),
            strengthMedium: t('strengthMedium'),
            strengthStrong: t('strengthStrong'),
            finish: t('finish'),
            passwordMismatch: t('passwordMismatch'),
            passwordShort: t('passwordShort'),
            haveAccount: t('haveAccount'),
            signIn: t('signIn'),
          }}
        />
      </div>
    </div>
  );
}
