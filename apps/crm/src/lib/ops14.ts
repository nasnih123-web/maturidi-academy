import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { readSettingsMap } from "./appearance";
import { errText } from "./library";

/**
 * Phase 14 — Track 3 (CRM) service layer: external-connections dashboard,
 * build download center, and BI/Metabase config.
 *
 * ADR-001: every bit of parsing, defaulting, date math and API access lives
 * here. Components in pages/ only render what these hooks return.
 *
 * ------------------------------------------------------------------
 * Backend contract — VERIFIED against the real implementation
 * (apps/api/app/modules/admin/{connections,builds}_{router,service}.py,
 *  control_schemas.py; base /api/v1/admin):
 *
 *   GET  /api/v1/admin/connections/status
 *     → {
 *         ai:      { configured: bool,
 *                     providers: [{provider, model, is_fallback}],
 *                     model: str|null },
 *         sms:     { configured: bool, provider: "kavenegar"|null,
 *                     sender: str|null },
 *         telegram:{ connected: bool, account: str|null,   # masked phone
 *                     bot_configured: bool, channel: str|null },
 *         payment: { configured: false,                     # Phase 15
 *                     note: "درگاه پرداخت در فاز ۱۵ پیاده‌سازی می‌شود" },
 *         maps:    { osm: {available: true, note}, neshan: {configured: bool} },
 *         signing: { apple_developer: {uploaded: bool, expires_at: str|null},
 *                     google_play: {...}, cafebazaar: {...},
 *                     windows_cert: {...}, macos_cert: {...} },
 *         checked_at: str }
 *       Secrets are NEVER returned (§3) — only booleans and masked/non-secret
 *       metadata. Note: the SMS provider does not report remaining credit,
 *       so the CRM shows no credit line (honest: "credit if supported").
 *
 *   POST /api/v1/admin/connections/test/{service}
 *     service ∈ ai | sms | telegram | payment | maps | signing(not testable)
 *     body: {} | { phone: "<admin-entered>" } (sms) | { chat_id } (telegram)
 *     → { service, ok: bool, latency_ms: int, tested_at: str,
 *           detail?: str, error?: str }   # detail/error on failure
 *     Every invocation writes an audit record server-side (§14:
 *     «نتیجه در audit ثبت می‌شود؛ secret لاگ نمی‌شود»).
 *
 *   GET  /api/v1/admin/builds/releases
 *     → [ { id, platform: "android"|"ios"|"desktop", version: str,
 *             build_number: str|null, download_url: str|null,   # short-lived
 *             download_expires_at: str|null,                     #  signed URL §6
 *             signed: bool, build_metadata: dict, created_at: str } ]
 *       A bare JSON list (not an envelope). `signed` is honestly false when
 *       CI has no signing secrets — never invented.
 *
 *   POST /api/v1/admin/builds/rebuild   (F-05 remediation: real dispatch)
 *     body: { platform: "android"|"ios"|"desktop",
 *             version?: str, ref?: str, note?: str,
 *             app_name?: str, package_id?: str, version_code?: int,
 *             api_url?: str, environment?: "development"|"preview"|"production" }
 *     → { id, platform, version, ref, status, branding, provider,
 *           provider_run_id, provider_run_url, artifact_name,
 *           signing_ready: bool, missing_signing: [str], note, created_at }
 *     → 503 { error.code: "build_provider_not_configured" } when the API has
 *       no GitHub dispatch provider configured — no fake "queued" row then.
 *     → writes an audit record (§14). Status is synced from the real GitHub
 *       workflow run and tracked via /requests.
 *
 *   GET  /api/v1/admin/builds/requests
 *     → [ { id, platform, version, ref, status, note, branding, provider,
 *             provider_run_id, provider_run_url, artifact_name,
 *             created_at, finished_at } ]   # bare list
 *       provider === null marks legacy Phase-14 rows that were never
 *       dispatched — the UI labels them "not dispatched", never "queued".
 *
 *   GET  /api/v1/admin/builds/prereqs
 *     → { signing:  { <cert>: {present: bool, expires_at: str|null} },
 *           platforms: { <plat>: {required: [str], missing: [str],
 *                                 ready: bool} },
 *           provider: { configured: bool, provider: str|null, repo: str|null } }
 *     Until the backend implements it, the CRM renders the four signing
 *     requirements from the spec statically with an honest "unknown" state.
 *
 *   Metabase base URL is a non-secret platform setting, key "bi.metabase_url"
 *   (read from GET /api/v1/admin/settings). The backend SETTING_DEFS must
 *   register it (non-secret, string, nullable) for this page to see it.
 * ------------------------------------------------------------------
 */

export { errText };

export type ConnectionKey =
  | "ai"
  | "sms"
  | "telegram"
  | "payment"
  | "maps"
  | "signing";

