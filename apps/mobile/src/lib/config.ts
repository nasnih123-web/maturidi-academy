/**
 * apps/mobile — src/lib/config.ts
 *
 * Runtime configuration. Values come from (in priority order):
 *  1. EXPO_PUBLIC_* environment variables (EAS / .env)
 *  2. `expo.extra` — resolved at build time by app.config.js (API URL +
 *     branding overrides; production profiles fail loudly without a real
 *     non-localhost URL there, see F-09)
 *  3. Safe local defaults
 *
 * No secrets are read here — tokens live in expo-secure-store (secureStore.ts).
 */
import Constants from "expo-constants";

// __DEV__ گلوبال React Native است (در type definitions پروژه declare نشده).
declare const __DEV__: boolean;

function extra(): Record<string, unknown> {
  const cfg = Constants.expoConfig?.extra;
  return cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
}

/** Base URL of the FastAPI backend, without trailing slash. */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromExtra = extra().apiUrl;
  const raw =
    (typeof fromEnv === "string" && fromEnv) ||
    (typeof fromExtra === "string" && fromExtra) ||
    "";
  if (!raw) {
    // Track 2 / §۱۶ — بیلد production موبایل هرگز نباید بی‌صدا به
    // localhost:8000 fallback کند (در گوشی واقعی بی‌معنی است). فقط dev.
    if (__DEV__) return "http://localhost:8000";
    throw new Error(
      "[config] EXPO_PUBLIC_API_URL (or expo.extra.apiUrl) is required in " +
        "production builds — refusing to silently fall back to http://localhost:8000."
    );
  }
  return raw.replace(/\/+$/, "");
}

/** EAS project id — required for Expo Push tokens. Empty = push disabled. */
export function easProjectId(): string {
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const fromExtra = extra().easProjectId;
  if (typeof fromEnv === "string" && fromEnv) return fromEnv;
  if (typeof fromExtra === "string" && fromExtra) return fromExtra;
  return "";
}

/** Server path used to register the device push token (Phase-13 contract). */
export function pushRegisterPath(): string {
  const fromEnv = process.env.EXPO_PUBLIC_PUSH_REGISTER_PATH;
  if (typeof fromEnv === "string" && fromEnv) return fromEnv;
  return "/api/v1/users/me/devices";
}

/** Default UI locale (fa) — the user can change it in Settings. */
export function defaultLocale(): "fa" {
  return "fa";
}

export const APP_SLUG = "maturidi-academy";
export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
