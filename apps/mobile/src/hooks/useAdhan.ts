/**
 * apps/mobile — src/hooks/useAdhan.ts
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  getPrayerTimes,
  lastAdhanQuery,
  rememberAdhanQuery,
  TEHRAN,
  type AdhanQuery,
} from "../services/adhan";
import type { AdhanTimesOut } from "../types";

export function useAdhanTimes(): {
  times: AdhanTimesOut | null;
  offline: boolean;
  loading: boolean;
  error: string | null;
  coords: { lat: number; lng: number };
  load: (lat: number, lng: number, query?: AdhanQuery) => Promise<void>;
  useTehran: () => Promise<void>;
} {
  const [times, setTimes] = useState<AdhanTimesOut | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({ lat: TEHRAN.lat, lng: TEHRAN.lng });

  const load = useCallback(async (lat: number, lng: number, query: AdhanQuery = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPrayerTimes(lat, lng, query);
      setTimes(res.times);
      setOffline(res.offline);
      setCoords({ lat, lng });
      await rememberAdhanQuery(lat, lng, query);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
      setOffline(e instanceof ApiError && e.isNetworkError);
    } finally {
      setLoading(false);
    }
  }, []);

  const useTehran = useCallback(() => load(TEHRAN.lat, TEHRAN.lng, { tz: TEHRAN.tz }), [load]);

  useEffect(() => {
    (async () => {
      const last = await lastAdhanQuery();
      if (last) await load(last.lat, last.lng, { method: last.method, madhab: last.madhab, tz: last.tz });
      else await useTehran();
    })();
  }, [load, useTehran]);

  return { times, offline, loading, error, coords, load, useTehran };
}
