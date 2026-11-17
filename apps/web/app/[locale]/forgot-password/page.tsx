import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from '@/components/PasswordResetFormsLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('forgotTitle'), robots: { index: false, follow: true } };
}

/** Forgot-password page (Phase A): request the reset email. */
export default async function ForgotPasswordPage({
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
        <h1 className="page-title">{t('forgotTitle')}</h1>
        <p className="page-sub">{t('forgotHint')}</p>
        <ForgotPasswordForm
          labels={{
            email: t('email'),
            send: t('forgotSend'),
            sent: t('forgotSent'),
            failed: t('registerFailed'),
          }}
        />
      </div>
    </div>
  );
}
