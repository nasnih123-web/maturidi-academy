'use client';

/**
 * InheritanceCalculator — fara'id (inheritance) calculator UI (Phase 7).
 *
 * Pure presentation + form state. Every figure on screen comes from the
 * backend (lib/calculators.ts); the component computes NOTHING fiqh —
 * engineering-contract §15.5. All strings arrive via `labels`.
 */
import { useRef, useState } from 'react';
import {
  HEIR_TYPES,
  MADHABS,
  calculateInheritance,
  formatAmount,
  parseDecimalInput,
  saveInheritanceCase,
  type HeirRow,
  type InheritanceResult,
  type MadhabKey,
} from '@/lib/calculators';
import { getAccessToken, isLoggedIn } from '@/lib/auth-client';

export interface InheritanceLabels {
  madhabLabel: string;
  madhabs: Record<MadhabKey, string>;
  estateLabel: string;
  estatePlaceholder: string;
  estateHint: string;
  heirsTitle: string;
  heirTypeLabel: string;
  heirCountLabel: string;
  heirTypes: Record<string, string>;
  addHeir: string;
  removeHeir: string;
  calculate: string;
  calculating: string;
  estateInvalid: string;
  needHeir: string;
  countInvalid: string;
  resultTitle: string;
  heirCol: string;
  countCol: string;
  shareCol: string;
  amountCol: string;
  totalLabel: string;
  ruleVersion: string; // "…{version}" template
  notesTitle: string;
  print: string;
  save: string;
  saveLoginHint: string;
  saving: string;
  saved: string;
  saveFailed: string;
  recalculate: string;
  failed: string;
  pendingTitle: string;
  pendingBody: string;
}

type Phase = 'form' | 'calculating' | 'result' | 'pending' | 'error';

let rowSeq = 0;
const newRow = (): HeirRow & { id: number } => ({ id: ++rowSeq, type: 'husband', count: 1 });

