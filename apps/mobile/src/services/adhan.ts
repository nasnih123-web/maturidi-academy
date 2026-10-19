/**
 * apps/mobile — src/services/adhan.ts
 *
 * Prayer times from GET /api/v1/adhan/times (server-side PrayTimes
 * computation; the client never computes fiqh times itself). The last
 * successful response is cached in SQLite kv so the screen still renders
 * offline.
 */
import { api, ApiError } from "../lib/api";
import { getDb, nowIso } from "../lib/db";
import type { AdhanTimesOut } from "../types";

const KV_KEY = "adhan:last_times";

export interface AdhanQuery {
  method?: string;
  madhab?: "hanafi" | "shafi";
  /** Local UTC offset in hours, e.g. 3.5 for Asia/Tehran. */
  tz?: number;
}

export async function getPrayerTimes(
  lat: number,
  lng: number,
  query: AdhanQuery = {},
): Promise<{ times: AdhanTimesOut; offline: boolean }> {
  try {
    const times = await api.get<AdhanTimesOut>("/api/v1/adhan/times", {
      auth: false,
      query: {
        lat,
        lng,
        method: query.method ?? "mwl",
        madhab: query.madhab ?? "hanafi",
        tz: query.tz ?? 3.5,
      },
    });
    const database = await getDb();
    await database.runAsync(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [
      KV_KEY,
      JSON.stringify(times),
      JSON.stringify(times),
    ]);
    return { times, offline: false };
  } catch (e) {
    if (!(e instanceof ApiError) || !e.isNetworkError) throw e;
    const database = await getDb();
    const row = await database.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [KV_KEY]);
    if (!row) throw e;
    return { times: JSON.parse(row.value) as AdhanTimesOut, offline: true };
  }
}

/** Tehran fallback coordinates (used when the user skips location). */
export const TEHRAN = { lat: 35.6892, lng: 51.389, tz: 3.5 } as const;

export async function rememberAdhanQuery(lat: number, lng: number, query: AdhanQuery): Promise<void> {
  const database = await getDb();
  const value = JSON.stringify({ lat, lng, ...query, at: nowIso() });
  await database.runAsync(`INSERT INTO kv (key, value) VALUES ('adhan:query', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [
    value,
    value,
  ]);
}

export async function lastAdhanQuery(): Promise<{ lat: number; lng: number } & AdhanQuery | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = 'adhan:query'`);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as { lat: number; lng: number } & AdhanQuery;
  } catch {
    return null;
  }
}
