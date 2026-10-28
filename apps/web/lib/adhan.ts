import { getApiBaseUrl, ApiError } from './api';
import type { AdhanSettings } from './settings';

/**
 * Adhan domain layer (Phase 5 — Track 2/web).
 *
 * Prayer times are computed server-side (pure-Python PrayTimes algorithm in
 * Track 1) — the web NEVER invents times.
 *
 * Wire contract (source of truth: apps/api/app/modules/quran/{router,schemas}.py):
 * - GET /api/v1/adhan/times?lat=<f>&lng=<f>&method=<isna|mwl|egypt|karachi|makkah|jafari>
 *       &madhab=<shafi|hanafi>&day=<YYYY-MM-DD>&tz=<utc-offset-hours>
 *     → { date, latitude, longitude, timezone_offset, method, method_label,
 *         madhab, times: { imsak, fajr, sunrise, dhuhr, asr, maghrib, isha, midnight } }
 *   Times are "HH:MM" in the user's local timezone (tz param).
 */

import { apiBaseUrl } from './api-base';
export interface PrayerTimings {
  imsak: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  midnight: string;
}

export interface AdhanTimes {
  date: string;
  latitude: number;
  longitude: number;
  timezoneOffset: number;
  timings: PrayerTimings;
  method: string;
  methodLabel: string;
  madhab: string;
  city: string | null;
  source: string;
  sources: Record<string, string>;
}

export type PrayerName = keyof PrayerTimings;

/** Canonical display order of the six prayers used for the countdown. */
export const PRAYER_ORDER: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Full grid order including imsak/midnight. */
export const PRAYER_GRID_ORDER: PrayerName[] = [
  'imsak',
  'fajr',
  'sunrise',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
  'midnight',
];

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}`;
}

/** The browser's UTC offset in hours (e.g. +3.5 for Asia/Tehran). Pure. */
export function localTzOffset(date: Date = new Date()): number {
  return -date.getTimezoneOffset() / 60;
}

function parseTimes(body: Record<string, unknown>): AdhanTimes {
  const t = (body?.times ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    date: str(body?.date),
    latitude: num(body?.latitude),
    longitude: num(body?.longitude),
    timezoneOffset: num(body?.timezone_offset),
    timings: {
      imsak: str(t.imsak),
      fajr: str(t.fajr),
      sunrise: str(t.sunrise),
      dhuhr: str(t.dhuhr),
      asr: str(t.asr),
      maghrib: str(t.maghrib),
      isha: str(t.isha),
      midnight: str(t.midnight),
    },
    method: str(body?.method),
    methodLabel: str(body?.method_label),
    madhab: str(body?.madhab),
    city: typeof body?.city === 'string' ? body.city : null,
    source: str(body?.source) || 'computed',
    sources:
      body?.sources && typeof body.sources === 'object'
        ? (body.sources as Record<string, string>)
        : {},
  };
}

/** Fetch prayer times for a coordinate. Throws ApiError — never fake times. */
export async function getPrayerTimes(
  lat: number,
  lng: number,
  opts: { day?: string; settings?: AdhanSettings; tz?: number } = {},
): Promise<AdhanTimes> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
  });
  if (opts.day) params.set('day', opts.day);
  if (opts.settings?.method) params.set('method', opts.settings.method);
  if (opts.settings?.madhab) params.set('madhab', opts.settings.madhab);
  params.set('tz', String(opts.tz ?? localTzOffset()));
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/v1/adhan/times?${params.toString()}`), {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable at ${getApiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) throw new ApiError(`GET /api/v1/adhan/times → ${res.status}`, res.status);
  return parseTimes((await res.json()) as Record<string, unknown>);
}

