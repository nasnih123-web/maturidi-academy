/**
 * apps/mobile — src/services/settings.ts
 *
 * Settings orchestration: locale, push preference and public settings.
 *
 * Notification channels (engineering-contract §notification_preferences):
 * the backend distinguishes `push` (mobile FCM/APNs) from `web_push`
 * (browser). The mobile app ONLY ever touches the `push` channel — web push
 * is the web track's concern. Device-level gating lives in the local kv
 * store; the server-side `notification_preferences` management endpoint
 * (channel=`push`, per type) is a Phase-13 server-track contract item —
 * when it lands, `setPushPreference` should mirror the value there.
 */
import { api, ApiError } from "../lib/api";
import { getDb } from "../lib/db";
import type { Locale } from "../types";

const LOCALE_KEY = "settings:locale";
const PUSH_KEY = "settings:push_enabled";

async function kvGet(key: string): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [key]);
  return row?.value ?? null;
}

async function kvSet(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [
    key,
    value,
    value,
  ]);
}

export async function getLocale(): Promise<Locale> {
  const v = await kvGet(LOCALE_KEY);
  return v === "ar" || v === "en" || v === "fa" ? v : "fa";
}

export async function setLocale(locale: Locale): Promise<void> {
  await kvSet(LOCALE_KEY, locale);
  try {
    await api.patch("/api/v1/users/me", { locale });
  } catch (e) {
    if (!(e instanceof ApiError) || !e.isNetworkError) throw e;
    // Offline: the local value already applies; the server syncs on next launch.
  }
}

/** Device-level push opt-in (default ON). */
export async function getPushEnabled(): Promise<boolean> {
  const v = await kvGet(PUSH_KEY);
  return v !== "0";
}

export async function setPushEnabled(enabled: boolean): Promise<void> {
  await kvSet(PUSH_KEY, enabled ? "1" : "0");
}

export async function getPublicSettings(): Promise<Record<string, unknown>> {
  try {
    return await api.get<Record<string, unknown>>("/api/v1/settings/public", { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.isNetworkError) return {};
    throw e;
  }
}
