'use client';

/**
 * useAdhanCountdown — ticking countdown to the next prayer.
 *
 * Fetches times from GET /api/v1/adhan/times for the user's location
 * (GPS → manual → settings default → none) and ticks every second.
 * Pure time math lives in lib/adhan.ts; this hook owns the polling +
 * location lifecycle. When no location and no API, state is `unavailable`
 * — the component renders a setup prompt, never fake times.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ADHAN_LOCATION_KEY,
  clientPrayerTimes,
  formatCountdown,
  formatHijri,
  loadSavedLocation,
  nextPrayer,
  saveLocation,
  type AdhanTimes,
  type NextPrayer,
  type SavedLocation,
} from '../adhan';
import type { AdhanSettings } from '../settings';

export type AdhanStatus =
  | 'locating'
  | 'loading'
  | 'ready'
  | 'needs_location'
  | 'unavailable';

export interface AdhanCountdownState {
  status: AdhanStatus;
  times: AdhanTimes | null;
  next: NextPrayer | null;
  countdown: string;
  location: SavedLocation | null;
  error: string | null;
  hijriLine: string | null;
}

const INITIAL: AdhanCountdownState = {
  status: 'locating',
  times: null,
  next: null,
  countdown: '',
  location: null,
  error: null,
  hijriLine: null,
};

export function useAdhanCountdown(settings: AdhanSettings, locale = 'fa') {
  const [state, setState] = useState<AdhanCountdownState>(INITIAL);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const tick = useCallback((times: AdhanTimes) => {
    const next = nextPrayer(times.timings, new Date());
    if (!next) {
      setState((s) => ({ ...s, status: 'unavailable', error: 'times_invalid' }));
      return;
    }
    setState((s) => ({
      ...s,
      status: 'ready',
      next,
      countdown: formatCountdown(next.inSeconds),
    }));
  }, []);

  const loadFor = useCallback(
    async (loc: SavedLocation) => {
      setState((s) => ({ ...s, status: 'loading', location: loc, error: null }));
      try {
        const times = await clientPrayerTimes(loc.lat, loc.lng, settingsRef.current);
        const hijriLine = formatHijri(localeRef.current) || null;
        setState((s) => ({ ...s, times, hijriLine }));
        tick(times);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => tick(times), 1000);
      } catch {
        setState((s) => ({ ...s, status: 'unavailable', error: 'times_failed' }));
      }
    },
    [tick],
  );

  /** Ask the browser for GPS (permission-gated). Never called automatically. */
  const useGps = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'needs_location', error: 'gps_unsupported' }));
      return;
    }
    setState((s) => ({ ...s, status: 'locating', error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: SavedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: null,
          source: 'gps',
        };
        saveLocation(loc);
        void loadFor(loc);
      },
      () => {
        setState((s) => ({ ...s, status: 'needs_location', error: 'gps_denied' }));
      },
      { timeout: 10000, maximumAge: 600000 },
    );
  }, [loadFor]);

  /** Manual coordinate entry (validated by the component before calling). */
  const useManual = useCallback(
    async (lat: number, lng: number, label: string | null) => {
      const loc: SavedLocation = { lat, lng, label, source: 'manual' };
      saveLocation(loc);
      await loadFor(loc);
    },
    [loadFor],
  );

  const clearLocation = useCallback(() => {
    try {
      window.localStorage.removeItem(ADHAN_LOCATION_KEY);
    } catch {
      /* ignore */
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setState({ ...INITIAL, status: 'needs_location' });
  }, []);

  useEffect(() => {
    const saved = loadSavedLocation();
    if (saved) {
      void loadFor(saved);
    } else if (
      settingsRef.current.defaultLat !== null &&
      settingsRef.current.defaultLng !== null
    ) {
      void loadFor({
        lat: settingsRef.current.defaultLat,
        lng: settingsRef.current.defaultLng,
        label: null,
        source: 'default',
      });
    } else {
      setState((s) => ({ ...s, status: 'needs_location' }));
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadFor]);

  return { state, useGps, useManual, clearLocation, reload: () => {
    const loc = loadSavedLocation();
    if (loc) void loadFor(loc);
  } };
}
