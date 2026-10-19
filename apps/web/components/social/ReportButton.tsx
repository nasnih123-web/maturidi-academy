'use client';

/**
 * ReportButton — presentational report dialog (ADR-001).
 *
 * Opens a reason select, submits via useReport → POST
 * /api/v1/social/report, and shows the moderation-queue confirmation
 * (with SLA when the backend advertises one).
 */

import { useReport } from '@/lib/hooks/useSocial';
import type { ReportInput } from '@/lib/social';
import { REPORT_REASONS } from './labels';

interface ReportButtonProps {
  targetType: ReportInput['target_type'];
  targetId: string;
  reportLabel: string;
  dialogTitle: string;
  reasonLabel: string;
  reasons: Record<string, string>;
  submitLabel: string;
  cancelLabel: string;
  successMessage: string;
  errorMessage: string;
  closeLabel: string;
}

export function ReportButton({
  targetType,
  targetId,
  reportLabel,
  dialogTitle,
  reasonLabel,
  reasons,
  submitLabel,
  cancelLabel,
  successMessage,
  errorMessage,
  closeLabel,
}: ReportButtonProps) {
  const report = useReport();

  return (
    <span className="soc-report">
      <button
        type="button"
        className="soc-btn soc-btn-ghost soc-btn-sm"
        onClick={() => report.setOpen(true)}
      >
        {reportLabel}
      </button>
      {report.open && (
        <div
          className="soc-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={dialogTitle}
          onClick={() => {
            if (!report.submitting) report.reset();
          }}
        >
          <div
            className="soc-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {report.succeeded ? (
              <>
                <p className="soc-dialog-success" role="status">
                  {successMessage}
                  {typeof report.slaHours === 'number' && (
                    <span className="soc-sla"> · SLA {report.slaHours}h</span>
                  )}
                </p>
                <div className="soc-dialog-actions">
                  <button
                    type="button"
                    className="soc-btn soc-btn-primary"
                    onClick={report.reset}
                  >
                    {closeLabel}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="soc-dialog-title">{dialogTitle}</h3>
                <label className="soc-field">
                  <span className="soc-field-label">{reasonLabel}</span>
                  <select
                    className="soc-select"
                    value={report.reason}
                    onChange={(e) => report.setReason(e.target.value)}
                    disabled={report.submitting}
                  >
                    {REPORT_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {reasons[r] ?? r}
                      </option>
                    ))}
                  </select>
                </label>
                {report.failed && (
                  <p className="soc-error" role="alert">
                    {errorMessage}
                  </p>
                )}
                <div className="soc-dialog-actions">
                  <button
                    type="button"
                    className="soc-btn soc-btn-ghost"
                    onClick={report.reset}
                    disabled={report.submitting}
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    className="soc-btn soc-btn-primary"
                    onClick={() => void report.submit({ target_type: targetType, target_id: targetId, reason: report.reason })}
                    disabled={report.submitting}
                  >
                    {submitLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
