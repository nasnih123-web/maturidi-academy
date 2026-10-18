import { API_BASE_URL } from './api';
import { safeHref } from './section-data';
import type { Locale } from './types';

export type { Locale };

/**
 * Server-side platform_settings client (RSC only — never imported from
 * client components). Per ADR-0002 all settings access goes through this
 * layer; components receive plain typed values via props.
 *
 * Revalidation contract (polish milestone, issue #3):
 * - Settings are fetched **per request** (`cache: 'no-store'`) — no Next.js
 *   fetch cache, no stale reads. A CRM change is visible on the very next
 *   website request.
 * - The response carries `version` / `updated_at` (Track A backend); the web
 *   keeps them on the parsed config for observability. Because nothing is
 *   cached, no conditional revalidation logic is needed — every request
 *   trivially sees the latest version.
 * - Non-throwing: any failure (endpoint missing, network error, bad shape)
 *   yields the typed defaults, i.e. today's behavior. Production never
 *   renders fixture data and never crashes on settings.
 *
 * Canonical endpoint (Track A): GET /api/v1/settings/public
 * See docs/settings-schema.md for the wire contract.
 */

export const PUBLIC_SETTINGS_PATH = '/api/v1/settings/public';

/* ------------------------------------------------------------------ */
/* Typed config                                                        */
/* ------------------------------------------------------------------ */

export interface ParticlesSettings {
  enabled: boolean;
  count: number;
  speed: number;
  /** Pointer-repulsion strength multiplier (0 = off, 1 = default radius). */
  parallax: number;
  lines: boolean;
}

export interface UploadedFont {
  family: string;
  url: string;
}

export interface HeroCtaSetting {
  label: string;
  href: string;
}

export interface HeroSettings {
  title: string | null;
  subtitle: string | null;
  primaryCta: HeroCtaSetting | null;
  secondaryCta: HeroCtaSetting | null;
}

export interface HomeSlotSetting {
  /** Home-section key, e.g. "latest_fatwas". */
  id: string;
  /** Registry variant id (components/sections/registry.ts), or null = default. */
  variant: string | null;
  enabled: boolean;
}

export interface SiteConfig {
  version: number;
  updatedAt: string | null;
  particles: ParticlesSettings;
  fonts: Record<Locale, UploadedFont | null>;
  hero: Record<Locale, HeroSettings | null>;
  /**
   * Ordered homepage slots. `null` = the `home.sections` key is missing or
   * empty → the homepage keeps today's behavior (API order + SPECS).
   */
  homeSections: HomeSlotSetting[] | null;
}

export const DEFAULT_PARTICLES: ParticlesSettings = {
  enabled: true,
  count: 100,
  speed: 1,
  parallax: 1,
  lines: true,
};

export function defaultSiteConfig(): SiteConfig {
  return {
    version: 0,
    updatedAt: null,
    particles: { ...DEFAULT_PARTICLES },
    fonts: { fa: null, ar: null, en: null },
    hero: { fa: null, ar: null, en: null },
    homeSections: null,
  };
}

