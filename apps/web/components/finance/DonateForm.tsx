/**
 * DonateForm — presentational donate form (Phase 15).
 * All state and logic live in useDonate; this component renders and emits
 * events only (ADR-001). Amounts arrive pre-formatted.
 */
import type { DonateFormState, DonatePhase } from '@/lib/hooks/useDonate';

export interface DonateFormLabels {
  amountTitle: string;
  customAmountLabel: string;
  customAmountPlaceholder: string;
  currencySuffix: string;
  donorNameLabel: string;
  donorNameOptional: string;
  donorNamePlaceholder: string;
  minAmountHint: string;
  submit: string;
  submitting: string;
  redirecting: string;
  secureNote: string;
  oneTimeNote: string;
}

export interface DonateFormProps {
  form: DonateFormState;
  phase: DonatePhase;
  error: string | null;
  amountValid: boolean;
  presets: { value: number; label: string }[];
  labels: DonateFormLabels;
  onAmount: (raw: string) => void;
  onPreset: (value: number) => void;
  onDonorName: (name: string) => void;
  onSubmit: () => void;
}

export function DonateForm({
  form,
  phase,
  error,
  amountValid,
  presets,
  labels,
  onAmount,
  onPreset,
  onDonorName,
  onSubmit,
}: DonateFormProps) {
  const busy = phase === 'submitting' || phase === 'redirecting';
  return (
    <form
      className="fin-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <fieldset className="fin-fieldset" disabled={busy}>
        <legend className="fin-legend">{labels.amountTitle}</legend>
        <div className="fin-presets" role="group" aria-label={labels.amountTitle}>
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`fin-preset${form.selectedPreset === p.value ? ' fin-preset-active' : ''}`}
              aria-pressed={form.selectedPreset === p.value}
              onClick={() => onPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="fin-label" htmlFor="fin-amount">
          {labels.customAmountLabel}
        </label>
        <div className="fin-amount-wrap">
          <input
            id="fin-amount"
            className="fin-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            placeholder={labels.customAmountPlaceholder}
            value={form.amount}
            onChange={(e) => onAmount(e.target.value)}
            aria-describedby="fin-min-hint"
          />
          <span className="fin-currency">{labels.currencySuffix}</span>
        </div>
        <p className="fin-hint" id="fin-min-hint">
          {labels.minAmountHint}
        </p>
      </fieldset>

      <div className="fin-field">
        <label className="fin-label" htmlFor="fin-donor">
          {labels.donorNameLabel}{' '}
          <span className="fin-optional">({labels.donorNameOptional})</span>
        </label>
        <input
          id="fin-donor"
          className="fin-input"
          type="text"
          autoComplete="name"
          maxLength={120}
          placeholder={labels.donorNamePlaceholder}
          value={form.donorName}
          onChange={(e) => onDonorName(e.target.value)}
          disabled={busy}
        />
      </div>

      {error ? (
        <p className="fin-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary fin-submit" disabled={busy || !amountValid}>
        {phase === 'submitting'
          ? labels.submitting
          : phase === 'redirecting'
            ? labels.redirecting
            : labels.submit}
      </button>
      <p className="fin-secure">
        {labels.secureNote} · {labels.oneTimeNote}
      </p>
    </form>
  );
}
