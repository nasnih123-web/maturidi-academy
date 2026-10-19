import type { MunajatSettings } from './settings';

/**
 * Night-munajat domain layer (Phase 5 — Track 2/web).
 *
 * The calm theme activates during the configured local-time window
 * (default 02:00–05:00). All time math is pure; the component only reads
 * the boolean. Manual override is stored per browser.
 */

/** Pure: is `now` (user-local) inside the munajat window? Handles wrap-around (e.g. 22→4). */
export function isMunajatTime(now: Date, settings: MunajatSettings): boolean {
  if (!settings.enabled) return false;
  const h = now.getHours();
  const { startHour, endHour } = settings;
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

const OVERRIDE_KEY = 'ma.munajat_override';

/** Manual override: "on" | "off" | null (null = follow the clock). */
export type MunajatOverride = 'on' | 'off' | null;

export function loadMunajatOverride(): MunajatOverride {
  try {
    const v = window.localStorage.getItem(OVERRIDE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function saveMunajatOverride(v: MunajatOverride): void {
  try {
    if (v === null) window.localStorage.removeItem(OVERRIDE_KEY);
    else window.localStorage.setItem(OVERRIDE_KEY, v);
  } catch {
    /* non-fatal */
  }
}

/** Pure: resolve the effective theme state from clock + override. */
export function resolveMunajatActive(
  clockActive: boolean,
  override: MunajatOverride,
): boolean {
  if (override === 'on') return true;
  if (override === 'off') return false;
  return clockActive;
}
