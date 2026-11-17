/**
 * Country calling codes for the registration phone field (Phase A).
 * The site is global: the visitor picks a country (flag + dial code)
 * and the national number is length-checked against that country —
 * nothing is hard-coded to Iran. Iran is special only server-side:
 * +98 numbers must also verify by SMS (enforced by the API).
 */

export interface CountryDef {
  iso: string;
  dial: string;
  /** Expected length range of the national (significant) number. */
  min: number;
  max: number;
}

export const COUNTRIES: CountryDef[] = [
  { iso: 'IR', dial: '98', min: 10, max: 10 },
  { iso: 'AF', dial: '93', min: 9, max: 9 },
  { iso: 'IQ', dial: '964', min: 10, max: 10 },
  { iso: 'TR', dial: '90', min: 10, max: 10 },
  { iso: 'AE', dial: '971', min: 9, max: 9 },
  { iso: 'SA', dial: '966', min: 9, max: 9 },
  { iso: 'QA', dial: '974', min: 8, max: 8 },
  { iso: 'KW', dial: '965', min: 8, max: 8 },
  { iso: 'OM', dial: '968', min: 8, max: 8 },
  { iso: 'BH', dial: '973', min: 8, max: 8 },
  { iso: 'PK', dial: '92', min: 10, max: 10 },
  { iso: 'IN', dial: '91', min: 10, max: 10 },
  { iso: 'BD', dial: '880', min: 10, max: 10 },
  { iso: 'TJ', dial: '992', min: 9, max: 9 },
  { iso: 'UZ', dial: '998', min: 9, max: 9 },
  { iso: 'TM', dial: '993', min: 8, max: 8 },
  { iso: 'AZ', dial: '994', min: 9, max: 9 },
  { iso: 'ID', dial: '62', min: 9, max: 12 },
  { iso: 'MY', dial: '60', min: 9, max: 10 },
  { iso: 'EG', dial: '20', min: 10, max: 10 },
  { iso: 'SY', dial: '963', min: 9, max: 9 },
  { iso: 'LB', dial: '961', min: 7, max: 8 },
  { iso: 'JO', dial: '962', min: 9, max: 9 },
  { iso: 'YE', dial: '967', min: 9, max: 9 },
  { iso: 'MA', dial: '212', min: 9, max: 9 },
  { iso: 'DZ', dial: '213', min: 9, max: 9 },
  { iso: 'TN', dial: '216', min: 8, max: 8 },
  { iso: 'NG', dial: '234', min: 10, max: 10 },
  { iso: 'GB', dial: '44', min: 10, max: 10 },
  { iso: 'DE', dial: '49', min: 10, max: 11 },
  { iso: 'FR', dial: '33', min: 9, max: 9 },
  { iso: 'NL', dial: '31', min: 9, max: 9 },
  { iso: 'SE', dial: '46', min: 9, max: 9 },
  { iso: 'RU', dial: '7', min: 10, max: 10 },
  { iso: 'CN', dial: '86', min: 11, max: 11 },
  { iso: 'AU', dial: '61', min: 9, max: 9 },
  { iso: 'CA', dial: '1', min: 10, max: 10 },
  { iso: 'US', dial: '1', min: 10, max: 10 },
];

export function flagEmoji(iso: string): string {
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian/Arabic digits → Latin; everything non-digit dropped. */
export function toLatinDigits(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const fi = FA_DIGITS.indexOf(ch);
    if (fi >= 0) {
      out += String(fi);
      continue;
    }
    const ai = AR_DIGITS.indexOf(ch);
    if (ai >= 0) {
      out += String(ai);
      continue;
    }
    if (ch >= '0' && ch <= '9') out += ch;
  }
  return out;
}

/** National number as typed → significant digits (leading zeros stripped). */
export function normalizeNational(raw: string): string {
  return toLatinDigits(raw).replace(/^0+/, '');
}

/**
 * Free-typed full number (verify-email page phone step) → E.164.
 * Accepts +98…, 0098…, 09… (Iran trunk), 98…; returns null when unsure.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = toLatinDigits(trimmed);
  if (trimmed.startsWith('+') && digits.length >= 7) return `+${digits}`;
  if (digits.startsWith('00') && digits.length >= 9) return `+${digits.slice(2)}`;
  if (digits.startsWith('0') && digits.length === 11) return `+98${digits.slice(1)}`;
  if (digits.startsWith('98') && digits.length === 12) return `+${digits}`;
  return null;
}
