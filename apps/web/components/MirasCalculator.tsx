'use client';

/**
 * MirasCalculator — Hanafi fara'id UI (Phase 4, Sirajiyyah engine).
 *
 * Pure presentation + form state; every share is computed by the
 * backend. The scholar-review gate applies exactly as in Phase 7:
 * without an approved miras rule config the UI renders the honest
 * pending state — never numbers. A stopped calculation (impediment,
 * no distributable heir, incomplete total, multi-branch dhawu
 * al-arham) renders the corresponding explanatory state, not an error.
 */
import { useRef, useState } from 'react';
import {
  calculateMiras,
  formatAmount,
  formatFraction,
  parseDecimalInput,
  type MirasRequest,
  type MirasResult,
} from '@/lib/calculators';

export interface MirasLabels {
  groups: Record<string, string>;
  heirLabels: Record<string, string>;
  genderLabel: string;
  male: string;
  female: string;
  estateTitle: string;
  estateValueLabel: string;
  funeralLabel: string;
  debtLabel: string;
  willLabel: string;
  willForHeirLabel: string;
  willApprovedLabel: string;
  impedimentsTitle: string;
  impedimentLabels: Record<string, string>;
  calculate: string;
  calculating: string;
  invalidInput: string;
  failed: string;
  pendingTitle: string;
  pendingBody: string;
  recalculate: string;
  resultTitle: string;
  netEstateLabel: string;
  willAppliedLabel: string;
  awlBadge: string;
  raddBadge: string;
  shareLabel: string;
  countLabel: string;
  amountLabel: string;
  perPersonLabel: string;
  blockedTitle: string;
  stoppedTitle: string;
  stopCodes: Record<string, string>;
  ruleVersion: string;
  draftNote: string;
}

type Phase = 'form' | 'calculating' | 'result' | 'pending' | 'stopped' | 'error';

const BOOL_FIELDS = ['husband', 'father', 'mother', 'grandfather', 'mgm', 'pgm'] as const;
const GROUPS: Record<string, string[]> = {
  descendants: ['sons', 'daughters', 'son_sons', 'son_daughters'],
  siblings: [
    'brothers',
    'sisters',
    'paternal_brothers',
    'paternal_sisters',
    'uterine_brothers',
    'uterine_sisters',
  ],
  nephewsUncles: [
    'full_brother_sons',
    'paternal_brother_sons',
    'full_uncles',
    'paternal_uncles',
    'full_uncle_sons',
    'paternal_uncle_sons',
  ],
  dhawu: [
    'daughter_sons',
    'daughter_daughters',
    'son_daughter_sons',
    'son_daughter_daughters',
    'maternal_grandfather',
    'remote_grandmothers',
    'sister_sons',
    'sister_daughters',
    'full_brother_daughters',
    'paternal_brother_daughters',
    'uterine_brother_children',
    'uterine_sister_children',
    'maternal_uncles',
    'maternal_aunts',
    'maternal_paternal_uncles',
    'paternal_aunts',
    'paternal_uncle_daughters',
  ],
};
const IMPEDIMENTS = ['religion_mixed', 'killer', 'simultaneous_death', 'slavery'] as const;

