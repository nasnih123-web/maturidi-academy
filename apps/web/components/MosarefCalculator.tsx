'use client';

/**
 * MosarefCalculator — Arabic verb conjugation UI (Phase 4).
 *
 * Pure presentation + form state. All conjugation is computed by the
 * backend (pure linguistics engine; no fiqh gate). Tables render
 * generically from the structured API output; row labels are the
 * Arabic pronouns (grammar terms, same across locales).
 */
import { useRef, useState } from 'react';
import {
  MOSAREF_BABS,
  conjugateMosaref,
  type HarfJar,
  type MosarefBab,
  type MosarefResult,
  type MosarefTable,
  type MosarefTransitivity,
} from '@/lib/calculators';

export interface MosarefLabels {
  rootLabel: string;
  rootPlaceholder: string;
  babLabel: string;
  babs: Record<string, string>;
  transitivityLabel: string;
  mutaadi: string;
  laazim: string;
  harfJarLabel: string;
  harfJars: Record<string, string>;
  conjugate: string;
  conjugating: string;
  invalidInput: string;
  failed: string;
  errors: Record<string, string>;
  tables: Record<string, string>;
  columns: Record<string, string>;
  pronouns: string[];
  amrPronouns: string[];
  derivedRows3: string[];
  derivedRows6: string[];
  verbClassLabel: string;
  verbClasses: Record<string, string>;
  approximateNote: string;
}

type Phase = 'form' | 'conjugating' | 'result' | 'error';

const COLUMN_ORDER = [
  'active',
  'passive',
  'amr_active',
  'amr_passive',
  'nahi_active',
  'nahi_passive',
  'ism_fail',
  'ism_maful',
  'form',
];

function rowLabelsFor(table: MosarefTable, labels: MosarefLabels): string[] {
  if (table.key === 'amr_nahi') return labels.amrPronouns;
  if (table.key === 'tafdil') return labels.derivedRows6;
  if (table.key === 'zaman_makan' || table.key === 'alat') return labels.derivedRows3;
  if (table.key === 'zaman_same_as_maful') return [''];
  return labels.pronouns;
}

function MosarefTableView({ table, labels }: { table: MosarefTable; labels: MosarefLabels }) {
  const colKeys = COLUMN_ORDER.filter((k) => k in table.columns);
  const rowCount = Math.max(0, ...colKeys.map((k) => table.columns[k].length));
  const rowLabels = rowLabelsFor(table, labels);
  return (
    <div className="calc-table-block">
      <h3>{labels.tables[table.key] ?? table.key}</h3>
      <div className="calc-table-scroll">
        <table className="calc-table" dir="rtl">
          <thead>
            <tr>
              <th scope="col">{labels.columns.pronoun ?? ''}</th>
              {colKeys.map((k) => (
                <th key={k} scope="col">
                  {labels.columns[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, i) => (
              <tr key={i}>
                <th scope="row">{rowLabels[i] ?? ''}</th>
                {colKeys.map((k) => (
                  <td key={k} lang="ar">
                    {table.columns[k][i] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MosarefCalculator({ labels, locale }: { labels: MosarefLabels; locale: string }) {
  const [root, setRoot] = useState('');
  const [bab, setBab] = useState<MosarefBab>('faala');
  const [transitivity, setTransitivity] = useState<MosarefTransitivity>('mutaadi');
  const [harfJar, setHarfJar] = useState<HarfJar>('bi');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<MosarefResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function onConjugate() {
    setError('');
    if (!root.trim()) {
      setError(labels.invalidInput);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('conjugating');
    try {
      const res = await conjugateMosaref(root.trim(), bab, transitivity, harfJar, {
        signal: ctrl.signal,
      });
      setResult(res);
      setPhase('result');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const code = (err as { code?: string | null }).code;
      setError((code && labels.errors[code]) || labels.failed);
      setPhase('error');
    }
  }

  return (
    <div className="calc-root">
      <div className="calc-form">
        <div className="calc-field">
          <label htmlFor="mosaref-root">{labels.rootLabel}</label>
          <input
            id="mosaref-root"
            type="text"
            lang="ar"
            dir="rtl"
            placeholder={labels.rootPlaceholder}
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            disabled={phase === 'conjugating'}
          />
        </div>
        <div className="calc-field">
          <label htmlFor="mosaref-bab">{labels.babLabel}</label>
          <select
            id="mosaref-bab"
            value={bab}
            onChange={(e) => setBab(e.target.value as MosarefBab)}
            disabled={phase === 'conjugating'}
          >
            {MOSAREF_BABS.map((b) => (
              <option key={b} value={b}>
                {labels.babs[b] ?? b}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field">
          <label htmlFor="mosaref-trans">{labels.transitivityLabel}</label>
          <select
            id="mosaref-trans"
            value={transitivity}
            onChange={(e) => setTransitivity(e.target.value as MosarefTransitivity)}
            disabled={phase === 'conjugating'}
          >
            <option value="mutaadi">{labels.mutaadi}</option>
            <option value="laazim">{labels.laazim}</option>
          </select>
        </div>
        {transitivity === 'laazim' && (
          <div className="calc-field">
            <label htmlFor="mosaref-jar">{labels.harfJarLabel}</label>
            <select
              id="mosaref-jar"
              value={harfJar}
              onChange={(e) => setHarfJar(e.target.value as HarfJar)}
              disabled={phase === 'conjugating'}
            >
              {(Object.keys(labels.harfJars) as HarfJar[]).map((k) => (
                <option key={k} value={k}>
                  {labels.harfJars[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        {(error || phase === 'error') && (
          <p className="calc-error" role="alert">
            {error || labels.failed}
          </p>
        )}
        <button
          type="button"
          className="calc-btn calc-btn-primary"
          onClick={onConjugate}
          disabled={phase === 'conjugating'}
        >
          {phase === 'conjugating' ? labels.conjugating : labels.conjugate}
        </button>
      </div>

      {phase === 'result' && result && (
        <div className="calc-result">
          <p className="calc-hint">
            {labels.verbClassLabel}: {labels.verbClasses[result.verb_class] ?? result.verb_class}
          </p>
          {result.flags.approximate_past && (
            <p className="calc-hint">⚠ {labels.approximateNote}</p>
          )}
          {result.tables.map((table) => (
            <MosarefTableView key={table.key} table={table} labels={labels} />
          ))}
        </div>
      )}
    </div>
  );
}
