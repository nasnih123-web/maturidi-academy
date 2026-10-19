/**
 * apps/mobile — src/lib/secureStore.ts
 *
 * Secure token storage. Auth tokens MUST live in the OS keychain/keystore
 * (expo-secure-store) — never in AsyncStorage plaintext, never in SQLite.
 * (engineering-contract §2: tokens are authentication secrets.)
 *
 * The access token is also cached in memory to avoid keychain round-trips
 * on every API call; the cache is dropped on logout/refresh failure.
 */
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "ma.access_token";
const REFRESH_KEY = "ma.refresh_token";
const DEVICE_ID_KEY = "ma.device_id";

let accessCache: string | null = null;
let accessCacheLoaded = false;

async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Already absent — nothing to do.
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (accessCacheLoaded) return accessCache;
  accessCache = await getItem(ACCESS_KEY);
  accessCacheLoaded = true;
  return accessCache;
}

/** Synchronous peek at the in-memory access token (may be null pre-load). */
export function peekAccessToken(): string | null {
  return accessCacheLoaded ? accessCache : null;
}

export async function getRefreshToken(): Promise<string | null> {
  return getItem(REFRESH_KEY);
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await setItem(ACCESS_KEY, accessToken);
  await setItem(REFRESH_KEY, refreshToken);
  accessCache = accessToken;
  accessCacheLoaded = true;
}

export async function clearTokens(): Promise<void> {
  await deleteItem(ACCESS_KEY);
  await deleteItem(REFRESH_KEY);
  accessCache = null;
  accessCacheLoaded = true;
}

/**
 * Stable per-install device id for the sync protocol (device_id in
 * /api/v1/sync/*). Not a secret — stored alongside the tokens for
 * convenience; it is sent to the server on every sync call.
 */
export async function getDeviceId(): Promise<string> {
  let id = await getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
