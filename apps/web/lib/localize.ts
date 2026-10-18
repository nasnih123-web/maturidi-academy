import type { LocalizedText, Locale } from './types';

/**
 * Pick the best available rendering of a LocalizedText for a locale.
 * Pure function (service layer) — components receive plain strings.
 * Fallback chain: requested locale → en → fa → first non-empty value.
 */
export function pickText(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return '';
  const chain: string[] = [locale, 'en', 'fa'];
  for (const lang of chain) {
    const v = text[lang];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  for (const v of Object.values(text)) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

export function isLocale(value: string): value is Locale {
  return value === 'fa' || value === 'ar' || value === 'en';
}
