import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiError, verifyCertificateServer } from '@/lib/lms';
import { CertificateVerdict, type CertificateVerdictLabels } from '@/components/CertificateVerdict';

/**
 * Public certificate verification page (Phase 8).
 *
 * Fully server-rendered against the public
 * GET /api/v1/lms/certificates/{code}/verify endpoint — zero client JS.
 * Unknown code → invalid verdict (never a crash).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  return { title: t('certificateMetaTitle'), description: t('certificateMetaDescription') };
}

export default async function CertificateVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  const decoded = decodeURIComponent(code);

  let verdict = null;
  let loadError: string | null = null;
  try {
    verdict = await verifyCertificateServer(decoded);
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : String(err);
  }

  const labels: CertificateVerdictLabels = {
    validTitle: t('validTitle'),
    invalidTitle: t('invalidTitle'),
    invalidBody: t('invalidBody'),
    courseLabel: t('courseLabel'),
    recipientLabel: t('recipientLabel'),
    issuedAtLabel: t('issuedAtLabel'),
    codeLabel: t('codeLabel'),
  };

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('certificateTitle2')}</h1>
      <p className="page-sub">{t('certificateSubtitle')}</p>

      {loadError ? (
        <div className="lms-state" role="alert">
          {t('loadFailed')}: {loadError}
        </div>
      ) : verdict ? (
        <CertificateVerdict verdict={verdict} locale={locale} labels={labels} />
      ) : null}
    </div>
  );
}
