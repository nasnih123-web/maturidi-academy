'use client';

/**
 * ZakatCalculator — zakat calculator UI (Phase 7).
 *
 * Pure presentation + form state. The 2.5% rate and the nisab threshold
 * both come from the backend's scholar-approved rule config
 * (engineering-contract §15.5) — never computed here.
 * All strings arrive via `labels`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ZAKAT_ASSET_KEYS,
  calculateZakat,
  formatAmount,
  formatRateDate,
  getNisabRate,
  parseDecimalInput,
  type MadhabKey,
  type NisabRate,
  type ZakatAssetKey,
  type ZakatAssets,
  type ZakatResult,
} from '@/lib/calculators';

export interface ZakatLabels {
  madhabLabel: string;
  madhabs: Record<MadhabKey, string>;
  assetsTitle: string;
  assetLabels: Record<ZakatAssetKey, string>;
  assetHints: Record<ZakatAssetKey, string>;
  debtsLabel: string;
  debtsHint: string;
  calculate: string;
  calculating: string;
  invalidInput: string;
  failed: string;
  pendingTitle: string;
  pendingBody: string;
  recalculate: string;
  resultTitle: string;
  zakatableTotalLabel: string;
  debtsDeductedLabel: string;
  nisabThresholdLabel: string;
  zakatDueLabel: string;
  ruleVersion: string; // "…{version}" template
  rateNote: string; // "…{note}" template
  rateFresh: string;
  rateStale: string;
  rateAsOf: string; // "…{date}" template
  ratePending: string;
  rateFailed: string;
  print: string;
}

type Phase = 'form' | 'calculating' | 'result' | 'pending' | 'error';

type RateState =
  | { kind: 'loading' }
  | { kind: 'ready'; rate: NisabRate }
  | { kind: 'pending' }
  | { kind: 'failed' };

const emptyAssets = (): Record<ZakatAssetKey, string> => ({
  gold_grams: '',
  silver_grams: '',
  cash: '',
  bank_deposits: '',
  trade_goods: '',
  receivables: '',
  investments: '',
});

export function ZakatCalculator({ labels, locale }: { labels: ZakatLabels; locale: string }) {
  const [madhab, setMadhab] = useState<MadhabKey>('hanafi');
  const [assets, setAssets] = useState(emptyAssets());
  const [debts, setDebts] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ZakatResult | null>(null);
  const [rate, setRate] = useState<RateState>({ kind: 'loading' });
  const abortRef = useRef<AbortController | null>(null);

  // Nisab rate freshness badge — fetched independently of the calculation.
  useEffect(() => {
    let cancelled = false;
    getNisabRate()
      .then((r) => {
        if (cancelled) return;
        // No price source configured → honest "pending" badge, never "fresh".
        setRate(r.status === 'price_unavailable' ? { kind: 'pending' } : { kind: 'ready', rate: r });
      })
      .catch((err) => {
        if (cancelled) return;
        const api = err as { rulesNotApproved?: boolean };
        setRate({ kind: api.rulesNotApproved ? 'pending' : 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setAsset = (k: ZakatAssetKey, v: string) =>
    setAssets((a) => ({ ...a, [k]: v }));

  function parseInputs(): { assets: ZakatAssets; debts: number } | null {
    const parsed = {} as ZakatAssets;
    for (const k of ZAKAT_ASSET_KEYS) {
      const raw = assets[k].trim();
      if (raw === '') {
        parsed[k] = 0;
        continue;
      }
      const n = parseDecimalInput(raw);
      if (n === null || n < 0) return null;
      parsed[k] = n;
    }
    const dRaw = debts.trim();
    let d = 0;
    if (dRaw !== '') {
      const n = parseDecimalInput(dRaw);
      if (n === null || n < 0) return null;
      d = n;
    }
    return { assets: parsed, debts: d };
  }

  async function onCalculate() {
    setError('');
    const parsed = parseInputs();
    if (!parsed) {
      setError(labels.invalidInput);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('calculating');
    try {
      const res = await calculateZakat(parsed.assets, parsed.debts, madhab, {
        signal: ctrl.signal,
      });
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
      <div className="calc-rate-badge" role="status">
        {rate.kind === 'loading' && <span className="calc-hint">…</span>}
        {rate.kind === 'ready' && (
          <span
            className={rate.rate.stale ? 'calc-badge calc-badge-stale' : 'calc-badge calc-badge-fresh'}
          >
            {rate.rate.stale ? labels.rateStale : labels.rateFresh}
            {' · '}
            {labels.rateAsOf.replace('{date}', formatRateDate(rate.rate.fetched_at, locale))}
          </span>
        )}
        {rate.kind === 'pending' && <span className="calc-badge">{labels.ratePending}</span>}
        {rate.kind === 'failed' && <span className="calc-hint">{labels.rateFailed}</span>}
      </div>

      {phase !== 'result' && (
        <div className="calc-form">
          <div className="calc-field">
            <label htmlFor="zakat-madhab">{labels.madhabLabel}</label>
            <select
              id="zakat-madhab"
              value={madhab}
              onChange={(e) => setMadhab(e.target.value as MadhabKey)}
              disabled={phase === 'calculating'}
            >
              {(['hanafi', 'maliki', 'shafi', 'hanbali'] as MadhabKey[]).map((m) => (
                <option key={m} value={m}>
                  {labels.madhabs[m]}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="calc-fieldset">
            <legend>{labels.assetsTitle}</legend>
            {ZAKAT_ASSET_KEYS.map((k) => (
              <div key={k} className="calc-field">
                <label htmlFor={`zakat-${k}`}>{labels.assetLabels[k]}</label>
                <input
                  id={`zakat-${k}`}
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={assets[k]}
                  onChange={(e) => setAsset(k, e.target.value)}
                  disabled={phase === 'calculating'}
                />
                {labels.assetHints[k] && <p className="calc-hint">{labels.assetHints[k]}</p>}
              </div>
            ))}
          </fieldset>

          <div className="calc-field">
            <label htmlFor="zakat-debts">{labels.debtsLabel}</label>
            <input
              id="zakat-debts"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={debts}
              onChange={(e) => setDebts(e.target.value)}
              disabled={phase === 'calculating'}
            />
            <p className="calc-hint">{labels.debtsHint}</p>
          </div>

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
          <dl className="calc-result-list">
            <div>
              <dt>{labels.zakatableTotalLabel}</dt>
              <dd>{formatAmount(result.zakatable_total, locale)}</dd>
            </div>
            <div>
              <dt>{labels.debtsDeductedLabel}</dt>
              <dd>− {formatAmount(result.debts, locale)}</dd>
            </div>
            <div>
              <dt>{labels.nisabThresholdLabel}</dt>
              <dd>{formatAmount(result.nisab.threshold, locale)}</dd>
            </div>
            <div className="calc-due">
              <dt>{labels.zakatDueLabel}</dt>
              <dd>{formatAmount(result.zakat_due, locale)}</dd>
            </div>
          </dl>

          {result.rate_note && (
            <p className="calc-hint">{labels.rateNote.replace('{note}', result.rate_note)}</p>
          )}
          <p className="calc-rule-version">
            {labels.ruleVersion.replace('{version}', result.applied_rule_version)}
          </p>

          <div className="calc-actions">
            <button type="button" className="calc-btn" onClick={() => window.print()}>
              🖨 {labels.print}
            </button>
            <button
              type="button"
              className="calc-btn calc-btn-ghost"
              onClick={() => setPhase('form')}
            >
              {labels.recalculate}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