export const CONNECTION_KEYS: ConnectionKey[] = [
  "ai",
  "sms",
  "telegram",
  "payment",
  "maps",
  "signing",
];

export interface AiProviderInfo {
  provider: string;
  model: string;
  is_fallback: boolean;
}

export interface AiConnection {
  configured: boolean;
  providers: AiProviderInfo[];
  model: string | null;
}

export interface SmsConnection {
  configured: boolean;
  provider: string | null;
  sender: string | null;
}

export interface TelegramConnection {
  connected: boolean;
  account: string | null;
  bot_configured: boolean;
  channel: string | null;
}

export interface PaymentConnection {
  configured: boolean;
  note: string | null;
}

export interface MapsConnection {
  osmAvailable: boolean;
  osmNote: string | null;
  neshanConfigured: boolean;
}

export interface SigningCert {
  name: string;
  uploaded: boolean;
  expires_at: string | null;
}

export interface ConnectionsStatus {
  ai: AiConnection;
  sms: SmsConnection;
  telegram: TelegramConnection;
  payment: PaymentConnection;
  maps: MapsConnection;
  signing: SigningCert[];
  checked_at: string | null;
}

export type BuildTarget = "android" | "ios" | "desktop";

export const BUILD_TARGETS: BuildTarget[] = ["android", "ios", "desktop"];

export interface BuildRelease {
  id: string;
  platform: string;
  version: string;
  build_number: string | null;
  download_url: string | null;
  download_expires_at: string | null;
  signed: boolean;
  created_at: string;
}

/** Branding carried by a build request (F-05 remediation). */
export interface BuildBranding {
  app_name?: string;
  package_id?: string;
  version_code?: number;
  api_url?: string;
  environment?: string;
}

