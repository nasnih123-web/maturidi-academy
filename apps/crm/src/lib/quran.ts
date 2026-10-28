import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api";
import { readSettingsMap } from "./appearance";

/**
 * Quran service — Phase 5 (Track 3, CRM).
 *
 * Presentation configuration backed by platform_settings (ADR-001: all
 * parsing / defaults / API access live here, never in components).
 *
 * Canonical keys — aligned with the Track 1 backend (`SETTING_DEFS`,
 * `apps/api/app/core/platform_settings.py`, ADR-0004):
 *   quran.provider           string   — active text provider id (validated
 *                                       server-side against registered providers)
 *   quran.translations       string[] — active translation edition ids;
 *                                       array order = display order
 *   quran.tafsirs            string[] — active tafsir edition ids (same shape)
 *   quran.reciters           string[] — active reciter edition ids (same shape)
 *   quran.active_languages   string[] — ⊆ {fa,ar,en}, non-empty
 *   quran.show_translation   bool
 *   quran.show_tafsir        bool
 *   quran.highlight_mode     "word" | "ayah" | "off"
 *   quran.font_size          number 12..72
 *   quran.playback           {autoplay: bool, repeat: "off"|"ayah"|"surah"}
 *   munajat.enabled          bool
 *   munajat.window           {start: "HH:MM", end: "HH:MM"}
 *   adhan.defaults           {calculation_method, madhab} — registered
 *                            in SETTING_DEFS (platform_settings.py).
 *                            Legacy stored dicts may still carry
 *                            `default_city`; it is ignored, never an error.
 *
 * Provider catalogs come ONLY from GET /api/v1/quran/providers:
 *   {providers: [{id, name, base_url, active}], active_provider, text_edition,
 *    translations, tafsirs, reciters, active_languages, show_translation,
 *    show_tafsir, highlight_mode, font_size, playback}
 * No catalog is hardcoded in the UI (except the AdhanMethod enum ids, which
 * are the API's own enum values — see ADHAN_METHODS).
 *
 * Quran text integrity: the canonical text is NEVER editable from the CRM.
 * This service carries no write path for ayah text — configuration only.
 */

/* ------------------------------------------------------------------ */
/* settings transport (shared cache with the other settings pages)     */
/* ------------------------------------------------------------------ */

export const QURAN_SETTINGS_KEYS = {
  provider: "quran.provider",
  translations: "quran.translations",
  tafsirs: "quran.tafsirs",
  reciters: "quran.reciters",
  activeLanguages: "quran.active_languages",
  showTranslation: "quran.show_translation",
  showTafsir: "quran.show_tafsir",
  highlightMode: "quran.highlight_mode",
  fontSize: "quran.font_size",
  playback: "quran.playback",
  munajatEnabled: "munajat.enabled",
  munajatWindow: "munajat.window",
  adhanDefaults: "adhan.defaults",
} as const;

/** Shared `["platform-settings"]` cache — one fetch for every settings page. */
export function useQuranSettingsQuery() {
  return useQuery({
    queryKey: ["platform-settings"],
    queryFn: readSettingsMap,
    retry: false,
    staleTime: 60_000,
  });
}

/** Write one or more json-typed keys as parsed JSON values (dict/list/bool/str/number).
 *  The backend validators (encode_setting_value) expect parsed values, NOT
 *  JSON-encoded strings. */
export function useWriteQuranKeys() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: Record<string, unknown>) =>
      apiFetch("/api/v1/admin/settings", { method: "PUT", body: { settings: entries } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
    },
  });
}

export function errText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* registered providers (Track 1: GET /api/v1/quran/providers)         */
/* ------------------------------------------------------------------ */

export interface TextProviderInfo {
  id: string;
  name: string;
  base_url: string;
  active: boolean;
}

export type RepeatMode = "off" | "ayah" | "surah";
export type HighlightMode = "word" | "ayah" | "off";

export interface PlaybackConfig {
  autoplay: boolean;
  repeat: RepeatMode;
}

export interface QuranProvidersOut {
  providers: TextProviderInfo[];
  active_provider: string;
  text_edition: string;
  translations: string[];
  tafsirs: string[];
  reciters: string[];
  active_languages: string[];
  show_translation: boolean;
  show_tafsir: boolean;
  highlight_mode: HighlightMode;
  font_size: number;
  playback: PlaybackConfig;
}

export const EMPTY_PROVIDERS_OUT: QuranProvidersOut = {
  providers: [],
  active_provider: "",
  text_edition: "quran-uthmani",
  translations: [],
  tafsirs: [],
  reciters: [],
  active_languages: [],
  show_translation: false,
  show_tafsir: false,
  highlight_mode: "ayah",
  font_size: 20,
  playback: { autoplay: false, repeat: "off" },
};

function parseProviderList(raw: unknown): TextProviderInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: TextProviderInfo[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    out.push({
      id: r.id,
      name: typeof r.name === "string" && r.name ? r.name : r.id,
      base_url: typeof r.base_url === "string" ? r.base_url : "",
      active: r.active === true,
    });
  }
  return out;
}

export function parseQuranProvidersOut(raw: unknown): QuranProvidersOut {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PROVIDERS_OUT };
  const r = raw as Record<string, unknown>;
  return {
    providers: parseProviderList(r.providers),
    active_provider: typeof r.active_provider === "string" ? r.active_provider : "",
    text_edition: typeof r.text_edition === "string" ? r.text_edition : "quran-uthmani",
    translations: parseStringList(r.translations),
    tafsirs: parseStringList(r.tafsirs),
    reciters: parseStringList(r.reciters),
    active_languages: parseStringList(r.active_languages),
    show_translation: r.show_translation === true,
    show_tafsir: r.show_tafsir === true,
    highlight_mode: parseHighlightMode(r.highlight_mode),
    font_size: parseFontSize(typeof r.font_size === "number" ? String(r.font_size) : null),
    playback: parsePlayback(typeof r.playback === "string" ? r.playback : JSON.stringify(r.playback ?? {})),
  };
}

