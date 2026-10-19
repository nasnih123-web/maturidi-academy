import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { errText } from "./library";

/**
 * Phase 11 Track 3 (CRM) — API keys for embeddable widgets + embed generator.
 *
 * Management-plane client over the Track 1 backend contract:
 * - GET    /api/v1/api-keys
 * - POST   /api/v1/api-keys               {name, scopes, rate_limit_per_min, quota_monthly}
 *                                          → {key: <shown once>, api_key}
 * - PATCH  /api/v1/api-keys/{id}          {is_active}
 * - DELETE /api/v1/api-keys/{id}          (revoke)
 * - GET    /api/v1/api-keys/{id}/usage
 *
 * Public widget endpoints are `/api/v1/widgets/*` (public CORS, contract).
 */

export { errText };

/** Scopes that match the embeddable widget kinds (spec § widgets). */
export type WidgetScope = "prayer-times" | "ayah" | "fatwa" | "zakat";

export const WIDGET_SCOPES: WidgetScope[] = [
  "prayer-times",
  "ayah",
  "fatwa",
  "zakat",
];

export type WidgetKind = WidgetScope;

export const WIDGET_KINDS: WidgetKind[] = WIDGET_SCOPES;

export function parseScopes(v: unknown): WidgetScope[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is WidgetScope => WIDGET_SCOPES.includes(s));
}

export interface ApiKey {
  id: string;
  name: string;
  scopes: WidgetScope[];
  rate_limit_per_min: number;
  quota_monthly: number | null;
  is_active: boolean;
  usage_total: number;
  usage_monthly: number;
  last_used_at: string | null;
  /** Redacted preview, e.g. "mk_…a3f9". Never the full secret. */
  key_preview: string;
  created_at: string;
}

export const API_KEYS_KEY = ["api-keys"] as const;

function normalizeKey(row: Record<string, unknown>): ApiKey {
  return {
    id: String(row["id"] ?? ""),
    name: String(row["name"] ?? ""),
    scopes: parseScopes(row["scopes"]),
    rate_limit_per_min: Number(row["rate_limit_per_min"] ?? 60),
    quota_monthly:
      row["quota_monthly"] === null || row["quota_monthly"] === undefined
        ? null
        : Number(row["quota_monthly"]),
    is_active: row["is_active"] !== false,
    usage_total: Number(row["usage_total"] ?? row["usage_count"] ?? 0),
    usage_monthly: Number(row["usage_monthly"] ?? 0),
    last_used_at:
      row["last_used_at"] === null || row["last_used_at"] === undefined
        ? null
        : String(row["last_used_at"]),
    key_preview: String(row["key_preview"] ?? ""),
    created_at: String(row["created_at"] ?? ""),
  };
}

function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

export function useApiKeys() {
  return useQuery({
    queryKey: API_KEYS_KEY,
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/api/v1/api-keys");
      return asArray<Record<string, unknown>>(payload).map(normalizeKey);
    },
  });
}

export interface CreatedApiKey {
  /** The full secret — shown once, never stored anywhere after display. */
  key: string;
  api_key: ApiKey;
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      scopes: WidgetScope[];
      rate_limit_per_min: number;
      quota_monthly: number | null;
    }) =>
      apiFetch<Record<string, unknown>>("/api/v1/api-keys", {
        method: "POST",
        body,
      }).then((row) => ({
        key: String(row["key"] ?? ""),
        api_key: normalizeKey(
          (row["api_key"] as Record<string, unknown>) ?? row,
        ),
      })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: API_KEYS_KEY });
    },
  });
}

export function useToggleApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/api-keys/${encodeURIComponent(id)}`,
        { method: "PATCH", body: { is_active } },
      ).then(normalizeKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: API_KEYS_KEY });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/api-keys/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: API_KEYS_KEY });
    },
  });
}

export interface ApiKeyUsage {
  total: number;
  monthly: number;
  by_day: { day: string; count: number }[];
}

/**
 * Usage counters. ASSUMPTION (flagged for Track 1 confirmation):
 * GET /api/v1/api-keys/{id}/usage → {total, monthly, by_day:[{day,count}]}.
 * The list view already shows total/monthly counters; this is for detail.
 */
export function useApiKeyUsage(keyId: string | null) {
  return useQuery({
    queryKey: [...API_KEYS_KEY, "usage", keyId],
    queryFn: () =>
      apiFetch<ApiKeyUsage>(
        `/api/v1/api-keys/${encodeURIComponent(keyId as string)}/usage`,
      ),
    enabled: keyId !== null,
  });
}

/* ------------------------------------------------------------------ */
/* Embed generator (pure formatting — no business logic)               */
/* ------------------------------------------------------------------ */

export interface EmbedOptions {
  /** Host of the public API, without trailing slash. */
  apiBase: string;
  locale?: "fa" | "ar" | "en";
  theme?: "dark" | "light";
}

/**
 * Copyable snippets that embed a widget on any external site.
 * Iframe is the default (isolated); the script tag is a compact alternative
 * that renders the same widget surface. Presentation-only formatting.
 */
export function buildEmbedSnippet(
  widget: WidgetKind,
  keyPreviewOrKey: string,
  opts: EmbedOptions,
): { iframe: string; script: string; url: string } {
  const base = opts.apiBase.replace(/\/$/, "");
  const params = new URLSearchParams({
    widget,
    key: keyPreviewOrKey,
    locale: opts.locale ?? "fa",
    theme: opts.theme ?? "dark",
  });
  const url = `${base}/api/v1/widgets/render?${params.toString()}`;
  const iframe = `<iframe src="${url}" width="100%" height="320" frameborder="0" loading="lazy" title="${widget}"></iframe>`;
  const script = `<div data-maturidi-widget="${widget}" data-maturidi-key="${keyPreviewOrKey}" data-maturidi-locale="${opts.locale ?? "fa"}"></div>\n<script async src="${base}/api/v1/widgets/embed.js"><\/script>`;
  return { iframe, script, url };
}

/** Default per-widget size hint for the live preview frame. */
export const WIDGET_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  "prayer-times": { w: 360, h: 420 },
  "ayah": { w: 360, h: 240 },
  "fatwa": { w: 360, h: 380 },
  "zakat": { w: 360, h: 460 },
};
