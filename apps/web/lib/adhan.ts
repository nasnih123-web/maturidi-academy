import { API_BASE_URL, ApiError } from './api';
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
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
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
      `API unreachable at ${API_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
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
