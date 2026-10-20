import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/LoginFormLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signIn'), robots: { index: false, follow: true } };
}

/**
 * Sign-in page (Phase 5 — Track 2/web).
 *
 * Pure server component: the interactive form is code-split (ssr: false)
 * so the route stays inside the First Load JS budget
 * (docs/performance-budget.md). All strings are server-rendered and passed
 * as props — the client chunk carries no i18n runtime.
 */
export default async function LoginPage({
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
        <h1 className="page-title">{t('signIn')}</h1>
        <p className="page-sub">{t('signInHint')}</p>
        <LoginForm
          labels={{
            identifier: t('identifier'),
            password: t('password'),
            totp: t('totp'),
            signIn: t('signIn'),
            loginFailed: t('loginFailed'),
          }}
        />
      </div>
    </div>
  );
}
