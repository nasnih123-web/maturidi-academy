'use client';

/**
 * SubmitFatwaView — scholar-author fatwa submission form (client shell, ADR-001).
 *
 * Visible only to the scholar_author role (useIsScholarAuthor reads the
 * RBAC roles from the access token — the backend is the authority).
 * POST /api/v1/fatwa/submissions enters the shared workflow as draft.
 */

import { useFatwaSubmission, useIsScholarAuthor } from '@/lib/hooks/useSocial';
import type { FatwaSubmitLabels } from '@/components/social/labels';

interface SubmitFatwaViewProps {
  labels: FatwaSubmitLabels;
}

export function SubmitFatwaView({ labels }: SubmitFatwaViewProps) {
  const isScholar = useIsScholarAuthor();
  const form = useFatwaSubmission();

  if (!isScholar) {
    return (
      <div className="page-wrap">
        <h1 className="page-title">{labels.title}</h1>
        <p className="soc-status" role="alert">
          {labels.forbidden}
        </p>
      </div>
    );
  }

  if (form.result) {
    return (
      <div className="page-wrap">
        <h1 className="page-title">{labels.successTitle}</h1>
        <p className="page-sub">{labels.successBody}</p>
        <p className="soc-status" role="status">
          {form.result.workflow_state}
        </p>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <h1 className="page-title">{labels.title}</h1>
      <p className="page-sub">{labels.subtitle}</p>

      <form
        className="soc-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
      >
        <label className="soc-field" htmlFor="ftw-submit-title">
          <span className="soc-field-label">{labels.titleLabel}</span>
          <input
            id="ftw-submit-title"
            className="soc-input"
            type="text"
            placeholder={labels.titlePlaceholder}
            value={form.title}
            onChange={(e) => form.setTitle(e.target.value)}
            disabled={form.submitting}
          />
        </label>

        <label className="soc-field" htmlFor="ftw-submit-body">
          <span className="soc-field-label">{labels.bodyLabel}</span>
          <textarea
            id="ftw-submit-body"
            className="soc-composer-input"
            placeholder={labels.bodyPlaceholder}
            value={form.body}
            onChange={(e) => form.setBody(e.target.value)}
            rows={6}
            disabled={form.submitting}
          />
        </label>

        <label className="soc-field" htmlFor="ftw-submit-madhab">
          <span className="soc-field-label">{labels.madhabLabel}</span>
          <select
            id="ftw-submit-madhab"
            className="soc-select"
            value={form.madhab}
            onChange={(e) => form.setMadhab(e.target.value)}
            disabled={form.submitting}
          >
            {Object.entries(labels.madhabOptions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="soc-field" htmlFor="ftw-submit-evidence">
          <span className="soc-field-label">{labels.evidenceLabel}</span>
          <textarea
            id="ftw-submit-evidence"
            className="soc-composer-input"
            placeholder={labels.evidencePlaceholder}
            value={form.evidence}
            onChange={(e) => form.setEvidence(e.target.value)}
            rows={4}
            disabled={form.submitting}
          />
        </label>

        {form.failed && (
          <p className="soc-error" role="alert">
            {labels.error}
          </p>
        )}
        <div className="soc-composer-foot">
          <button
            type="submit"
            className="soc-btn soc-btn-primary"
            disabled={form.submitting || form.title.trim() === '' || form.body.trim() === ''}
          >
            {form.submitting ? labels.submitting : labels.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