export async function fetchQuranProviders(): Promise<QuranProvidersOut> {
  const raw = await apiFetch<unknown>("/api/v1/quran/providers");
  return parseQuranProvidersOut(raw);
}

export function useQuranProvidersQuery() {
  return useQuery({
    queryKey: ["quran-providers"],
    queryFn: fetchQuranProviders,
    retry: false,
    staleTime: 300_000,
  });
}

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

function decodeJson(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** quran.provider — plain non-empty string. */
export function parseProviderId(raw: string | null | undefined): string {
  const v = decodeJson(raw);
  return typeof v === "string" ? v : "";
}

/** quran.translations / tafsirs / reciters — string arrays (tolerant).
 *  Accepts a JSON-encoded string (from the settings map) or a real array. */
export function parseStringList(raw: unknown): string[] {
  const v = typeof raw === "string" ? decodeJson(raw) : raw;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    if (typeof it === "string" && it.trim() && !out.includes(it.trim())) out.push(it.trim());
  }
  return out;
}

export function moveString(items: string[], index: number, dir: -1 | 1): string[] {
  const j = index + dir;
  if (index < 0 || index >= items.length || j < 0 || j >= items.length) return items;
  const next = items.slice();
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

const VALID_LOCALES = ["fa", "ar", "en"];

/** quran.active_languages — ⊆ {fa,ar,en}, never empty (server rejects empty). */
export function parseActiveLanguages(raw: string | null | undefined): string[] {
  const langs = parseStringList(raw).filter((l) => VALID_LOCALES.includes(l));
  return langs.length > 0 ? langs : ["fa"];
}

/** quran.show_translation / show_tafsir / munajat.enabled — booleans. */
export function parseFlag(raw: string | null | undefined, fallback = false): boolean {
  const v = decodeJson(raw);
  return typeof v === "boolean" ? v : fallback;
}

export function parseHighlightMode(v: unknown): HighlightMode {
  return v === "word" || v === "ayah" || v === "off" ? v : "ayah";
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** quran.font_size — number, server range 12..72. */
export function parseFontSize(raw: string | null | undefined): number {
  const v = decodeJson(raw);
  if (typeof v !== "number" || Number.isNaN(v)) return 20;
  return clamp(v, 12, 72);
}

export const DEFAULT_PLAYBACK: PlaybackConfig = { autoplay: false, repeat: "off" };

/** quran.playback — {autoplay, repeat: off|ayah|surah}. */
export function parsePlayback(raw: string | null | undefined): PlaybackConfig {
  const v = decodeJson(raw);
  if (!v || typeof v !== "object") return { ...DEFAULT_PLAYBACK };
  const r = v as Record<string, unknown>;
  return {
    autoplay: r.autoplay === true,
    repeat: r.repeat === "ayah" || r.repeat === "surah" ? r.repeat : "off",
  };
}

/* ------------------------------------------------------------------ */
/* munajat                                                             */
/* ------------------------------------------------------------------ */

export interface MunajatWindow {
  start: string; // "HH:MM" 24h
  end: string; // "HH:MM" 24h
}

export const DEFAULT_MUNAJAT_WINDOW: MunajatWindow = { start: "02:00", end: "05:00" };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeString(v: unknown): v is string {
  return typeof v === "string" && TIME_RE.test(v);
}

export function parseMunajatWindow(raw: string | null | undefined): MunajatWindow {
  const v = decodeJson(raw);
  if (!v || typeof v !== "object") return { ...DEFAULT_MUNAJAT_WINDOW };
  const r = v as Record<string, unknown>;
  return {
    start: isTimeString(r.start) ? r.start : DEFAULT_MUNAJAT_WINDOW.start,
    end: isTimeString(r.end) ? r.end : DEFAULT_MUNAJAT_WINDOW.end,
  };
}

/* ------------------------------------------------------------------ */
/* adhan defaults                                                      */
/* ------------------------------------------------------------------ */

/**
 * Adhan calculation-method ids — the API's own enum values
 * (`AdhanMethod` on GET /api/v1/adhan/times, Track 1).
 */
export const ADHAN_METHODS = ["council", "tehran", "isna", "mwl", "egypt", "karachi", "makkah", "qom", "jafari", "france"] as const;
export type AdhanMethod = (typeof ADHAN_METHODS)[number];

/** City slugs for the adhan default city — same list as GET /adhan/options. */
export const ADHAN_CITIES = ["torbat-e-jam", "khaf", "taybad", "mashhad", "zahedan", "gonbad-e-kavus", "tehran"] as const;

export type Madhab = "shafi" | "hanafi";

export interface AdhanDefaults {
  calculation_method: string;
  madhab: Madhab;
}

export const DEFAULT_ADHAN: AdhanDefaults = { calculation_method: "", madhab: "hanafi" };

export function parseAdhanDefaults(raw: string | null | undefined): AdhanDefaults {
  const v = decodeJson(raw);
  if (!v || typeof v !== "object") return { ...DEFAULT_ADHAN };
  const r = v as Record<string, unknown>;
  // LEGACY TOLERANCE: old stored dicts may still carry `default_city` — it is
  // simply ignored here (never an error, never written back).
  return {
    calculation_method: typeof r.calculation_method === "string" ? r.calculation_method : "",
    madhab: r.madhab === "shafi" ? "shafi" : "hanafi",
  };
}
