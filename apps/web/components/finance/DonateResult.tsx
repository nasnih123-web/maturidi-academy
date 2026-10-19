/**
 * DonateResult — presentational gateway-return state (Phase 15).
 * Renders only; verification and the receipt download live in
 * useDonateResult (ADR-001).
 */
export type DonateResultStatus = 'verifying' | 'success' | 'failed' | 'unknown';

export interface DonateResultLabels {
  verifyingTitle: string;
  verifyingBody: string;
  successTitle: string;
  successBody: string;
  failedTitle: string;
  failedBody: string;
  unknownTitle: string;
  unknownBody: string;
  amountRow: string;
  campaignRow: string;
  authorityRow: string;
  receiptButton: string;
  receiptDownloading: string;
  receiptFailed: string;
  receiptAuthHint: string;
  receiptHint: string;
  retryPayment: string;
  backToCampaigns: string;
}

export interface DonateResultProps {
  status: DonateResultStatus;
  campaignTitle: string | null;
  amountLabel: string | null;
  authority: string | null;
  showReceipt: boolean;
  receiptBusy: boolean;
  receiptFailed: boolean;
  receiptForbidden: boolean;
  onReceipt: () => void;
  retryHref: string;
  campaignsHref: string;
  labels: DonateResultLabels;
}

const ICONS: Record<DonateResultStatus, string> = {
  verifying: '…',
  success: '✓',
  failed: '✕',
  unknown: '؟',
};

export function DonateResult({
  status,
  campaignTitle,
  amountLabel,
  authority,
  showReceipt,
  receiptBusy,
  receiptFailed,
  receiptForbidden,
  onReceipt,
  retryHref,
  campaignsHref,
  labels,
}: DonateResultProps) {
  const title =
    status === 'success'
      ? labels.successTitle
      : status === 'failed'
        ? labels.failedTitle
        : status === 'verifying'
          ? labels.verifyingTitle
          : labels.unknownTitle;
  const body =
    status === 'success'
      ? labels.successBody
      : status === 'failed'
        ? labels.failedBody
        : status === 'verifying'
          ? labels.verifyingBody
          : labels.unknownBody;
  return (
    <div className={`fin-result fin-result-${status}`} role="status">
      <div className="fin-result-icon" aria-hidden>
        {ICONS[status]}
      </div>
      <h2 className="fin-result-title">{title}</h2>
      <p className="fin-result-body">{body}</p>
      {campaignTitle || amountLabel || authority ? (
        <dl className="fin-result-rows">
          {campaignTitle ? (
            <div className="fin-result-row">
              <dt>{labels.campaignRow}</dt>
              <dd>{campaignTitle}</dd>
            </div>
          ) : null}
          {amountLabel ? (
            <div className="fin-result-row">
              <dt>{labels.amountRow}</dt>
              <dd dir="ltr">{amountLabel}</dd>
            </div>
          ) : null}
          {authority ? (
            <div className="fin-result-row">
              <dt>{labels.authorityRow}</dt>
              <dd dir="ltr" className="fin-mono">{authority}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <div className="fin-result-actions">
        {showReceipt ? (
          <button type="button" className="btn-primary" onClick={onReceipt} disabled={receiptBusy}>
            {receiptBusy ? labels.receiptDownloading : labels.receiptButton}
          </button>
        ) : null}
        {status === 'failed' ? (
          <a className="btn-primary" href={retryHref}>
            {labels.retryPayment}
          </a>
        ) : null}
        <a className="fin-link" href={campaignsHref}>
          {labels.backToCampaigns}
        </a>
      </div>
      {receiptFailed ? (
        <p className="fin-error" role="alert">
          {receiptForbidden ? labels.receiptAuthHint : labels.receiptFailed}
        </p>
      ) : null}
      {showReceipt && !receiptFailed ? <p className="fin-hint">{labels.receiptHint}</p> : null}
    </div>
  );
}
