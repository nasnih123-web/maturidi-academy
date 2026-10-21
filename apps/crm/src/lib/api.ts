/**
 * API client for the CRM scaffold.
 *
 * - Base URL from VITE_API_URL. In dev it falls back to http://localhost:8000;
 *   in production builds the fallback is FORBIDDEN — vite.config.ts fails the
 *   build without an explicit VITE_API_URL, and this module throws at import
 *   time as a second line of defense (Track 2 / §۱۳).
 * - Attaches `Authorization: Bearer <access_token>` to every request.
 * - On 401 it calls POST /api/v1/auth/refresh once (refresh-token rotation,
 *   contract §2) and retries the original request a single time.
 * - Error envelope is the unified contract shape (§1):
 *   {"error": {"code","message","details"}, "request_id"}
 */

function resolveApiUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
    /\/$/,
    ""
  );
  if (fromEnv) return fromEnv;
  if (import.meta.env.PROD) {
    // نباید هیچ‌وقت اتفاق بیفتد (vite.config.ts بیلد را فیل می‌کند) —
    // ولی اگر باندلی با PROD و بدون VITE_API_URL ساخته شد، به‌جای حملهٔ
    // خاموش به localhost کاربر، بلند خطا بده.
    throw new Error(
      "[crm] VITE_API_URL is not set in this production bundle — " +
        "refusing to fall back to http://localhost:8000."
    );
  }
  return "http://localhost:8000";
}

const API_URL = resolveApiUrl();

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Backend login flag (contract §2): privileged user without TOTP yet —
   *  the issued pair carries the restricted `2fa_setup` scope. */
  must_enroll_2fa?: boolean;
}

const ACCESS_KEY = "crm.access_token";
const REFRESH_KEY = "crm.refresh_token";

let accessToken: string | null = null;
let refreshToken: string | null = null;

try {
  accessToken = localStorage.getItem(ACCESS_KEY);
  refreshToken = localStorage.getItem(REFRESH_KEY);
} catch {
  // Storage unavailable (private mode etc.) — tokens stay in memory only.
}

export function setTokens(pair: TokenPair): void {
  accessToken = pair.access_token;
  refreshToken = pair.refresh_token;
  try {
    localStorage.setItem(ACCESS_KEY, pair.access_token);
    localStorage.setItem(REFRESH_KEY, pair.refresh_token);
  } catch {
    // ignore — memory-only fallback
  }
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    // ignore
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
  request_id?: string;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "unknown";
  let message = `HTTP ${res.status}`;
  let details: unknown = undefined;
  let requestId: string | undefined;
  try {
    const body = (await res.json()) as ErrorEnvelope;
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
    requestId = body.request_id;
  } catch {
    // Non-JSON error body — keep the HTTP status as the message.
  }
  return new ApiError(res.status, code, message, details, requestId);
}

async function rawFetch(
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

/** Single-flight refresh so concurrent 401s don't rotate the token twice. */
let refreshPromise: Promise<TokenPair> | null = null;

async function refreshTokens(): Promise<TokenPair> {
  if (!refreshToken) {
    throw new ApiError(401, "no_refresh_token", "No refresh token available", null);
  }
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await rawFetch(
        "/api/v1/auth/refresh",
        { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) },
        null,
      );
      if (!res.ok) throw await parseError(res);
      const pair = (await res.json()) as TokenPair;
      setTokens(pair);
      return pair;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the automatic 401 → refresh → retry cycle (used by refresh itself). */
  noAutoRefresh?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, noAutoRefresh, ...rest } = options;
  const init: RequestInit = { ...rest, body: body === undefined ? undefined : JSON.stringify(body) };

  let res = await rawFetch(path, init, accessToken);

  if (res.status === 401 && !noAutoRefresh) {
    try {
      await refreshTokens();
    } catch {
      clearTokens();
      throw new ApiError(401, "session_expired", "Session expired", null);
    }
    res = await rawFetch(path, init, accessToken);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiUrl(): string {
  return API_URL;
}

/**
 * POST multipart/form-data with the auth header (file uploads).
 * apiFetch forces application/json, so uploads need their own path —
 * with the same 401 → refresh → retry cycle.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const send = (token: string | null): Promise<Response> => {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_URL}${path}`, { method: "POST", headers, body: form });
  };

  let res = await send(accessToken);
  if (res.status === 401) {
    try {
      await refreshTokens();
    } catch {
      clearTokens();
      throw new ApiError(401, "session_expired", "Session expired", null);
    }
    res = await send(accessToken);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