export function InheritanceCalculator({
  labels,
  locale,
}: {
  labels: InheritanceLabels;
  locale: string;
}) {
  const [madhab, setMadhab] = useState<MadhabKey>('hanafi');
  const [estate, setEstate] = useState('');
  const [rows, setRows] = useState<(HeirRow & { id: number })[]>([newRow()]);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<InheritanceResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const loggedIn = typeof window !== 'undefined' && isLoggedIn();

  const setRow = (id: number, patch: Partial<HeirRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const removeRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  async function onCalculate() {
    setError('');
    setSaved(false);
    setSaveError('');
    const estateValue = parseDecimalInput(estate);
    if (estateValue === null || estateValue <= 0) {
      setError(labels.estateInvalid);
      return;
    }
    if (rows.length === 0) {
      setError(labels.needHeir);
      return;
    }
    for (const r of rows) {
      if (!Number.isInteger(r.count) || r.count < 1 || r.count > 99) {
        setError(labels.countInvalid);
        return;
      }
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('calculating');
    try {
      const res = await calculateInheritance(
        estateValue,
        madhab,
        rows.map((r) => ({ type: r.type, count: r.count })),
        { signal: ctrl.signal },
      );
      setResult(res);
      setPhase('result');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const api = err as { rulesNotApproved?: boolean };
      if (api.rulesNotApproved) {
        setPhase('pending');
        return;
      }
      setError(err instanceof Error ? err.message : labels.failed);
      setPhase('error');
    }
  }

  async function onSave() {
    const token = getAccessToken();
    const estateValue = parseDecimalInput(estate);
    if (!token || estateValue === null) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await saveInheritanceCase(
        token,
        estateValue,
        madhab,
        rows.map((r) => ({ type: r.type, count: r.count })),
      );
      setResult(res);
      setSaved(true);
    } catch {
      setSaveError(labels.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const total = result?.shares.reduce((s, x) => s + x.amount, 0) ?? 0;

  if (phase === 'pending') {
    return (
      <div className="empty-state calc-pending" role="status">
        <span className="es-icon" aria-hidden="true">
          ⏳
        </span>
        <h3>{labels.pendingTitle}</h3>
        <p>{labels.pendingBody}</p>
        <button type="button" className="calc-btn calc-btn-ghost" onClick={() => setPhase('form')}>
          {labels.recalculate}
        </button>
      </div>
    );
  }

  return (
    <div className="calc-root">
      {phase !== 'result' && (
        <div className="calc-form">
          <div className="calc-field">
            <label htmlFor="calc-madhab">{labels.madhabLabel}</label>
            <select
              id="calc-madhab"
              value={madhab}
              onChange={(e) => setMadhab(e.target.value as MadhabKey)}
              disabled={phase === 'calculating'}
            >
              {MADHABS.map((m) => (
                <option key={m} value={m}>
                  {labels.madhabs[m]}
                </option>
              ))}
            </select>
          </div>

          <div className="calc-field">
            <label htmlFor="calc-estate">{labels.estateLabel}</label>
            <input
              id="calc-estate"
              type="text"
              inputMode="decimal"
              placeholder={labels.estatePlaceholder}
              value={estate}
              onChange={(e) => setEstate(e.target.value)}
              disabled={phase === 'calculating'}
            />
            <p className="calc-hint">{labels.estateHint}</p>
          </div>

          <fieldset className="calc-fieldset">
            <legend>{labels.heirsTitle}</legend>
            {rows.map((r) => (
              <div key={r.id} className="calc-heir-row">
                <label>
                  <span className="calc-sr">{labels.heirTypeLabel}</span>
                  <select
                    value={r.type}
                    onChange={(e) => setRow(r.id, { type: e.target.value as HeirRow['type'] })}
                    disabled={phase === 'calculating'}
                  >
                    {HEIR_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {labels.heirTypes[t] ?? t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="calc-sr">{labels.heirCountLabel}</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={r.count}
                    onChange={(e) => setRow(r.id, { count: Number(e.target.value) || 0 })}
                    disabled={phase === 'calculating'}
                    aria-label={labels.heirCountLabel}
                  />
                </label>
                <button
                  type="button"
                  className="calc-btn calc-btn-ghost calc-btn-danger"
                  onClick={() => removeRow(r.id)}
                  disabled={phase === 'calculating' || rows.length === 1}
                  aria-label={labels.removeHeir}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="calc-btn calc-btn-ghost"
              onClick={addRow}
              disabled={phase === 'calculating'}
            >
              + {labels.addHeir}
            </button>
          </fieldset>

          {(error || phase === 'error') && (
            <p className="calc-error" role="alert">
              {error || labels.failed}
            </p>
          )}

          <button
            type="button"
            className="calc-btn calc-btn-primary"
            onClick={onCalculate}
            disabled={phase === 'calculating'}
          >
            {phase === 'calculating' ? labels.calculating : labels.calculate}
          </button>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="calc-result calc-print-area">
          <h2>{labels.resultTitle}</h2>
          <table className="calc-table">
            <thead>
              <tr>
                <th scope="col">{labels.heirCol}</th>
                <th scope="col">{labels.countCol}</th>
                <th scope="col">{labels.shareCol}</th>
                <th scope="col">{labels.amountCol}</th>
              </tr>
            </thead>
            <tbody>
              {result.shares.map((s, i) => (
                <tr key={`${s.heir_type}-${i}`}>
                  <td>{labels.heirTypes[s.heir_type] ?? s.heir_type}</td>
                  <td>{formatAmount(s.count, locale)}</td>
                  <td>{s.share_fraction}</td>
                  <td>{formatAmount(s.amount, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>{labels.totalLabel}</td>
                <td>{formatAmount(total, locale)}</td>
              </tr>
            </tfoot>
          </table>

          <p className="calc-rule-version">
            {labels.ruleVersion.replace('{version}', result.applied_rule_version)}
          </p>

          {result.notes.length > 0 && (
            <div className="calc-notes">
              <h3>{labels.notesTitle}</h3>
              <ul>
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="calc-actions">
            <button type="button" className="calc-btn" onClick={() => window.print()}>
              🖨 {labels.print}
            </button>
            {loggedIn ? (
              <button
                type="button"
                className="calc-btn calc-btn-ghost"
                onClick={onSave}
                disabled={saving || saved}
              >
                {saved ? `✓ ${labels.saved}` : saving ? labels.saving : `💾 ${labels.save}`}
              </button>
            ) : (
              <span className="calc-hint">{labels.saveLoginHint}</span>
            )}
            <button
              type="button"
              className="calc-btn calc-btn-ghost"
              onClick={() => setPhase('form')}
            >
              {labels.recalculate}
            </button>
          </div>
          {saveError && (
            <p className="calc-error" role="alert">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
