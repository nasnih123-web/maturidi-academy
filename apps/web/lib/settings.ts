import { getApiBaseUrl } from './api';
import { safeHref } from './section-data';
import type { Locale } from './types';
import {
  DEFAULT_PLACE_TYPES,
  parsePlaceTypes,
  type PlaceTypeDef,
} from './places-view';
import { isGlobeMode, type GlobeMode } from './places-globe';

export type { Locale, PlaceTypeDef };

/**
 * Server-side platform_settings client (RSC only — never imported from
 * client components). Per ADR-0002 all settings access goes through this
 * layer; components receive plain typed values via props.
 *
 * Revalidation contract (polish milestone, issue #3; homepage-static-cache):
 * - Settings are fetched with `next: { revalidate: 120 }` — a CRM change
 *   is visible on the website within ~2 minutes. The previous per-request
 *   (`cache: 'no-store'`) fetch forced every [locale] route (layout +
 *   homepage) into dynamic rendering: chunked HTML with `no-cache` and
 *   no Content-Length. The cached fetch lets the homepage render as a
 *   prerendered file with Content-Length.
 * - The response carries `version` / `updated_at` (Track A backend); the web
 *   keeps them on the parsed config for observability.
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

/* ------------------------------------------------------------------ */
/* Phase 5 settings: quran / munajat / adhan                            */
/* ------------------------------------------------------------------ */

/** Public settings contract for the Phase-5 Quran module.
 *  Source of truth: apps/api/app/modules/quran/service.py `_DEFAULTS`
 *  (keys `quran.show_translation`, `quran.show_tafsir`,
 *  `quran.highlight_mode`, `quran.translations`, `quran.tafsirs`,
 *  `quran.reciters`). The providers endpoint mirrors the same values;
 *  the page prefers the providers config and falls back to these. */
export interface QuranSettings {
  defaultTranslation: string | null;
  defaultTafsir: string | null;
  defaultReciter: string | null;
  showTranslation: boolean;
  showTafsir: boolean;
  /** "word" | "ayah" — highlight granularity hint for the audio player. */
  highlightMode: 'word' | 'ayah';
}

/** Public settings contract for the night-munajat calm theme.
 *  Backend keys: `munajat.enabled` (bool), `munajat.window` {start,end}
 *  as "HH:MM" local-time strings (default 02:00–05:00). */
export interface MunajatSettings {
  enabled: boolean;
  /** Local hour (0-23) when the calm theme starts; default 2. */
  startHour: number;
  /** Local hour (0-23) when the calm theme ends; default 5. */
  endHour: number;
  /** Optional ambient audio URL (safe href, same-origin or https). */
  ambientAudioUrl: string | null;
}

/** Public settings contract for the adhan widget.
 *  method ∈ {council,tehran,isna,mwl,egypt,karachi,makkah,qom,jafari};
 *  madhab ∈ {shafi,hanafi} (backend enum — invalid values fall back to the
 *  defaults). The CRM writes the `adhan.defaults` dict
 *  {calculation_method, madhab}; the flat adhan.method / adhan.madhab keys
 *  are the legacy shape and still win when the dict is absent.
 *  There is NO default city anymore: `default_city` in old stored dicts is
 *  ignored (legacy tolerance, never an error). `defaultLat`/`defaultLng`
 *  are still parsed for tolerance but are NEVER used as fallbacks — with
 *  no saved place, the strip/page auto-locate once per session, else show
 *  the honest needs-location state. */
export interface AdhanSettings {
  /** Calculation method id (backend-defined). */
  method: string;
  /** Madhab for Asr ("shafi" | "hanafi"). */
  madhab: string;
  /** Parsed for legacy tolerance only — never used as a location fallback. */
  defaultLat: number | null;
  /** Parsed for legacy tolerance only — never used as a location fallback. */
  defaultLng: number | null;
}

/** Maps phase: CRM-controlled shape of map popups (`places.popup` setting). */
export interface PlacesPopupSettings {
  showImage: boolean;
  showDescription: boolean;
  showType: boolean;
  showCity: boolean;
}

