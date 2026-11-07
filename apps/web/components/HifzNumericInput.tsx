'use client';

/**
 * HifzNumericInput — Eastern-Arabic numeric input (hifz completion,
 * section 4, item 11).
 *
 * The native `type="number"` input always shows Latin digits and
 * rejects Persian/Arabic-Indic typing. This is `type="text"` +
 * `inputMode="numeric"` (the mobile numeric keyboard is kept) with
 * digit conversion in lib/hifz-phase4.ts: the user types Persian
 * (۱۲۳), Arabic-Indic (١٢٣) or Latin (123) digits and always sees
 * Eastern Arabic (١٢٣); the parent receives a Latin number (or
 * null for an empty field) and the API contract is unchanged.
 *
 * Clamping: the component does NOT invent a range — it only clamps
 * when the caller passes `min`/`max` (the caller's own rule, e.g.
 * repeat 1–20, question count 1–99, ayah ≤ surah ayah count).
 * Without min/max the value passes through unclamped and the
 * caller's own validation (e.g. validatePracticeRange with its
 * role="alert" error) still applies. No `dir="ltr"` is set: Eastern
 * Arabic digits have the correct direction inside the RTL page.
 * No native spinner: `type="text"` has none (accepted — on mobile
 * the spinner is useless; on desktop direct typing replaces it).
 */
import { parseNumericInput, toEasternArabicDigitsText } from '@/lib/hifz-phase4';

export interface HifzNumericInputProps {
  /** Current value; null renders an empty field. */
  value: number | null;
  /** Parsed Latin number, or null when the field is empty. */
  onChange: (value: number | null) => void;
  /** Accessible label (the surrounding <label> text). */
  ariaLabel: string;
  /** Optional clamp bounds (the caller's own rule). */
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

export function HifzNumericInput({
  value,
  onChange,
  ariaLabel,
  min,
  max,
  placeholder,
  disabled,
  id,
}: HifzNumericInputProps) {
  const display = value === null ? '' : toEasternArabicDigitsText(String(value));
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      pattern="[0-9۰-۹٠-٩]*"
      id={id}
      value={display}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => {
        const parsed = parseNumericInput(e.target.value);
        if (parsed === null) {
          onChange(null);
          return;
        }
        let v = parsed;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        onChange(v);
      }}
    />
  );
}