export function MirasCalculator({ labels, locale }: { labels: MirasLabels; locale: string }) {
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [bools, setBools] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, string>>({ wives: '' });
  const [estate, setEstate] = useState({ value: '', funeral: '', debt: '', will: '' });
  const [willFlags, setWillFlags] = useState({ forHeir: false, approved: false });
  const [impediments, setImpediments] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<MirasResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function buildRequest(): MirasRequest | null {
    const estateValue = parseDecimalInput(estate.value);
    if (estateValue === null || estateValue < 0) return null;
    const optNum = (raw: string): number | null => {
      if (raw.trim() === '') return 0;
      const n = parseDecimalInput(raw);
      return n === null || n < 0 ? null : n;
    };
    const funeral = optNum(estate.funeral);
    const debt = optNum(estate.debt);
    const will = optNum(estate.will);
    if (funeral === null || debt === null || will === null) return null;
    const req: MirasRequest = {
      gender,
      estate_value: estateValue,
      funeral,
      debt,
      will,
      will_for_heir: willFlags.forHeir,
      will_approved: willFlags.approved,
      impediments: {
        religion_mixed: !!impediments.religion_mixed,
        killer: !!impediments.killer,
        simultaneous_death: !!impediments.simultaneous_death,
        slavery: !!impediments.slavery,
      },
    };
    for (const f of BOOL_FIELDS) {
      if (f === 'husband' && gender !== 'female') continue;
      (req as unknown as Record<string, unknown>)[f] = !!bools[f];
    }
    const countFields = ['wives', ...Object.values(GROUPS).flat()];
    for (const f of countFields) {
      if (f === 'wives' && gender !== 'male') continue;
      const raw = (counts[f] ?? '').trim();
      if (raw === '') continue;
      const n = parseDecimalInput(raw);
      if (n === null || !Number.isInteger(n) || n < 0 || n > 99) return null;
      (req as unknown as Record<string, unknown>)[f] = n;
    }
    return req;
  }

  async function onCalculate() {
    setError('');
    const req = buildRequest();
    if (!req) {
      setError(labels.invalidInput);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('calculating');
    try {
      const res = await calculateMiras(req, { signal: ctrl.signal });
      setResult(res);
      setPhase(res.status === 'stopped' ? 'stopped' : 'result');
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

  const heirName = (key: string) => labels.heirLabels[key] ?? key;

  return (
    <div className="calc-root">
      <p className="calc-hint">⚠ {labels.draftNote}</p>
      {phase !== 'result' && phase !== 'stopped' && (
        <div className="calc-form">
          <div className="calc-field">
            <label htmlFor="miras-gender">{labels.genderLabel}</label>
            <select
              id="miras-gender"
              value={gender}
              onChange={(e) => setGender(e.target.value as 'male' | 'female')}
              disabled={phase === 'calculating'}
            >
              <option value="male">{labels.male}</option>
              <option value="female">{labels.female}</option>
            </select>
          </div>

          <fieldset className="calc-fieldset">
            <legend>{labels.groups.family}</legend>
            {gender === 'female' && (
              <label className="calc-check">
                <input
                  type="checkbox"
                  checked={!!bools.husband}
                  onChange={(e) => setBools((b) => ({ ...b, husband: e.target.checked }))}
                  disabled={phase === 'calculating'}
                />
                {heirName('husband')}
              </label>
            )}
            {gender === 'male' && (
              <div className="calc-field">
                <label htmlFor="miras-wives">{heirName('wives')}</label>
                <input
                  id="miras-wives"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={counts.wives}
                  onChange={(e) => setCounts((c) => ({ ...c, wives: e.target.value }))}
                  disabled={phase === 'calculating'}
                />
              </div>
            )}
            {BOOL_FIELDS.filter((f) => f !== 'husband').map((f) => (
              <label key={f} className="calc-check">
                <input
                  type="checkbox"
                  checked={!!bools[f]}
                  onChange={(e) => setBools((b) => ({ ...b, [f]: e.target.checked }))}
                  disabled={phase === 'calculating'}
                />
                {heirName(f)}
              </label>
            ))}
          </fieldset>

          {Object.entries(GROUPS).map(([group, fields]) => (
            <fieldset key={group} className="calc-fieldset">
              <legend>{labels.groups[group]}</legend>
              {fields.map((f) => (
                <div key={f} className="calc-field">
                  <label htmlFor={`miras-${f}`}>{heirName(f)}</label>
                  <input
                    id={`miras-${f}`}
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={counts[f] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [f]: e.target.value }))}
                    disabled={phase === 'calculating'}
                  />
                </div>
              ))}
            </fieldset>
          ))}

          <fieldset className="calc-fieldset">
            <legend>{labels.estateTitle}</legend>
            <div className="calc-field">
              <label htmlFor="miras-estate">{labels.estateValueLabel}</label>
              <input
                id="miras-estate"
                type="text"
                inputMode="decimal"
                value={estate.value}
                onChange={(e) => setEstate((s) => ({ ...s, value: e.target.value }))}
                disabled={phase === 'calculating'}
              />
            </div>
            <div className="calc-field">
              <label htmlFor="miras-funeral">{labels.funeralLabel}</label>
              <input
                id="miras-funeral"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={estate.funeral}
                onChange={(e) => setEstate((s) => ({ ...s, funeral: e.target.value }))}
                disabled={phase === 'calculating'}
              />
            </div>
            <div className="calc-field">
              <label htmlFor="miras-debt">{labels.debtLabel}</label>
              <input
                id="miras-debt"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={estate.debt}
                onChange={(e) => setEstate((s) => ({ ...s, debt: e.target.value }))}
                disabled={phase === 'calculating'}
              />
            </div>
            <div className="calc-field">
              <label htmlFor="miras-will">{labels.willLabel}</label>
              <input
                id="miras-will"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={estate.will}
                onChange={(e) => setEstate((s) => ({ ...s, will: e.target.value }))}
                disabled={phase === 'calculating'}
              />
            </div>
            <label className="calc-check">
              <input
                type="checkbox"
                checked={willFlags.forHeir}
                onChange={(e) => setWillFlags((w) => ({ ...w, forHeir: e.target.checked }))}
                disabled={phase === 'calculating'}
              />
              {labels.willForHeirLabel}
            </label>
            <label className="calc-check">
              <input
                type="checkbox"
                checked={willFlags.approved}
                onChange={(e) => setWillFlags((w) => ({ ...w, approved: e.target.checked }))}
                disabled={phase === 'calculating'}
              />
              {labels.willApprovedLabel}
            </label>
          </fieldset>

          <fieldset className="calc-fieldset">
            <legend>{labels.impedimentsTitle}</legend>
            {IMPEDIMENTS.map((k) => (
              <label key={k} className="calc-check">
                <input
                  type="checkbox"
                  checked={!!impediments[k]}
                  onChange={(e) => setImpediments((s) => ({ ...s, [k]: e.target.checked }))}
                  disabled={phase === 'calculating'}
                />
                {labels.impedimentLabels[k]}
              </label>
            ))}
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

      {phase === 'stopped' && result && (
        <div className="empty-state calc-pending" role="status">
          <span className="es-icon" aria-hidden="true">
            ⚠
          </span>
          <h3>{labels.stoppedTitle}</h3>
          <p>{labels.stopCodes[result.stop_code ?? ''] ?? result.stop_code}</p>
          <button type="button" className="calc-btn calc-btn-ghost" onClick={() => setPhase('form')}>
            {labels.recalculate}
          </button>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="calc-result calc-print-area">
          <h2>{labels.resultTitle}</h2>
          <dl className="calc-result-list">
            <div>
              <dt>{labels.netEstateLabel}</dt>
              <dd>{formatAmount(Number(result.net_estate ?? 0), locale)}</dd>
            </div>
            <div>
              <dt>{labels.willAppliedLabel}</dt>
              <dd>{formatAmount(Number(result.will_applied ?? 0), locale)}</dd>
            </div>
          </dl>
          {result.awl && <span className="calc-badge calc-badge-stale">{labels.awlBadge}</span>}
          {result.radd && <span className="calc-badge calc-badge-fresh">{labels.raddBadge}</span>}
          <div className="calc-table-scroll">
            <table className="calc-table">
              <thead>
                <tr>
                  <th scope="col">{labels.shareLabel}</th>
                  <th scope="col">{labels.countLabel}</th>
                  <th scope="col">{labels.amountLabel}</th>
                  <th scope="col">{labels.perPersonLabel}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={`${row.key}-${row.count}`}>
                    <td>
                      {heirName(row.key)} ({formatFraction(row.share, locale)})
                    </td>
                    <td>{formatAmount(row.count, locale)}</td>
                    <td>{formatAmount(Number(row.amount), locale)}</td>
                    <td>{formatAmount(Number(row.per_person_amount), locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.blocked.length > 0 && (
            <div>
              <h3>{labels.blockedTitle}</h3>
              <ul>
                {result.blocked.map((key) => (
                  <li key={key}>{heirName(key)}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="calc-rule-version">
            {labels.ruleVersion.replace('{version}', result.applied_rule_version)}
          </p>
          <button type="button" className="calc-btn calc-btn-ghost" onClick={() => setPhase('form')}>
            {labels.recalculate}
          </button>
        </div>
      )}
    </div>
  );
}
