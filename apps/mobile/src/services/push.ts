/**
 * apps/mobile — src/services/push.ts
 *
 * Push notifications via expo-notifications (FCM on Android, APNs on iOS
 * through the Expo push service).
 *
 *  - `initPush()` installs the notification handler + Android channels.
 *  - `ensurePushToken()` requests permission, obtains the Expo push token
 *    and registers it with the backend at the Phase-13 contract endpoint
 *    (`POST /api/v1/users/me/devices`, configurable via
 *    EXPO_PUBLIC_PUSH_REGISTER_PATH). A 404 means the server track hasn't
 *    landed the endpoint yet — the token is kept locally and registration
 *    is retried on next launch (logged, not silent).
 *  - `scheduleAdhanReminders()` books local notifications for prayer times.
 *    These are LOCAL notifications — they work without FCM and respect the
 *    user's push preference.
 *  - The service never touches the `web_push` channel — mobile only
 *    registers for `push` (see services/settings.ts).
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api, ApiError } from "../lib/api";
import { APP_VERSION, easProjectId, pushRegisterPath } from "../lib/config";
import { getLocale, getPushEnabled } from "./settings";
import type { AdhanTimes, AdhanTimesOut, PrayerKey } from "../types";

const ADHAN_CHANNEL = "adhan";

export async function initPush(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "General",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(ADHAN_CHANNEL, {
      name: "Prayer times",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }
}

export async function requestPushPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/**
 * Obtain the Expo push token and register it server-side.
 * Returns the token, or null when push is unavailable (no project id,
 * permission denied, or user opted out).
 */
export async function ensurePushToken(): Promise<string | null> {
  if (!(await getPushEnabled())) return null;
  const projectId = easProjectId();
  if (!projectId) {
    console.warn("[push] EXPO_PUBLIC_EAS_PROJECT_ID is empty — push token skipped.");
    return null;
  }
  const granted = await requestPushPermission();
  if (!granted) return null;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await registerTokenWithBackend(token);
    return token;
  } catch (e) {
    console.warn("[push] token acquisition failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function registerTokenWithBackend(token: string): Promise<void> {
  const locale = await getLocale();
  try {
    await api.post(pushRegisterPath(), {
      platform: Platform.OS,
      push_token: token,
      app_version: APP_VERSION,
      locale,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // Phase-13 server contract endpoint — not landed yet. Keep the token
      // locally; registration retried on next launch.
      console.warn(`[push] ${pushRegisterPath()} not found (404) — token kept locally.`);
      return;
    }
    throw e;
  }
}

const PRAYER_ORDER: { key: PrayerKey; channelId: string }[] = [
  { key: "fajr", channelId: ADHAN_CHANNEL },
  { key: "dhuhr", channelId: ADHAN_CHANNEL },
  { key: "asr", channelId: ADHAN_CHANNEL },
  { key: "maghrib", channelId: ADHAN_CHANNEL },
  { key: "isha", channelId: ADHAN_CHANNEL },
];

/** Parse an "HH:MM" prayer time into a Date for the given day. */
function prayerDate(day: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const d = new Date(day);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

/**
 * Schedule local reminders for today's remaining prayers.
 * Previous adhan reminders are cancelled first (idempotent).
 */
export async function scheduleAdhanReminders(
  times: AdhanTimesOut,
  prayerTitles: Record<PrayerKey, string>,
  body: string,
): Promise<number> {
  if (!(await getPushEnabled())) return 0;
  const granted = await requestPushPermission();
  if (!granted) return 0;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    const data = n.content.data as { kind?: string } | undefined;
    if (data?.kind === "adhan") await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }

  const now = new Date();
  const day = new Date(times.date);
  let count = 0;
  for (const { key } of PRAYER_ORDER) {
    const hhmm = (times.times as AdhanTimes)[key];
    const at = prayerDate(Number.isNaN(day.getTime()) ? now : day, hhmm);
    if (!at || at.getTime() <= now.getTime() + 60_000) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: prayerTitles[key],
        body,
        sound: "default",
        data: { kind: "adhan", prayer: key },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: Platform.OS === "android" ? ADHAN_CHANNEL : undefined,
      },
    });
    count += 1;
  }
  return count;
}

export async function cancelAdhanReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    const data = n.content.data as { kind?: string } | undefined;
    if (data?.kind === "adhan") await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
}
