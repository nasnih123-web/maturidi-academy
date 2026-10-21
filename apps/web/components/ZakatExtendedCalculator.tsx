'use client';

/**
 * ZakatExtendedCalculator — source zakat sections UI (Phase 4).
 *
 * Livestock nisab tables, the staircase gold/silver/money model, oshr
 * and khoms — all computed by the backend from the source-derived
 * rule config. Same scholar-review gate as Phase 7: no approved
 * extended config → honest pending state. Fill only the sections you
 * own; empty sections are not sent.
 */
import { useRef, useState } from 'react';
import {
  calculateZakatExtended,
  formatAmount,
  parseDecimalInput,
  type ZakatDueItem,
  type ZakatExtendedRequest,
  type ZakatExtendedResult,
} from '@/lib/calculators';

export interface ZakatExtendedLabels {
  moneyTitle: string;
  moneyAmountLabel: string;
  coinPriceLabel: string;
  goldLabel: string;
  silverLabel: string;
  gramsHint: string;
  livestockTitle: string;
  sheepLabel: string;
  cowsLabel: string;
  musinnaPriceLabel: string;
  camelsLabel: string;
  horsesLabel: string;
  horsesValueLabel: string;
  oshrTitle: string;
  oshrAmountLabel: string;
  irrigationLabel: string;
  rainFed: string;
  irrigated: string;
  khomsTitle: string;
  khomsAmountLabel: string;
  calculate: string;
  calculating: string;
  invalidInput: string;
  failed: string;
  pendingTitle: string;
  pendingBody: string;
  recalculate: string;
  resultTitle: string;
  nisabMet: string;
  nisabNotMet: string;
  zakatCoinsLabel: string;
  zakatAmountLabel: string;
  zakatGramsLabel: string;
  dueLabel: string;
  dueKinds: Record<string, string>;
  ageYears: string; // "…{age}" template
  fortiethsLabel: string;
  extraMoneyLabel: string;
  horseRuleNote: string;
  horseDinarLabel: string;
  horseValueLabel: string;
  oshrDueLabel: string;
  khomsDueLabel: string;
  ruleVersion: string;
  draftNote: string;
}

type Phase = 'form' | 'calculating' | 'result' | 'pending' | 'error';

interface FormState {
  moneyAmount: string;
  coinPrice: string;
  gold: string;
  silver: string;
  sheep: string;
  cows: string;
  musinnaPrice: string;
  camels: string;
  horses: string;
  horsesValue: string;
  oshrKg: string;
  irrigation: 'rain_fed' | 'irrigated';
  khoms: string;
}

const emptyForm = (): FormState => ({
  moneyAmount: '',
  coinPrice: '',
  gold: '',
  silver: '',
  sheep: '',
  cows: '',
  musinnaPrice: '',
  camels: '',
  horses: '',
  horsesValue: '',
  oshrKg: '',
  irrigation: 'rain_fed',
  khoms: '',
});

