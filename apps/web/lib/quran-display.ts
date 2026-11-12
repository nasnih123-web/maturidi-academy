/**
 * Reader display preferences (round 4 — Bayan reader parity).
 *
 * Two layers, in this order:
 *  1. CRM defaults (quran.display_font / quran.display_theme /
 *     quran.font_size, via the public-settings whitelist) — the
 *     site-wide defaults the CRM admin sets.
 *  2. Per-device overrides in localStorage (key below) — the reader's
 *     own toolbar writes here, so the toolbar works standalone even
 *     when no CRM value exists, and a reader's choice survives a
 *     reload on their own device without touching any account.
 *
 * Fonts are OFL font-family STACKS only (Amiri, Scheherazade New —
 * both SIL Open Font License; see the CSS classes in globals.css).
 * No font file is bundled and none is fetched from the Bayan APKs
 * (clean-room rule): a name in the stack simply resolves when the
 * reader's device already has the font, and falls back gracefully
 * otherwise. The indopak script switch (Nastaliq) is orthogonal and
 * keeps working: the font choice is a typeface preference applied
 * on top of it.
 */

export type DisplayFontId = 'system' | 'amiri' | 'scheherazade';
export type DisplayThemeId = 'dark' | 'sepia' | 'light' | 'green';

export const DISPLAY_FONTS: DisplayFontId[] = ['system', 'amiri', 'scheherazade'];
export const DISPLAY_THEMES: DisplayThemeId[] = ['dark', 'sepia', 'light', 'green'];

export type DisplayRepeatId = 'off' | 'ayah' | 'surah';

export interface DisplayPrefs {
  font: DisplayFontId;
  /** Ayah-card text size in px (12–72, CRM quran.font_size range). */
  fontSize: number;
  theme: DisplayThemeId;
  /** Continuous scroll while playing (Bayan auto-scroll). */
  autoScroll: boolean;
  /** Auto-scroll speed multiplier (1–3). */
  autoScrollSpeed: number;
  /** Player repeat choice (CRM quran.playback.repeat is the default). */
  repeat: DisplayRepeatId;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  font: 'system',
  fontSize: 20,
  theme: 'dark',
  autoScroll: false,
  autoScrollSpeed: 1,
  repeat: 'off',
};

const STORAGE_KEY = 'quran-display-prefs';

export function parseDisplayFont(v: unknown): DisplayFontId {
  return typeof v === 'string' && (DISPLAY_FONTS as string[]).includes(v)
    ? (v as DisplayFontId)
    : 'system';
}

export function parseDisplayTheme(v: unknown): DisplayThemeId {
  return typeof v === 'string' && (DISPLAY_THEMES as string[]).includes(v)
    ? (v as DisplayThemeId)
    : 'dark';
}

export function parseDisplayFontSize(v: unknown, fallback = 20): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(72, Math.max(12, Math.round(n)));
}

/** CRM defaults merged over the hardcoded defaults (unknown → default). */
export function displayPrefsFromCrm(crm: {
  font?: unknown;
  fontSize?: unknown;
  theme?: unknown;
}): DisplayPrefs {
  return {
    font: parseDisplayFont(crm.font),
    fontSize: parseDisplayFontSize(crm.fontSize, DEFAULT_DISPLAY_PREFS.fontSize),
    theme: parseDisplayTheme(crm.theme),
    autoScroll: DEFAULT_DISPLAY_PREFS.autoScroll,
    autoScrollSpeed: DEFAULT_DISPLAY_PREFS.autoScrollSpeed,
    repeat: DEFAULT_DISPLAY_PREFS.repeat,
  };
}

/** Per-device overrides from localStorage; null when absent/unusable. */
export function loadDisplayPrefs(): Partial<DisplayPrefs> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<DisplayPrefs> = {};
    if (o.font !== undefined) out.font = parseDisplayFont(o.font);
    if (o.fontSize !== undefined) out.fontSize = parseDisplayFontSize(o.fontSize);
    if (o.theme !== undefined) out.theme = parseDisplayTheme(o.theme);
    if (typeof o.autoScroll === 'boolean') out.autoScroll = o.autoScroll;
    if (typeof o.autoScrollSpeed === 'number' && Number.isFinite(o.autoScrollSpeed)) {
      out.autoScrollSpeed = Math.min(3, Math.max(1, Math.round(o.autoScrollSpeed)));
    }
    if (o.repeat === 'ayah' || o.repeat === 'surah' || o.repeat === 'off') {
      out.repeat = o.repeat;
    }
    return out;
  } catch {
    return null;
  }
}

/** Persist per-device overrides (never throws — storage may be blocked). */
export function saveDisplayPrefs(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / blocked storage: toolbar still works this session */
  }
}

/** CSS class for the font choice ('' = site default stack). */
export function displayFontClass(font: DisplayFontId): string {
  return font === 'system' ? '' : `quran-font-${font}`;
}

/** CSS class for the color theme. */
export function displayThemeClass(theme: DisplayThemeId): string {
  return `quran-theme-${theme}`;
}
