/**
 * Phase 4 (hifz redesign) — pure helpers for the study page:
 * accuracy-pill colour, practice-range validation, repeat counts.
 *
 * Accuracy thresholds come from the Phase 2 video evidence (§5.2):
 * green at 99.2% and 100%, lime at 98–98.6%, amber at 96.5–96.9%,
 * red at 88.3–92.2%. The earlier guess (green >=95 / amber 80–95 /
 * red <80) is REFUTED by the videos (92.2% is red, not amber).
 * Exact cut points between the observed bands are still unknown
 * (§14.5 of the spec), so the thresholds below are the
 * best-evidence midpoints: green >=99, lime >=98, amber >=95,
 * red <95. They are flagged as such in the Phase 4 notes.
 */

export type AccuracyTone = 'green' | 'lime' | 'amber' | 'red';

export function accuracyPillTone(accuracy: number): AccuracyTone {
  if (accuracy >= 99) return 'green';
  if (accuracy >= 98) return 'lime';
  if (accuracy >= 95) return 'amber';
  return 'red';
}

/** CSS class suffix for an accuracy tone (see globals.css). */
export function accuracyPillClass(tone: AccuracyTone): string {
  return `hifz-pill-${tone}`;
}

/**
 * Validate a practice range (start/end ayah within one surah).
 * Returns an error key (for the i18n labels) or null when valid.
 * `endAyah === null` means "to the end of the surah".
 */
export function validatePracticeRange(
  startAyah: number | null,
  endAyah: number | null,
  ayahCount: number,
): 'rangeStart' | 'rangeEnd' | 'rangeOrder' | null {
  if (startAyah !== null && (startAyah < 1 || startAyah > ayahCount)) return 'rangeStart';
  if (endAyah !== null && (endAyah < 1 || endAyah > ayahCount)) return 'rangeEnd';
  if (startAyah !== null && endAyah !== null && startAyah > endAyah) return 'rangeOrder';
  return null;
}

/** Clamp a repeat count to the server's accepted range (1–20). */
export function clampRepeatCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

/* ---------------------------------------------------------------
 * Eastern-Arabic numeric inputs (hifz completion, section 4,
 * item 11). The native `type="number"` input always shows Latin
 * digits and rejects Persian/Arabic-Indic typing, which breaks the
 * Eastern-Arabic digit unity of the rest of the page (row 9 of the
 * parity table). The inputs below are therefore `type="text"` +
 * `inputMode="numeric"` (mobile numeric keyboard kept) with the
 * conversion done here: the displayed value is Eastern Arabic, the
 * internal value stays a Latin number, and the API contract is
 * unchanged. Validation rules are NOT changed by this: callers keep
 * their own clamps (validatePracticeRange / clampRepeatCount /
 * per-surah max) — these helpers only convert digits.
 * --------------------------------------------------------------- */

/** Ayah count per surah (1..114), derived from the V2 layout
    segments (apps/web/public/quran-mushaf-v2.json); total 6236.
    Spot-checked: 1:7, 2:286, 5:120, 9:129, 114:6. */
export const SURAH_AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112,
  78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37,
  35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8,
  19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];

/** Ayah count of one surah, or null for an out-of-range surah. */
export function surahAyahCount(surah: number): number | null {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  return SURAH_AYAH_COUNTS[surah - 1];
}

/** Latin digits (0–9) → Eastern Arabic digits (٠–٩); other chars kept. */
export function toEasternArabicDigitsText(text: string): string {
  return [...text]
    .map((d) => {
      const code = d.charCodeAt(0);
      if (code >= 0x30 && code <= 0x39) return String.fromCharCode(0x0660 + (code - 0x30));
      return d;
    })
    .join('');
}

/**
 * Normalize raw input to Latin digits: Persian (۰–۹) and
 * Arabic-Indic (٠–٩) digits convert; Persian/Arabic thousands and
 * decimal separators (٬ ٫ ، ,) and spaces are dropped (integer
 * inputs have no decimals); anything else non-digit is dropped.
 * '' stays '' (empty input), so callers can tell "cleared" apart
 * from "0".
 */
export function normalizeNumericInput(raw: string): string {
  return [...raw]
    .map((d) => {
      const code = d.charCodeAt(0);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x30 && code <= 0x39) return d;
      return '';
    })
    .join('');
}

/**
 * Parse a numeric input: Persian/Arabic/Latin digits accepted.
 * Null when the field is empty or holds no digits at all.
 */
export function parseNumericInput(raw: string): number | null {
  const digits = normalizeNumericInput(raw);
  if (digits === '') return null;
  return Number(digits);
}

/** Per-user hifz settings (mirrors HifzUserSettings on the API). */
export interface HifzUserSettings {
  freezeOnError: boolean;
  mistakeDetection: boolean;
  tashkeelDetection: boolean;
  resumableSessions: boolean;
  hideAyahMarkers: boolean;
}

/** Defaults = the premium behaviour in the videos (no freeze). */
export const HIFZ_SETTINGS_DEFAULTS: HifzUserSettings = {
  freezeOnError: false,
  mistakeDetection: true,
  tashkeelDetection: true,
  resumableSessions: false,
  hideAyahMarkers: false,
};

export const HIFZ_SETTINGS_STORAGE_KEY = 'maturidi-hifz-settings-v1';

/** Parse stored guest settings (localStorage); corrupt data → defaults. */
export function parseStoredHifzSettings(raw: string | null): HifzUserSettings {
  if (!raw) return { ...HIFZ_SETTINGS_DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...HIFZ_SETTINGS_DEFAULTS };
    const out: HifzUserSettings = { ...HIFZ_SETTINGS_DEFAULTS };
    for (const key of Object.keys(HIFZ_SETTINGS_DEFAULTS) as (keyof HifzUserSettings)[]) {
      if (typeof (parsed as Record<string, unknown>)[key] === 'boolean') {
        out[key] = (parsed as Record<string, boolean>)[key];
      }
    }
    return out;
  } catch {
    return { ...HIFZ_SETTINGS_DEFAULTS };
  }
}
