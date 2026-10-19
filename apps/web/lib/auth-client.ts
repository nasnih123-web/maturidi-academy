/**
 * Browser-side auth client (Phase 5 — Track 2/web).
 *
 * Owns the token lifecycle for the web app: login against
 * POST /api/v1/auth/login, access/refresh token rotation, and an
 * authenticated fetch wrapper that refreshes once on 401.
 *
 * Storage: localStorage (keys below). The refresh token is the long-lived
 * secret; the backend rotates it on every use (§2 of the contract).
 * RSC/server code never imports this module — server fetches stay
 * unauthenticated (public endpoints) via lib/api.ts.
 */

const ACCESS_KEY = 'ma.access_token';
const REFRESH_KEY = 'ma.refresh_token';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  must_enroll_2fa?: boolean;
}

import { apiBaseUrl } from './api-base';

function apiBase(): string {
  return apiBaseUrl();
}

function isBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // localStorage access itself can throw on opaque origins (file://,
    // some WebViews) — treat those as non-browser for token purposes.
    return typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function getAccessToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

function storePair(pair: TokenPair): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(ACCESS_KEY, pair.access_token);
  window.localStorage.setItem(REFRESH_KEY, pair.refresh_token);
}

export function clearTokens(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message ?? '';
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `request failed (${res.status})`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

/**
 * Sign in with email/phone + password. Returns the token pair and stores it.
 * Throws on failure — callers render the error (message comes from the API).
 */
export async function login(
  identifier: string,
  password: string,
  totpCode?: string,
): Promise<TokenPair> {
  const pair = await postJson<TokenPair>('/api/v1/auth/login', {
    identifier,
    password,
    ...(totpCode ? { totp_code: totpCode } : {}),
  });
  storePair(pair);
  return pair;
}

/** Sign out: revoke on the server (best-effort), then drop local tokens. */
export async function logout(): Promise<void> {
  const refresh = getRefreshToken();
  const access = getAccessToken();
  clearTokens();
  if (refresh && access) {
    try {
      await fetch(`${apiBase()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      /* network failure during logout is non-fatal — tokens are gone locally */
    }
  }
}

let refreshPromise: Promise<TokenPair> | null = null;

/** Rotate the token pair via POST /api/v1/auth/refresh. Single-flight. */
export async function refreshTokens(): Promise<TokenPair> {
  if (refreshPromise) return refreshPromise;
  const refresh = getRefreshToken();
  if (!refresh) {
    clearTokens();
    throw new Error('no refresh token');
  }
  refreshPromise = postJson<TokenPair>('/api/v1/auth/refresh', {
    refresh_token: refresh,
  })
    .then((pair) => {
      storePair(pair);
      return pair;
    })
    .catch((err) => {
      clearTokens();
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export class AuthFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthFetchError';
    this.status = status;
  }
}

/**
 * Authenticated fetch against the API. Injects `Authorization: Bearer`,
 * refreshes once on 401, and rethrows AuthFetchError otherwise.
 * Never sends credentials to other origins.
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${apiBase()}${path}`, { ...init, headers });
  };

  let res = await doFetch(getAccessToken());
  if (res.status === 401 && getRefreshToken()) {
    try {
      const pair = await refreshTokens();
      res = await doFetch(pair.access_token);
    } catch {
      /* refresh failed — fall through with the original 401 */
    }
  }
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const j = (await res.clone().json()) as { error?: { message?: string } };
      if (j?.error?.message) message = j.error.message;
    } catch {
      /* ignore */
    }
    throw new AuthFetchError(message, res.status);
  }
  return res;
}

/** JSON convenience over authFetch. */
export async function authJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, init);
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

/** Notify listeners (the AuthProvider) that auth state changed. */
export function emitAuthChange(): void {
  if (isBrowser()) window.dispatchEvent(new CustomEvent('ma:auth-change'));
}
