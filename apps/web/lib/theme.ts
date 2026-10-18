import type { CSSProperties } from 'react';
import type { HomeTheme } from './types';

/**
 * Build CSS custom-property overrides from the API theme contract.
 * palette keys are var suffixes → `--ma-<suffix>`; fonts map to
 * `--ma-font-body` / `--ma-font-heading` (tokens-package var names).
 * Pure function; rendered by the page as an inline <style> targeting <html>.
 */

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
/** Reject values that could break out of a declaration (defense in depth — the API is trusted, but cheap). */
const UNSAFE_VALUE = /[{};<>]/;

export function themeCssText(theme: HomeTheme | null | undefined): string {
  if (!theme) return '';
  const decls: string[] = [];
  const palette = theme.palette ?? {};
  for (const [suffix, value] of Object.entries(palette)) {
    if (!SAFE_KEY.test(suffix)) continue;
    if (typeof value !== 'string' || UNSAFE_VALUE.test(value)) continue;
    decls.push(`--ma-${suffix}:${value}`);
  }
  if (theme.fonts?.body && !UNSAFE_VALUE.test(theme.fonts.body)) {
    decls.push(`--ma-font-body:${theme.fonts.body}`);
  }
  if (theme.fonts?.heading && !UNSAFE_VALUE.test(theme.fonts.heading)) {
    decls.push(`--ma-font-heading:${theme.fonts.heading}`);
  }
  if (decls.length === 0) return '';
  return `html{${decls.join(';')}}`;
}

/** Style-object variant (unused by the page, kept for future non-html targets). */
export function themeStyleObject(theme: HomeTheme | null | undefined): CSSProperties {
  const out: CSSProperties = {};
  if (!theme) return out;
  for (const [suffix, value] of Object.entries(theme.palette ?? {})) {
    if (!SAFE_KEY.test(suffix) || typeof value !== 'string' || UNSAFE_VALUE.test(value)) continue;
    (out as Record<string, string>)[`--ma-${suffix}`] = value;
  }
  return out;
}
