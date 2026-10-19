/**
 * apps/mobile — src/lib/api.ts
 *
 * Centralised HTTP client for the Maturidi Academy backend (/api/v1/*).
 * Mirrors the web app's `lib/api.ts` + `lib/auth-client.ts` token lifecycle:
 *
 *  - Short-lived access token (15 min) + rotating refresh token (§2).
 *  - On 401 the client attempts exactly one refresh, then retries the
 *    original request once. Concurrent 401s share a single refresh call.
 *  - Refresh failure clears both tokens (the user must sign in again).
 *  - The backend's uniform error envelope
 *    {"error": {"code", "message", "details"}, "request_id"} is parsed into
 *    ApiError so screens can map `code` → localised messages.
 *
 * No business logic — pure transport (ADR-001).
 */
import { apiBaseUrl } from "./config";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./secureStore";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(code: string, message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when the failure is a network problem (not an HTTP response). */
  get isNetworkError(): boolean {
    return this.code === "network_error";
  }
}

interface RequestOptions {
  body?: unknown;
  /** Default true — set false for login/register/refresh/public endpoints. */
  auth?: boolean;
  idempotencyKey?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  let requestId: string | undefined;
  let code = "http_error";
  let message = `HTTP ${status}`;
  let details: unknown;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.request_id === "string") requestId = b.request_id;
    const err = b.error;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e.code === "string") code = e.code;
      if (typeof e.message === "string") message = e.message;
      details = e.details;
    }
  }
  return new ApiError(code, message, status, details, requestId);
}

let refreshPromise: Promise<boolean> | null = null;

/** Single-flight refresh; true when a fresh pair was stored. */
async function refreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async (): Promise<boolean> => {
    try {
      const rt = await getRefreshToken();
      if (!rt) return false;
      const res = await fetch(`${apiBaseUrl()}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      const body = await parseBody(res);
      if (!res.ok || !body || typeof body !== "object") return false;
      const pair = body as { access_token?: string; refresh_token?: string };
      if (typeof pair.access_token !== "string" || typeof pair.refresh_token !== "string") return false;
      await saveTokens(pair.access_token, pair.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  let url = `${apiBaseUrl()}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const withAuth = opts.auth !== false;

  const attempt = async (retried: boolean): Promise<T> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (withAuth) {
      const at = await getAccessToken();
      if (at) headers.Authorization = `Bearer ${at}`;
    }
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await fetch(buildUrl(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new ApiError("network_error", e instanceof Error ? e.message : "network_error", 0);
    }

    if (res.status === 204) return null as unknown as T;
    const body = await parseBody(res);

    if (res.status === 401 && withAuth && !retried) {
      const refreshed = await refreshTokens();
      if (refreshed) return attempt(true);
      await clearTokens();
      throw new ApiError("unauthorized", "unauthorized", 401);
    }
    if (!res.ok) throw toApiError(res.status, body);
    return body as T;
  };

  return attempt(false);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>("PUT", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>("PATCH", path, { ...opts, body }),
  del: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>("DELETE", path, opts),
};

/** True when the device currently holds any refresh token (signed-in). */
export async function hasStoredSession(): Promise<boolean> {
  return (await getRefreshToken()) != null;
}
