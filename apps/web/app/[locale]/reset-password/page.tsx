import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/PasswordResetFormsLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('resetTitle'), robots: { index: false, follow: false } };
}

/**
 * Reset-password landing page (Phase A) — target of the emailed link
 * (/{locale}/reset-password?token=…).
 */
export default async function ResetPasswordPage({
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
        <h1 className="page-title">{t('resetTitle')}</h1>
        <ResetPasswordForm
          locale={locale}
          labels={{
            password: t('password'),
            confirmPassword: t('confirmPassword'),
            finish: t('resetTitle'),
            mismatch: t('passwordMismatch'),
            tooShort: t('passwordShort'),
            failed: t('registerFailed'),
            invalid: t('resetInvalid'),
            done: t('resetDone'),
            goToLogin: t('goToLogin'),
          }}
        />
      </div>
    </div>
  );
}
