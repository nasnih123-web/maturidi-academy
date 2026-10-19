/**
 * CertificateVerdict — certificate verification result card (Phase 8).
 *
 * Server component (no client JS): renders the valid/invalid verdict with
 * details from GET /api/v1/certificates/{code}/verify. Shared by the
 * public verify page and the dev-only /demo/lms preview.
 */
import { pickText } from '@/lib/localize';
import { formatDateTime, type LmsCertificateVerify } from '@/lib/lms';

export interface CertificateVerdictLabels {
  validTitle: string;
  invalidTitle: string;
  invalidBody: string;
  courseLabel: string;
  recipientLabel: string;
  issuedAtLabel: string;
  codeLabel: string;
}

export function CertificateVerdict({
  verdict,
  locale,
  labels,
}: {
  verdict: LmsCertificateVerify;
  locale: string;
  labels: CertificateVerdictLabels;
}) {
  return (
    <section
      className={verdict.valid ? 'lms-cert-card valid' : 'lms-cert-card invalid'}
      aria-labelledby="lms-cert-verdict"
      role="status"
    >
      <h2 id="lms-cert-verdict">{verdict.valid ? labels.validTitle : labels.invalidTitle}</h2>
      <dl className="lms-cert-details">
        <div>
          <dt>{labels.codeLabel}</dt>
          <dd dir="ltr">{verdict.code}</dd>
        </div>
        {verdict.valid && (
          <>
            {verdict.course_title && (
              <div>
                <dt>{labels.courseLabel}</dt>
                <dd>{pickText(verdict.course_title, locale)}</dd>
              </div>
            )}
            {verdict.holder_name && (
              <div>
                <dt>{labels.recipientLabel}</dt>
                <dd>{verdict.holder_name}</dd>
              </div>
            )}
            {verdict.issued_at && (
              <div>
                <dt>{labels.issuedAtLabel}</dt>
                <dd>{formatDateTime(verdict.issued_at, locale)}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {!verdict.valid && <p className="lms-muted">{labels.invalidBody}</p>}
    </section>
  );
}