/* ------------------------------------------------------------------ */
/* Parsing (defensive — the backend owns the shapes, we never crash)    */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Setting values may arrive parsed or as JSON strings (DB stores text). */
function asObject(v: unknown): Record<string, unknown> | null {
  if (isRecord(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed: unknown = JSON.parse(v);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function parseParticles(v: unknown): ParticlesSettings {
  const o = asObject(v);
  if (!o) return { ...DEFAULT_PARTICLES };
  // parallax: number multiplier per the backend contract (Track A seed uses
  // 1.0); booleans are accepted defensively (true → 1, false → 0).
  const parallaxRaw = o.parallax;
  const parallax =
    typeof parallaxRaw === 'boolean' ? (parallaxRaw ? 1 : 0) : num(parallaxRaw, 1, 0, 5);
  return {
    enabled: bool(o.enabled, true),
    count: Math.round(num(o.count, 100, 0, 400)),
    speed: num(o.speed, 1, 0.1, 3),
    parallax,
    lines: bool(o.lines, true),
  };
}

/** Font family names: letters/numbers/spaces/hyphens only (CSS injection guard). */
const FAMILY_RE = /^[\p{L}\p{N} _-]{1,80}$/u;

function parseFont(v: unknown): UploadedFont | null {
  const o = asObject(v);
  if (!o) return null;
  const family = typeof o.family === 'string' && FAMILY_RE.test(o.family.trim()) ? o.family.trim() : null;
  const url = safeHref(o.url);
  if (!family || !url) return null;
  return { family, url };
}

function parseCta(v: unknown): HeroCtaSetting | null {
  const o = asObject(v);
  if (!o) return null;
  const label = cleanText(o.label, 120);
  const href = safeHref(o.href);
  if (!label || !href) return null;
  return { label, href };
}

function parseHero(v: unknown): HeroSettings | null {
  const o = asObject(v);
  if (!o) return null;
  const title = cleanText(o.title, 200);
  const subtitle = cleanText(o.subtitle, 500);
  const primaryCta = parseCta(o.primary_cta);
  const secondaryCta = parseCta(o.secondary_cta);
  if (!title && !subtitle && !primaryCta && !secondaryCta) return null;
  return { title, subtitle, primaryCta, secondaryCta };
}

function parseHomeSections(v: unknown): HomeSlotSetting[] | null {
  const arr = asArray(v);
  if (arr.length === 0) return null;
  const out: HomeSlotSetting[] = [];
  for (const raw of arr) {
    const o = asObject(raw);
    if (!o) continue;
    const id = cleanText(o.id, 64);
    if (!id) continue;
    const variant = typeof o.variant === 'string' && o.variant.trim() ? o.variant.trim().slice(0, 64) : null;
    out.push({ id, variant, enabled: o.enabled !== false });
  }
  return out.length > 0 ? out : null;
}

/**
 * Normalize the settings payload. Accepts the documented envelope
 * `{ settings: {<key>: <value>, …}, version, updated_at }`, a legacy
 * `settings: [{key, value}]` list, or the keys flat at the top level.
 */
export function parseSiteConfig(body: unknown): SiteConfig {
  const cfg = defaultSiteConfig();
  const root = asObject(body);
  if (!root) return cfg;

  let settings: Record<string, unknown> | null = null;
  if (isRecord(root.settings)) {
    settings = root.settings;
  } else if (Array.isArray(root.settings)) {
    settings = {};
    for (const item of root.settings) {
      const o = asObject(item);
      if (o && typeof o.key === 'string') settings[o.key] = o.value;
    }
  } else {
    settings = root;
  }

  if (typeof root.version === 'number' && Number.isFinite(root.version)) cfg.version = root.version;
  if (typeof root.updated_at === 'string' && root.updated_at) cfg.updatedAt = root.updated_at;

  const get = (key: string): unknown => settings?.[key] ?? null;

  cfg.particles = parseParticles(get('particles'));

  const locales: Locale[] = ['fa', 'ar', 'en'];
  for (const l of locales) {
    cfg.fonts[l] = parseFont(get(`fonts.${l}`));
    cfg.hero[l] = parseHero(get(`hero.${l}`));
  }
  cfg.homeSections = parseHomeSections(get('home.sections'));

  return cfg;
}

/* ------------------------------------------------------------------ */
/* Fetch                                                              */
/* ------------------------------------------------------------------ */

function settingsUrl(): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}${PUBLIC_SETTINGS_PATH}`;
}

/**
 * Fetch + parse the public settings. Per-request (`cache: 'no-store'`),
 * non-throwing — falls back to the typed defaults when the endpoint is
 * missing or fails, so the site keeps today's behavior.
 */
export async function getSiteConfig(): Promise<SiteConfig> {
  let body: unknown = null;
  try {
    const res = await fetch(settingsUrl(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) body = (await res.json()) as unknown;
  } catch {
    body = null;
  }
  return parseSiteConfig(body);
}

/* ------------------------------------------------------------------ */
/* Uploaded-font CSS (pure)                                            */
/* ------------------------------------------------------------------ */

const FONT_FALLBACKS: Record<Locale, string> = {
  fa: '"Vazirmatn", "Segoe UI", Tahoma, sans-serif',
  ar: '"Cairo", "Vazirmatn", "Segoe UI", Tahoma, sans-serif',
  en: '"Inter", "Segoe UI", system-ui, sans-serif',
};

/**
 * Build the <style> text that installs an uploaded font for one locale:
 * @font-face (font-display: swap) + --font-main override. The uploaded
 * family is used INSTEAD of the built-in per-locale font; the built-in
 * stack stays as the fallback.
 */
export function uploadedFontCss(locale: Locale, font: UploadedFont): string {
  const fam = font.family.replace(/"/g, '');
  return (
    `@font-face{font-family:"${fam}";src:url("${font.url}") format("woff2");` +
    `font-weight:400 700;font-style:normal;font-display:swap}` +
    `:root[data-locale="${locale}"]{--font-main:"${fam}",${FONT_FALLBACKS[locale]}}`
  );
}
