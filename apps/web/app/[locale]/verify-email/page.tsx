import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VerifyEmailPanel } from '@/components/VerifyEmailPanelLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('verifyPageTitle'), robots: { index: false, follow: false } };
}

/**
 * Email-verification landing page (Phase A) — the target of the link
 * in the registration email (/{locale}/verify-email?token=…). The
 * interactive panel is code-split; strings are passed as props.
 */
export default async function VerifyEmailPage({
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
        <h1 className="page-title">{t('verifyPageTitle')}</h1>
        <VerifyEmailPanel
          locale={locale}
          labels={{
            verifying: t('verifying'),
            verifiedSetPassword: t('verifiedSetPassword'),
            alreadyActive: t('alreadyActive'),
            invalidLink: t('invalidLink'),
            phoneRequiredTitle: t('phoneRequiredTitle'),
            phoneRequiredBody: t('phoneRequiredBody'),
            phonePlaceholder: t('phonePlaceholder'),
            phoneInvalid: t('phoneInvalid'),
            sendCode: t('sendCode'),
            codeLabel: t('codeLabel'),
            codeHint: t('codeHint'),
            verifyCode: t('verifyCode'),
            codeFailed: t('codeFailed'),
            goToLogin: t('goToLogin'),
            signUp: t('signUp'),
            phone: t('phone'),
            password: t('password'),
            confirmPassword: t('confirmPassword'),
            finish: t('finish'),
            passwordMismatch: t('passwordMismatch'),
            passwordShort: t('passwordShort'),
            registerFailed: t('registerFailed'),
          }}
        />
      </div>
    </div>
  );
}