/** Browser-side fetch (same wire contract as getPrayerTimes). */
export async function clientPrayerTimes(
  lat: number,
  lng: number,
  settings: AdhanSettings,
): Promise<AdhanTimes> {
  const base = apiBaseUrl();
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (settings.method) params.set('method', settings.method);
  if (settings.madhab) params.set('madhab', settings.madhab);
  params.set('tz', String(localTzOffset()));
  const res = await fetch(`${base}/api/v1/adhan/times?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`adhan times failed (${res.status})`);
  return parseTimes((await res.json()) as Record<string, unknown>);
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface NextPrayer {
  name: PrayerName;
  /** "HH:MM" as given by the API. */
  at: string;
  /** Seconds from `now` until it starts. */
  inSeconds: number;
}

/**
 * Find the next prayer from `now` (local time). "sunrise" is included in the
 * order so the countdown can point at it; callers may relabel it.
 * Returns null when no timing parses (caller shows an error, never a guess).
 */
export function nextPrayer(timings: PrayerTimings, now: Date = new Date()): NextPrayer | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowSec = nowMin * 60 + now.getSeconds();
  for (const name of PRAYER_ORDER) {
    const mins = toMinutes(timings[name]);
    if (mins === null) continue;
    const atSec = mins * 60;
    if (atSec > nowSec) {
      return { name, at: timings[name].slice(0, 5), inSeconds: atSec - nowSec };
    }
  }
  // After isha → tomorrow's fajr.
  const fajrMin = toMinutes(timings.fajr);
  if (fajrMin === null) return null;
  return { name: 'fajr', at: timings.fajr.slice(0, 5), inSeconds: 24 * 3600 - nowSec + fajrMin * 60 };
}

/** Format a countdown in seconds as "H:MM:SS" (pure). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}`;
}

/** Format a Hijri date line via Intl (presentation only — the API is the
 *  source of truth for prayer times; the calendar rendering matches the
 *  existing StatusStrip approach). */
export function formatHijri(locale: string, date: Date = new Date()): string {
  try {
    const tag = locale === 'fa' ? 'fa-IR-u-ca-islamic-umalqura' : locale === 'ar' ? 'ar-SA-u-ca-islamic-umalqura' : 'en-u-ca-islamic-umalqura';
    return new Intl.DateTimeFormat(tag, { dateStyle: 'long' }).format(date);
  } catch {
    return '';
  }
}

/** LocalStorage keys for the user's chosen location (never sent anywhere else). */
export const ADHAN_LOCATION_KEY = 'ma.adhan_location';

export interface SavedLocation {
  lat: number;
  lng: number;
  label: string | null;
  source: 'gps' | 'manual' | 'default';
}

export function loadSavedLocation(): SavedLocation | null {
  try {
    const raw = window.localStorage.getItem(ADHAN_LOCATION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return null;
    return {
      lat: o.lat,
      lng: o.lng,
      label: typeof o.label === 'string' ? o.label : null,
      source: o.source === 'gps' || o.source === 'manual' ? o.source : 'default',
    };
  } catch {
    return null;
  }
}

export function saveLocation(loc: SavedLocation): void {
  try {
    window.localStorage.setItem(ADHAN_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    /* storage full/blocked — non-fatal */
  }
}

/* ------------------------------------------------------------------ */
/* Prayer-times page (cities, user choice, options, range)             */
/* ------------------------------------------------------------------ */

/**
 * City-center coordinates — the same list as the API (adhan_data.CITIES).
 * Duplicated here only so the header strip can resolve the CRM default
 * city without an extra fetch on every page; the API remains the source
 * of truth for computation.
 */
export interface AdhanCity {
  slug: string;
  lat: number;
  lng: number;
}

export const ADHAN_CITIES: AdhanCity[] = [
  { slug: 'torbat-e-jam', lat: 35.24306, lng: 60.625 },
  { slug: 'khaf', lat: 34.5723, lng: 60.144 },
  { slug: 'taybad', lat: 34.74, lng: 60.78 },
  { slug: 'mashhad', lat: 36.297, lng: 59.606 },
  { slug: 'zahedan', lat: 29.496, lng: 60.862 },
  { slug: 'gonbad-e-kavus', lat: 37.255, lng: 55.1714 },
  { slug: 'tehran', lat: 35.6892, lng: 51.389 },
];

export function findCity(slug: string | null): AdhanCity | null {
  if (!slug) return null;
  return ADHAN_CITIES.find((c) => c.slug === slug) ?? null;
}

/**
 * The user's saved page choice (v1 persistence: browser localStorage only —
 * no account-settings schema is invented). The header strip listens for
 * ADHAN_CHOICE_EVENT and re-reads this key so the banner follows the page
 * live, on every page, without a reload.
 */
export const ADHAN_CHOICE_KEY = 'ma.adhan_choice';
export const ADHAN_CHOICE_EVENT = 'ma:adhan-choice';

export interface AdhanChoice {
  city: string | null;
  lat: number;
  lng: number;
  method: string;
  madhab: string;
}

export function loadAdhanChoice(): AdhanChoice | null {
  try {
    const raw = window.localStorage.getItem(ADHAN_CHOICE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof o.lat !== 'number' ||
      typeof o.lng !== 'number' ||
      typeof o.method !== 'string' ||
      typeof o.madhab !== 'string'
    ) {
      return null;
    }
    return {
      city: typeof o.city === 'string' ? o.city : null,
      lat: o.lat,
      lng: o.lng,
      method: o.method,
      madhab: o.madhab,
    };
  } catch {
    return null;
  }
}

export function saveAdhanChoice(choice: AdhanChoice): void {
  try {
    window.localStorage.setItem(ADHAN_CHOICE_KEY, JSON.stringify(choice));
    window.dispatchEvent(new Event(ADHAN_CHOICE_EVENT));
  } catch {
    /* storage full/blocked — non-fatal */
  }
}

export interface AdhanMethodOption {
  id: string;
  label: string;
  authority: string;
  fajr: number | null;
  isha: number | null;
  maghrib: number | null;
  isha_minutes: number | null;
  isha_minutes_ramadan: number | null;
  available: boolean;
  note: string;
}

export interface AdhanOptions {
  methods: AdhanMethodOption[];
  cities: AdhanCity[];
}

async function fetchAdhanJson(path: string): Promise<Record<string, unknown>> {
  const base = apiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`adhan API unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`adhan API → ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** GET /api/v1/adhan/options — methods (angles, authority) + cities. */
export async function getAdhanOptions(): Promise<AdhanOptions> {
  const body = await fetchAdhanJson('/api/v1/adhan/options');
  const methods = (Array.isArray(body.methods) ? body.methods : []).map((m) => {
    const r = m as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      id: typeof r.id === 'string' ? r.id : '',
      label: typeof r.label === 'string' ? r.label : '',
      authority: typeof r.authority === 'string' ? r.authority : '',
      fajr: num(r.fajr),
      isha: num(r.isha),
      maghrib: num(r.maghrib),
      isha_minutes: num(r.isha_minutes),
      isha_minutes_ramadan: num(r.isha_minutes_ramadan),
      available: r.available !== false,
      note: typeof r.note === 'string' ? r.note : '',
    };
  });
  const cities = (Array.isArray(body.cities) ? body.cities : []).map((c) => {
    const r = c as Record<string, unknown>;
    return {
      slug: typeof r.slug === 'string' ? r.slug : '',
      lat: typeof r.lat === 'number' ? r.lat : 0,
      lng: typeof r.lng === 'number' ? r.lng : 0,
    };
  });
  return { methods, cities };
}

export interface AdhanDay {
  date: string;
  source: string;
  times: PrayerTimings;
}

export interface AdhanRange {
  start: string;
  end: string;
  city: string | null;
  method: string;
  madhab: string;
  days: AdhanDay[];
}

function parseRangeTimes(t: unknown): PrayerTimings {
  const r = (t ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    imsak: str(r.imsak),
    fajr: str(r.fajr),
    sunrise: str(r.sunrise),
    dhuhr: str(r.dhuhr),
    asr: str(r.asr),
    maghrib: str(r.maghrib),
    isha: str(r.isha),
    midnight: str(r.midnight),
  };
}

/** GET /api/v1/adhan/range — week/month/year timetables. */
export async function getAdhanRange(params: {
  start: string;
  end: string;
  city?: string | null;
  lat?: number;
  lng?: number;
  method: string;
  madhab: string;
  tz?: number;
}): Promise<AdhanRange> {
  const q = new URLSearchParams({ start: params.start, end: params.end });
  if (params.city) q.set('city', params.city);
  if (params.lat !== undefined) q.set('lat', String(params.lat));
  if (params.lng !== undefined) q.set('lng', String(params.lng));
  q.set('method', params.method);
  q.set('madhab', params.madhab);
  q.set('tz', String(params.tz ?? localTzOffset()));
  const body = await fetchAdhanJson(`/api/v1/adhan/range?${q.toString()}`);
  return {
    start: typeof body.start === 'string' ? body.start : params.start,
    end: typeof body.end === 'string' ? body.end : params.end,
    city: typeof body.city === 'string' ? body.city : null,
    method: typeof body.method === 'string' ? body.method : params.method,
    madhab: typeof body.madhab === 'string' ? body.madhab : params.madhab,
    days: (Array.isArray(body.days) ? body.days : []).map((d) => {
      const r = d as Record<string, unknown>;
      return {
        date: typeof r.date === 'string' ? r.date : '',
        source: typeof r.source === 'string' ? r.source : 'computed',
        times: parseRangeTimes(r.times),
      };
    }),
  };
}

/** GET /api/v1/adhan/times with a city (or explicit coordinates). */
export async function getAdhanTimesForChoice(params: {
  day: string;
  city?: string | null;
  lat?: number;
  lng?: number;
  method: string;
  madhab: string;
  tz?: number;
}): Promise<AdhanTimes> {
  const q = new URLSearchParams({ date: params.day });
  if (params.city) q.set('city', params.city);
  if (params.lat !== undefined) q.set('lat', String(params.lat));
  if (params.lng !== undefined) q.set('lng', String(params.lng));
  q.set('method', params.method);
  q.set('madhab', params.madhab);
  q.set('tz', String(params.tz ?? localTzOffset()));
  const body = await fetchAdhanJson(`/api/v1/adhan/times?${q.toString()}`);
  return parseTimes(body);
}