export interface BuildRequest {
  id: string;
  platform: string;
  version: string | null;
  ref: string | null;
  status: string;
  note: string | null;
  branding: BuildBranding;
  /** "github_actions" once actually dispatched; null = legacy, never sent. */
  provider: string | null;
  provider_run_id: string | null;
  provider_run_url: string | null;
  artifact_name: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface RebuildResult {
  id: string;
  platform: string;
  version: string | null;
  status: string;
  signing_ready: boolean;
  missing_signing: string[];
  note: string;
  provider: string | null;
  provider_run_url: string | null;
  created_at: string;
}

/** Build-provider state from GET /prereqs (F-05 remediation). */
export interface BuildProvider {
  configured: boolean;
  provider: string | null;
  repo: string | null;
}

export interface PrereqCert {
  present: boolean;
  expires_at: string | null;
}

export interface PrereqPlatform {
  required: string[];
  missing: string[];
  ready: boolean;
}

export interface BuildPrereqs {
  signing: Record<string, PrereqCert>;
  platforms: Record<string, PrereqPlatform>;
  provider: BuildProvider;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/* ------------------------------------------------------------------ */
/* tolerant parsing (backend shapes may carry extra fields)             */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

function pickStr(r: Rec, key: string, fallback = ""): string {
  const v = r[key];
  return typeof v === "string" ? v : fallback;
}

function pickBool(r: Rec, key: string, fallback = false): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : fallback;
}

function pickListOf(v: unknown): Rec[] {
  return Array.isArray(v) ? v.map(asRec) : [];
}

function asList(raw: unknown): Rec[] {
  if (Array.isArray(raw)) return raw.map(asRec);
  const r = asRec(raw);
  for (const k of ["releases", "requests", "items", "data"]) {
    if (Array.isArray(r[k])) return (r[k] as unknown[]).map(asRec);
  }
  return [];
}

const SIGNING_CERT_NAMES = [
  "apple_developer",
  "google_play",
  "cafebazaar",
  "windows_cert",
  "macos_cert",
];

function parseConnections(raw: unknown): ConnectionsStatus {
  const r = asRec(raw);
  const ai = asRec(r["ai"]);
  const sms = asRec(r["sms"]);
  const tg = asRec(r["telegram"]);
  const pay = asRec(r["payment"]);
  const maps = asRec(r["maps"]);
  const osm = asRec(maps["osm"]);
  const neshan = asRec(maps["neshan"]);
  const signingRaw = asRec(r["signing"]);
  return {
    ai: {
      configured: pickBool(ai, "configured"),
      providers: pickListOf(ai["providers"]).map((p) => ({
        provider: pickStr(p, "provider"),
        model: pickStr(p, "model"),
        is_fallback: pickBool(p, "is_fallback"),
      })),
      model: pickStr(ai, "model") || null,
    },
    sms: {
      configured: pickBool(sms, "configured"),
      provider: pickStr(sms, "provider") || null,
      sender: pickStr(sms, "sender") || null,
    },
    telegram: {
      connected: pickBool(tg, "connected"),
      account: pickStr(tg, "account") || null,
      bot_configured: pickBool(tg, "bot_configured"),
      channel: pickStr(tg, "channel") || null,
    },
    payment: {
      configured: pickBool(pay, "configured"),
      note: pickStr(pay, "note") || null,
    },
    maps: {
      osmAvailable: pickBool(osm, "available", true),
      osmNote: pickStr(osm, "note") || null,
      neshanConfigured: pickBool(neshan, "configured"),
    },
    signing: SIGNING_CERT_NAMES.map((name) => {
      const c = asRec(signingRaw[name]);
      return {
        name,
        uploaded: pickBool(c, "uploaded"),
        expires_at: pickStr(c, "expires_at") || null,
      };
    }),
    checked_at: pickStr(r, "checked_at") || null,
  };
}

function parseRelease(raw: unknown): BuildRelease {
  const r = asRec(raw);
  return {
    id: pickStr(r, "id"),
    platform: pickStr(r, "platform", "android"),
    version: pickStr(r, "version"),
    build_number: pickStr(r, "build_number") || null,
    download_url: pickStr(r, "download_url") || null,
    download_expires_at: pickStr(r, "download_expires_at") || null,
    signed: pickBool(r, "signed"),
    created_at: pickStr(r, "created_at"),
  };
}

function parseBranding(raw: unknown): BuildBranding {
  const b = asRec(raw);
  const out: BuildBranding = {};
  const appName = pickStr(b, "app_name");
  if (appName) out.app_name = appName;
  const pkg = pickStr(b, "package_id");
  if (pkg) out.package_id = pkg;
  if (typeof b["version_code"] === "number") out.version_code = b["version_code"] as number;
  const apiUrl = pickStr(b, "api_url");
  if (apiUrl) out.api_url = apiUrl;
  const env = pickStr(b, "environment");
  if (env) out.environment = env;
  return out;
}

function parseBuildRequest(raw: unknown): BuildRequest {
  const r = asRec(raw);
  return {
    id: pickStr(r, "id"),
    platform: pickStr(r, "platform", "android"),
    version: pickStr(r, "version") || null,
    ref: pickStr(r, "ref") || null,
    status: pickStr(r, "status", "queued"),
    note: pickStr(r, "note") || null,
    branding: parseBranding(r["branding"]),
    provider: pickStr(r, "provider") || null,
    provider_run_id: pickStr(r, "provider_run_id") || null,
    provider_run_url: pickStr(r, "provider_run_url") || null,
    artifact_name: pickStr(r, "artifact_name") || null,
    created_at: pickStr(r, "created_at"),
    finished_at: pickStr(r, "finished_at") || null,
  };
}

function parseRebuildResult(raw: unknown): RebuildResult {
  const r = asRec(raw);
  const missing = r["missing_signing"];
  return {
    id: pickStr(r, "id"),
    platform: pickStr(r, "platform", "android"),
    version: pickStr(r, "version") || null,
    status: pickStr(r, "status", "queued"),
    signing_ready: pickBool(r, "signing_ready"),
    missing_signing: Array.isArray(missing)
      ? missing.filter((x): x is string => typeof x === "string")
      : [],
    note: pickStr(r, "note"),
    provider: pickStr(r, "provider") || null,
    provider_run_url: pickStr(r, "provider_run_url") || null,
    created_at: pickStr(r, "created_at"),
  };
}

function parsePrereqs(raw: unknown): BuildPrereqs {
  const r = asRec(raw);
  const signingRaw = asRec(r["signing"]);
  const platformsRaw = asRec(r["platforms"]);
  const signing: Record<string, PrereqCert> = {};
  for (const [name, v] of Object.entries(signingRaw)) {
    const c = asRec(v);
    signing[name] = {
      present: pickBool(c, "present"),
      expires_at: pickStr(c, "expires_at") || null,
    };
  }
  const platforms: Record<string, PrereqPlatform> = {};
  for (const [plat, v] of Object.entries(platformsRaw)) {
    const p = asRec(v);
    const strArr = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((e): e is string => typeof e === "string") : [];
    platforms[plat] = {
      required: strArr(p["required"]),
      missing: strArr(p["missing"]),
      ready: pickBool(p, "ready"),
    };
  }
  const prov = asRec(r["provider"]);
  return {
    signing,
    platforms,
    provider: {
      configured: pickBool(prov, "configured"),
      provider: pickStr(prov, "provider") || null,
      repo: pickStr(prov, "repo") || null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* pure helpers (date math / formatting — never in components)           */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/**
 * Cert-expiry analysis for the signing card: whole days remaining and
 * whether the cert is in the red zone (< 30 days). Null when the backend
 * does not report an expiry.
 */
export interface CertExpiryInfo {
  daysLeft: number | null;
  urgent: boolean;
}

export function certExpiryInfo(expiresAt: string | null | undefined): CertExpiryInfo {
  if (!expiresAt) return { daysLeft: null, urgent: false };
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return { daysLeft: null, urgent: false };
  const daysLeft = Math.floor((ts - Date.now()) / DAY_MS);
  return { daysLeft, urgent: daysLeft < 30 };
}

/**
 * Rebuild-request statuses that are still in flight (keep polling).
 * Terminal values: completed/failed (+ legacy done/succeeded/success/
 * cancelled). Anything else keeps polling.
 */
const TERMINAL_REQUEST_STATUSES = new Set([
  "completed",
  "done",
  "succeeded",
  "success",
  "failed",
  "cancelled",
]);

export function isRequestActive(status: string | undefined): boolean {
  return !!status && !TERMINAL_REQUEST_STATUSES.has(status);
}

/**
 * A request is *live* only when it is non-terminal AND was actually
 * dispatched (provider set). Legacy Phase-14 rows sit in "queued" with no
 * provider — they were never sent anywhere, so polling for them (or
 * presenting them as in-flight) would be a lie (F-05).
 */
export function requestIsLive(r: BuildRequest): boolean {
  return isRequestActive(r.status) && r.provider !== null;
}

/* ------------------------------------------------------------------ */
/* queries / mutations                                                 */
/* ------------------------------------------------------------------ */

export function useConnections() {
  return useQuery({
    queryKey: ["ops14", "connections"],
    queryFn: async () => {
      const raw = await apiFetch<unknown>("/api/v1/admin/connections/status");
      return parseConnections(raw);
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      service,
      phone,
    }: {
      service: ConnectionKey;
      phone?: string;
    }): Promise<TestConnectionResult> => {
      const raw = await apiFetch<unknown>(
        `/api/v1/admin/connections/test/${service}`,
        { method: "POST", body: phone ? { phone } : {} },
      );
      const r = asRec(raw);
      const ok = pickBool(r, "ok");
      return {
        ok,
        message:
          pickStr(r, "detail") ||
          pickStr(r, "error") ||
          pickStr(r, "message") ||
          (ok ? "ok" : "failed"),
        latencyMs:
          typeof r["latency_ms"] === "number" ? (r["latency_ms"] as number) : undefined,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops14", "connections"] });
    },
  });
}

export function useReleases() {
  return useQuery({
    queryKey: ["ops14", "releases"],
    queryFn: async () => {
      const raw = await apiFetch<unknown>("/api/v1/admin/builds/releases");
      return asList(raw).map(parseRelease);
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useBuildRequests() {
  return useQuery({
    queryKey: ["ops14", "build-requests"],
    queryFn: async () => {
      const raw = await apiFetch<unknown>("/api/v1/admin/builds/requests");
      return asList(raw).map(parseBuildRequest);
    },
    retry: false,
    // Live tracking: poll only while a *dispatched* request is in flight —
    // legacy un-dispatched "queued" rows must not poll (or imply) forever.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => requestIsLive(r)) ? 10_000 : false,
  });
}

export function useRebuild() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      platform: BuildTarget;
      version?: string;
      note?: string;
      branding?: BuildBranding;
    }): Promise<RebuildResult> => {
      const b = input.branding ?? {};
      const raw = await apiFetch<unknown>("/api/v1/admin/builds/rebuild", {
        method: "POST",
        body: {
          platform: input.platform,
          ...(input.version ? { version: input.version } : {}),
          ...(input.note ? { note: input.note } : {}),
          ...(b.app_name ? { app_name: b.app_name } : {}),
          ...(b.package_id ? { package_id: b.package_id } : {}),
          ...(b.version_code ? { version_code: b.version_code } : {}),
          ...(b.api_url ? { api_url: b.api_url } : {}),
          ...(b.environment ? { environment: b.environment } : {}),
        },
      });
      return parseRebuildResult(raw);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops14", "build-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["ops14", "releases"] });
    },
  });
}

/** Requested addition — verify live; graceful fallback when absent. */
export function usePrereqs() {
  return useQuery({
    queryKey: ["ops14", "prereqs"],
    queryFn: async () => {
      const raw = await apiFetch<unknown>("/api/v1/admin/builds/prereqs");
      return parsePrereqs(raw);
    },
    retry: false,
    staleTime: 60_000,
  });
}

/** Shared settings-cache read (lib/appearance): non-secret key bi.metabase_url. */
export const METABASE_URL_KEY = "bi.metabase_url";

export function useMetabaseUrl(): string | null {
  const q = useQuery({
    queryKey: ["platform-settings"],
    queryFn: readSettingsMap,
    retry: false,
    staleTime: 60_000,
  });
  const raw = q.data?.[METABASE_URL_KEY];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
