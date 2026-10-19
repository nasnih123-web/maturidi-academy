'use client';

/**
 * VerifyPanel — paste-a-text content verification UI (Phase 6).
 *
 * Pure presentation + lib/verify.ts (ADR-001). All strings via `labels`.
 */
import { useRef, useState } from 'react';
import { checkText, type VerifyResult } from '@/lib/verify';

export interface VerifyPanelLabels {
  inputLabel: string;
  inputPlaceholder: string;
  check: string;
  checking: string;
  cancel: string;
  inputEmpty: string;
  checkFailed: string;
  verdictVerifiedTitle: string;
  verdictVerifiedBody: string;
  verdictNotFoundTitle: string;
  verdictNotFoundBody: string;
  verdictConflictTitle: string;
  verdictConflictBody: string;
  sourcesTitle: string;
  nearestLabel: string;
}

export function VerifyPanel({ labels, locale }: { labels: VerifyPanelLabels; locale: string }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || loading) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await checkText(text.trim(), { locale, signal: ctrl.signal });
      setResult(res);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        /* cancelled — keep silent */
      } else {
        setError(err instanceof Error ? err.message : 'request failed');
      }
    } finally {
      setLoading(false);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  return (
    <div className="ftw-verify">
      <form onSubmit={run}>
        <label htmlFor="vfy-text">{labels.inputLabel}</label>
        <textarea
          id="vfy-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={labels.inputPlaceholder}
          rows={6}
          disabled={loading}
        />
        <div className="ftw-form-actions">
          {loading ? (
            <>
              <span className="ftw-muted">{labels.checking}</span>
              <button type="button" className="icon-btn" onClick={() => abortRef.current?.abort()}>
                {labels.cancel}
              </button>
            </>
          ) : (
            <button type="submit" className="ftw-ask" disabled={!text.trim()}>
              {labels.check}
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="ftw-error" role="alert">
          {labels.checkFailed}: {error}
        </div>
      )}

      {result && (
        <div className={`ftw-verdict ftw-verdict-${result.verdict}`} role="status">
          <h2>
            {result.verdict === 'verified'
              ? labels.verdictVerifiedTitle
              : result.verdict === 'conflicting'
                ? labels.verdictConflictTitle
                : labels.verdictNotFoundTitle}
          </h2>
          <p>
            {result.verdict === 'verified'
              ? labels.verdictVerifiedBody
              : result.verdict === 'conflicting'
                ? labels.verdictConflictBody
                : labels.verdictNotFoundBody}
          </p>
          {result.note && <p className="ftw-note">{result.note}</p>}
          {result.sources.length > 0 && (
            <div className="ftw-citations">
              <h3>{labels.sourcesTitle}</h3>
              <ul>
                {result.sources.map((s, i) => (
                  <li key={i}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        <strong>{s.title || s.citation}</strong>
                      </a>
                    ) : (
                      <strong>{s.title || s.citation}</strong>
                    )}
                    {s.citation && s.title && <p>{s.citation}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.nearest && (
            <div className="ftw-nearest">
              <h3>{labels.nearestLabel}</h3>
              <p>{result.nearest}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