export function ZakatExtendedCalculator({
  labels,
  locale,
}: {
  labels: ZakatExtendedLabels;
  locale: string;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ZakatExtendedResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function buildRequest(): ZakatExtendedRequest | null {
    const req: ZakatExtendedRequest = {};
    const num = (raw: string): number | null => {
      if (raw.trim() === '') return null;
      const n = parseDecimalInput(raw);
      return n === null || n < 0 ? -1 : n;
    };
    const count = (raw: string): number | null => {
      const n = num(raw);
      if (n === null) return null;
      return Number.isInteger(n) && n >= 0 ? n : -1;
    };
    const money = num(form.moneyAmount);
    const price = num(form.coinPrice);
    if (money === -1 || price === -1) return null;
    if (money !== null && price !== null && price > 0) {
      req.money = { amount: money, coin_price: price };
    } else if (money !== null || price !== null) {
      return null; // money needs both amount and coin price
    }
    const gold = num(form.gold);
    const silver = num(form.silver);
    if (gold === -1 || silver === -1) return null;
    if (gold !== null) req.gold_grams = gold;
    if (silver !== null) req.silver_grams = silver;
    const sheep = count(form.sheep);
    const cows = count(form.cows);
    const camels = count(form.camels);
    const horses = count(form.horses);
    if (sheep === -1 || cows === -1 || camels === -1 || horses === -1) return null;
    if (sheep !== null) req.sheep = sheep;
    if (cows !== null) {
      const mp = num(form.musinnaPrice);
      if (mp === -1) return null;
      req.cows = mp !== null ? { count: cows, musinna_price: mp } : { count: cows };
    }
    if (camels !== null) req.camels = camels;
    if (horses !== null) {
      const hv = num(form.horsesValue);
      if (hv === -1) return null;
      req.horses = hv !== null ? { count: horses, total_value: hv } : { count: horses };
    }
    const oshrKg = num(form.oshrKg);
    if (oshrKg === -1) return null;
    if (oshrKg !== null) req.oshr = { amount_kg: oshrKg, irrigation: form.irrigation };
    const khoms = num(form.khoms);
    if (khoms === -1) return null;
    if (khoms !== null) req.khoms = { amount: khoms };
    return Object.keys(req).length > 0 ? req : null;
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
      const res = await calculateZakatExtended(req, { signal: ctrl.signal });
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

  const dueList = (items: ZakatDueItem[]) => (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          {labels.dueKinds[item.kind] ?? item.kind}: {formatAmount(item.count, locale)}
          {item.age_years !== undefined &&
            ` (${labels.ageYears.replace('{age}', formatAmount(item.age_years, locale))})`}
        </li>
      ))}
    </ul>
  );

  const s = result?.sections;

  return (
    <div className="calc-root">
      <p className="calc-hint">⚠ {labels.draftNote}</p>
      {phase !== 'result' && (
        <div className="calc-form">
          <fieldset className="calc-fieldset">
            <legend>{labels.moneyTitle}</legend>
            <div className="calc-field">
              <label htmlFor="zx-money">{labels.moneyAmountLabel}</label>
              <input id="zx-money" type="text" inputMode="decimal" value={form.moneyAmount} onChange={set('moneyAmount')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-price">{labels.coinPriceLabel}</label>
              <input id="zx-price" type="text" inputMode="decimal" value={form.coinPrice} onChange={set('coinPrice')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-gold">{labels.goldLabel}</label>
              <input id="zx-gold" type="text" inputMode="decimal" value={form.gold} onChange={set('gold')} disabled={phase === 'calculating'} />
              <p className="calc-hint">{labels.gramsHint}</p>
            </div>
            <div className="calc-field">
              <label htmlFor="zx-silver">{labels.silverLabel}</label>
              <input id="zx-silver" type="text" inputMode="decimal" value={form.silver} onChange={set('silver')} disabled={phase === 'calculating'} />
            </div>
          </fieldset>

          <fieldset className="calc-fieldset">
            <legend>{labels.livestockTitle}</legend>
            <div className="calc-field">
              <label htmlFor="zx-sheep">{labels.sheepLabel}</label>
              <input id="zx-sheep" type="text" inputMode="numeric" value={form.sheep} onChange={set('sheep')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-cows">{labels.cowsLabel}</label>
              <input id="zx-cows" type="text" inputMode="numeric" value={form.cows} onChange={set('cows')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-musinna">{labels.musinnaPriceLabel}</label>
              <input id="zx-musinna" type="text" inputMode="decimal" value={form.musinnaPrice} onChange={set('musinnaPrice')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-camels">{labels.camelsLabel}</label>
              <input id="zx-camels" type="text" inputMode="numeric" value={form.camels} onChange={set('camels')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-horses">{labels.horsesLabel}</label>
              <input id="zx-horses" type="text" inputMode="numeric" value={form.horses} onChange={set('horses')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-horses-value">{labels.horsesValueLabel}</label>
              <input id="zx-horses-value" type="text" inputMode="decimal" value={form.horsesValue} onChange={set('horsesValue')} disabled={phase === 'calculating'} />
            </div>
          </fieldset>

          <fieldset className="calc-fieldset">
            <legend>{labels.oshrTitle}</legend>
            <div className="calc-field">
              <label htmlFor="zx-oshr">{labels.oshrAmountLabel}</label>
              <input id="zx-oshr" type="text" inputMode="decimal" value={form.oshrKg} onChange={set('oshrKg')} disabled={phase === 'calculating'} />
            </div>
            <div className="calc-field">
              <label htmlFor="zx-irr">{labels.irrigationLabel}</label>
              <select id="zx-irr" value={form.irrigation} onChange={set('irrigation')} disabled={phase === 'calculating'}>
                <option value="rain_fed">{labels.rainFed}</option>
                <option value="irrigated">{labels.irrigated}</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="calc-fieldset">
            <legend>{labels.khomsTitle}</legend>
            <div className="calc-field">
              <label htmlFor="zx-khoms">{labels.khomsAmountLabel}</label>
              <input id="zx-khoms" type="text" inputMode="decimal" value={form.khoms} onChange={set('khoms')} disabled={phase === 'calculating'} />
            </div>
          </fieldset>

          {(error || phase === 'error') && (
            <p className="calc-error" role="alert">
              {error || labels.failed}
            </p>
          )}
          <button type="button" className="calc-btn calc-btn-primary" onClick={onCalculate} disabled={phase === 'calculating'}>
            {phase === 'calculating' ? labels.calculating : labels.calculate}
          </button>
        </div>
      )}

      {phase === 'result' && s && (
        <div className="calc-result calc-print-area">
          <h2>{labels.resultTitle}</h2>
          {s.money && (
            <div>
              <h3>{labels.moneyTitle}</h3>
              <p>{s.money.nisab_met ? labels.nisabMet : labels.nisabNotMet}</p>
              {s.money.nisab_met && (
                <dl className="calc-result-list">
                  <div>
                    <dt>{labels.zakatCoinsLabel}</dt>
                    <dd>{s.money.zakat_coins}</dd>
                  </div>
                  <div>
                    <dt>{labels.zakatAmountLabel}</dt>
                    <dd>{formatAmount(Number(s.money.zakat_amount), locale)}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
          {s.gold && (
            <p>
              {labels.goldLabel}: {s.gold.nisab_met ? `${labels.zakatGramsLabel} ${s.gold.zakat_grams}` : labels.nisabNotMet}
            </p>
          )}
          {s.silver && (
            <p>
              {labels.silverLabel}: {s.silver.nisab_met ? `${labels.zakatGramsLabel} ${s.silver.zakat_grams}` : labels.nisabNotMet}
            </p>
          )}
          {s.sheep && (
            <div>
              <h3>{labels.sheepLabel}</h3>
              {s.sheep.due.length > 0 ? dueList(s.sheep.due) : <p>{labels.nisabNotMet}</p>}
            </div>
          )}
          {s.cows && (
            <div>
              <h3>{labels.cowsLabel}</h3>
              {s.cows.due.length > 0 ? dueList(s.cows.due) : <p>{labels.nisabNotMet}</p>}
              {s.cows.musinna_fortieths > 0 && (
                <p>
                  {labels.fortiethsLabel}: {formatAmount(s.cows.musinna_fortieths, locale)}
                  {s.cows.extra_money &&
                    ` — ${labels.extraMoneyLabel}: ${formatAmount(Number(s.cows.extra_money), locale)}`}
                </p>
              )}
            </div>
          )}
          {s.camels && (
            <div>
              <h3>{labels.camelsLabel}</h3>
              {s.camels.due.length > 0 ? dueList(s.camels.due) : <p>{labels.nisabNotMet}</p>}
            </div>
          )}
          {s.horses && (
            <div>
              <h3>{labels.horsesLabel}</h3>
              <p>{labels.horseRuleNote}</p>
              <p>
                {labels.horseDinarLabel}: {formatAmount(s.horses.total_dinar, locale)}
                {s.horses.value_zakat &&
                  ` — ${labels.horseValueLabel}: ${formatAmount(Number(s.horses.value_zakat), locale)}`}
              </p>
            </div>
          )}
          {s.oshr && (
            <p>
              {labels.oshrDueLabel}: {s.oshr.oshr_kg}
            </p>
          )}
          {s.khoms && (
            <p>
              {labels.khomsDueLabel}: {formatAmount(Number(s.khoms.khoms), locale)}
            </p>
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