export const DEFAULT_PLACES_POPUP: PlacesPopupSettings = {
  showImage: true,
  showDescription: true,
  showType: true,
  showCity: true,
};

/** Globe phase: CRM-controlled default globe view (`places.globe` setting). */
export interface PlacesGlobeSettings {
  defaultLat: number;
  defaultLng: number;
  defaultAltitude: number;
  defaultMode: GlobeMode;
  autoRotate: boolean;
}

export const DEFAULT_PLACES_GLOBE: PlacesGlobeSettings = {
  defaultLat: 21.4225,
  defaultLng: 39.8262,
  defaultAltitude: 2.5,
  defaultMode: 'satellite',
  autoRotate: false,
};

export interface SiteConfig {
  version: number;
  updatedAt: string | null;
  particles: ParticlesSettings;
  fonts: Record<Locale, UploadedFont | null>;
  hero: Record<Locale, HeroSettings | null>;
  /** Maps phase — defaults to all fields shown when the key is absent. */
  placesPopup: PlacesPopupSettings;
  /** Globe phase — CRM-extensible place types (`places.types` setting). */
  placeTypes: PlaceTypeDef[];
  /** Globe phase — default globe view (`places.globe` setting). */
  globe: PlacesGlobeSettings;
  /**
   * Ordered homepage slots. `null` = the `home.sections` key is missing or
   * empty → the homepage keeps today's behavior (API order + SPECS).
   */
  homeSections: HomeSlotSetting[] | null;
  /** Phase 5 additions — all optional, typed defaults when missing. */
  quran: QuranSettings;
  munajat: MunajatSettings;
  adhan: AdhanSettings;
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
    placesPopup: { ...DEFAULT_PLACES_POPUP },
    placeTypes: [...DEFAULT_PLACE_TYPES],
    globe: { ...DEFAULT_PLACES_GLOBE },
    homeSections: null,
    quran: { ...DEFAULT_QURAN },
    munajat: { ...DEFAULT_MUNAJAT },
    adhan: { ...DEFAULT_ADHAN },
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

/* ------------------------------------------------------------------ */
/* Phase 5 settings parsing (quran / munajat / adhan)                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_QURAN: QuranSettings = {
  defaultTranslation: null,
  defaultTafsir: null,
  defaultReciter: null,
  showTranslation: true,
  showTafsir: false,
  highlightMode: 'ayah',
};

export const DEFAULT_MUNAJAT: MunajatSettings = {
  enabled: true,
  startHour: 2,
  endHour: 5,
  ambientAudioUrl: null,
};

const ADHAN_METHODS = ['council', 'tehran', 'isna', 'mwl', 'egypt', 'karachi', 'makkah', 'qom', 'jafari'];
const ADHAN_MADHABS = ['shafi', 'hanafi'];

export const DEFAULT_ADHAN: AdhanSettings = {
  method: 'council',
  madhab: 'hanafi',
  defaultLat: null,
  defaultLng: null,
};

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) {
    if (typeof v === 'string' && v.trim()) {
      try {
        const p: unknown = JSON.parse(v);
        return Array.isArray(p) ? strList(p) : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parseQuranSettings(get: (key: string) => unknown): QuranSettings {
  const translations = strList(get('quran.translations'));
  const tafsirs = strList(get('quran.tafsirs'));
  const reciters = strList(get('quran.reciters'));
  const mode = get('quran.highlight_mode') === 'word' ? 'word' : 'ayah';
  return {
    defaultTranslation: translations[0] ?? null,
    defaultTafsir: tafsirs[0] ?? null,
    defaultReciter: reciters[0] ?? null,
    showTranslation: bool(get('quran.show_translation'), true),
    showTafsir: bool(get('quran.show_tafsir'), false),
    highlightMode: mode,
  };
}

function parseHour(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(Math.min(23, Math.max(0, v)));
  if (typeof v === 'string') {
    const m = /^(\d{1,2})(?::(\d{2}))?/.exec(v.trim());
    if (m) {
      const h = Number(m[1]);
      if (h >= 0 && h <= 23) return h;
    }
  }
  return fallback;
}

function parseMunajatSettings(get: (key: string) => unknown): MunajatSettings {
  const window = asObject(get('munajat.window'));
  return {
    enabled: bool(get('munajat.enabled'), true),
    startHour: parseHour(window?.start, 2),
    endHour: parseHour(window?.end, 5),
    ambientAudioUrl: safeHref(get('munajat.ambient_audio_url')),
  };
}

function parseAdhanSettings(get: (key: string) => unknown): AdhanSettings {
  const defaultsObj = asObject(get('adhan.defaults'));
  const methodRaw =
    typeof defaultsObj?.calculation_method === 'string'
      ? defaultsObj.calculation_method
      : get('adhan.method');
  const madhabRaw =
    typeof defaultsObj?.madhab === 'string' ? defaultsObj.madhab : get('adhan.madhab');
  // LEGACY TOLERANCE: an old `adhan.defaults` dict may still carry
  // `default_city` — it is simply ignored here (never an error).
  const method =
    typeof methodRaw === 'string' && ADHAN_METHODS.includes(methodRaw.toLowerCase())
      ? methodRaw.toLowerCase()
      : DEFAULT_ADHAN.method;
  const madhab =
    typeof madhabRaw === 'string' && ADHAN_MADHABS.includes(madhabRaw.toLowerCase())
      ? madhabRaw.toLowerCase()
      : DEFAULT_ADHAN.madhab;
  const lat = typeof get('adhan.default_lat') === 'number' ? (get('adhan.default_lat') as number) : null;
  const lng = typeof get('adhan.default_lng') === 'number' ? (get('adhan.default_lng') as number) : null;
  return {
    method,
    madhab,
    defaultLat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    defaultLng: lng !== null && lng >= -180 && lng <= 180 ? lng : null,
  };
}

function parsePlacesPopup(v: unknown): PlacesPopupSettings {
  const o = asObject(v);
  if (!o) return { ...DEFAULT_PLACES_POPUP };
  return {
    showImage: bool(o.show_image, true),
    showDescription: bool(o.show_description, true),
    showType: bool(o.show_type, true),
    showCity: bool(o.show_city, true),
  };
}

function parsePlacesGlobe(v: unknown): PlacesGlobeSettings {
  const o = asObject(v);
  if (!o) return { ...DEFAULT_PLACES_GLOBE };
  const mode = isGlobeMode(o.defaultMode) ? o.defaultMode : DEFAULT_PLACES_GLOBE.defaultMode;
  return {
    defaultLat: num(o.defaultLat, DEFAULT_PLACES_GLOBE.defaultLat, -90, 90),
    defaultLng: num(o.defaultLng, DEFAULT_PLACES_GLOBE.defaultLng, -180, 180),
    defaultAltitude: num(o.defaultAltitude, DEFAULT_PLACES_GLOBE.defaultAltitude, 0.1, 10),
    defaultMode: mode,
    autoRotate: bool(o.autoRotate, false),
  };
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
  cfg.placesPopup = parsePlacesPopup(get('places.popup'));
  cfg.placeTypes = parsePlaceTypes(get('places.types'));
  cfg.globe = parsePlacesGlobe(get('places.globe'));
  cfg.quran = parseQuranSettings(get);
  cfg.munajat = parseMunajatSettings(get);
  cfg.adhan = parseAdhanSettings(get);

  return cfg;
}

/* ------------------------------------------------------------------ */
/* Fetch                                                              */
/* ------------------------------------------------------------------ */

function settingsUrl(): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${PUBLIC_SETTINGS_PATH}`;
}

/**
 * Fetch + parse the public settings. Cached with `next: { revalidate: 120 }`
 * (see the revalidation contract above), non-throwing — falls back to the
 * typed defaults when the endpoint is missing or fails, so the site keeps
 * today's behavior.
 */
export async function getSiteConfig(): Promise<SiteConfig> {
  let body: unknown = null;
  try {
    const res = await fetch(settingsUrl(), {
      next: { revalidate: 120 },
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
