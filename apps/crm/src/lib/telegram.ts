import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { errText } from "./library";

/**
 * Phase 11 (CRM) — Telegram account connect, channel import, distribution.
 *
 * Management-plane client over the real Phase-11 backend contract:
 * - GET    /api/v1/telegram/connect/status
 * - POST   /api/v1/telegram/connect/request-code      {phone}
 * - POST   /api/v1/telegram/connect/confirm-code      {phone, code, password?}
 * - POST   /api/v1/telegram/connect/disconnect
 * - POST   /api/v1/telegram/import                    {channel, limit}
 *          → {enqueued, channel, limit} (ARQ job; progress is polled as a
 *            proxy via the admin library list: imported items land with
 *            source_type=telegram_import, status=in_review)
 * - GET    /api/v1/telegram/distribute/policies            (list, per content_type)
 * - PUT    /api/v1/telegram/distribute/policies/{content_type}
 * - POST   /api/v1/telegram/distribute/publish
 *          {content_type, content_id, targets?, idempotency_key?}
 * - GET    /api/v1/telegram/distribute/log?content_type=&status=&limit=
 * - POST   /api/v1/telegram/distribute/retry/{published_id}
 * - POST   /api/v1/telegram/distribute/revoke/{published_id}
 *
 * NOTE: the backend has no per-job import progress or cancel endpoint —
 * ARQ jobs cannot be cancelled mid-run. The import tab polls the admin
 * library list as an honest progress proxy and says so in the UI.
 *
 * CONTRACT §14 / §3: session strings and bot tokens are NEVER surfaced here —
 * the backend returns only a masked phone; this module never reads or
 * displays any credential value.
 */

export { errText };

export type TelegramPolicy = "never" | "manual" | "auto" | "scheduled";

export const TELEGRAM_POLICIES: TelegramPolicy[] = [
  "never",
  "manual",
  "auto",
  "scheduled",
];

export function parseTelegramPolicy(v: unknown): TelegramPolicy {
  return TELEGRAM_POLICIES.includes(v as TelegramPolicy)
    ? (v as TelegramPolicy)
    : "never";
}

/**
 * Backend policy vocabulary: "never" | "manual_approval" | "auto_publish" | "scheduled".
 * The CRM-facing type stays short ("manual"/"auto"); these map both ways so the
 * components never see backend spellings.
 */
export function toBackendPolicy(p: TelegramPolicy): string {
  return p === "manual" ? "manual_approval" : p === "auto" ? "auto_publish" : p;
}

export function fromBackendPolicy(v: unknown): TelegramPolicy {
  if (v === "manual_approval") return "manual";
  if (v === "auto_publish") return "auto";
  return parseTelegramPolicy(v);
}

/* ------------------------------------------------------------------ */
/* Account connect (2-step)                                            */
/* ------------------------------------------------------------------ */

export interface TelegramConnectStatus {
  connected: boolean;
  /** Masked phone only, e.g. "+98 *** *** 1234". Never a session string. */
  masked_phone: string | null;
}

export const TG_STATUS_KEY = ["telegram", "connect-status"] as const;

export function useTelegramStatus() {
  return useQuery({
    queryKey: TG_STATUS_KEY,
    queryFn: () =>
      apiFetch<TelegramConnectStatus>("/api/v1/telegram/connect/status"),
  });
}

export interface RequestCodeResult {
  ok: boolean;
  /** true when the account has 2FA enabled and a password will be needed. */
  requires_2fa: boolean;
}

export function useRequestConnectCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) =>
      apiFetch<RequestCodeResult>("/api/v1/telegram/connect/request-code", {
        method: "POST",
        body: { phone },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TG_STATUS_KEY });
    },
  });
}

export function useConfirmConnectCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { phone: string; code: string; password?: string }) =>
      apiFetch<{ ok: boolean; connected: boolean; masked_phone: string | null }>(
        "/api/v1/telegram/connect/confirm-code",
        { method: "POST", body: payload },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TG_STATUS_KEY });
    },
  });
}

export function useDisconnectTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>("/api/v1/telegram/connect/disconnect", {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TG_STATUS_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Channel import (Telethon job)                                       */
/* ------------------------------------------------------------------ */

export type ImportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TelegramImportJob {
  job_id: string;
  status: ImportJobStatus;
  channel: string;
  processed: number;
  total: number | null;
  current_item: string | null;
  errors: string[];
}

export function importJobKey(jobId: string): readonly string[] {
  return ["telegram", "import-job", jobId] as const;
}

export interface StartImportResult {
  job_id: string;
  channel: string;
  limit: number;
  enqueued: boolean;
}

export function useStartChannelImport() {
  return useMutation({
    mutationFn: async (payload: { channel: string; limit: number }) => {
      const res = await apiFetch<{ enqueued: boolean; channel: string; limit: number }>(
        "/api/v1/telegram/import",
        { method: "POST", body: payload },
      );
      // The backend enqueues an ARQ job and returns no job id; the channel
      // name is the stable handle for progress polling below.
      const out: StartImportResult = {
        job_id: res.channel,
        channel: res.channel,
        limit: res.limit,
        enqueued: res.enqueued,
      };
      return out;
    },
  });
}

interface AdminLibraryItem {
  id: string;
  source_ref?: { channel?: string; message_id?: number } | null;
}

/**
 * Progress proxy: the backend has no per-job import status endpoint, so we
 * poll the admin library list — imported items land with
 * source_type=telegram_import, status=in_review — and count the ones whose
 * source_ref.channel matches. Honest by construction: it shows what actually
 * arrived, not a synthetic percentage.
 */
export function useImportJob(channel: string | null, limit: number) {
  return useQuery({
    queryKey: importJobKey(channel ?? "none"),
    queryFn: async (): Promise<TelegramImportJob> => {
      const params = new URLSearchParams({
        status: "in_review",
        source_type: "telegram_import",
        limit: "100",
      });
      const payload = await apiFetch<{ items: AdminLibraryItem[] }>(
        `/api/v1/admin/library/items?${params.toString()}`,
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      const mine = items.filter(
        (it) => it.source_ref?.channel === channel,
      );
      const processed = mine.length;
      const job: TelegramImportJob = {
        job_id: channel ?? "",
        status: processed > 0 ? "running" : "queued",
        channel: channel ?? "",
        processed,
        total: limit,
        current_item: null,
        errors: [],
      };
      return job;
    },
    enabled: channel !== null,
    refetchInterval: 4000,
  });
}

/**
 * ARQ jobs cannot be cancelled mid-run and the backend exposes no cancel
 * endpoint — so there is intentionally no cancel mutation. The import tab
 * says this plainly instead of pretending.
 */

/* ------------------------------------------------------------------ */
/* Distribution policy (per content TYPE — backend contract §9.5)       */
/* ------------------------------------------------------------------ */

export interface TelegramDistributionConfig {
  content_type: string;
  content_id: string;
  policy: TelegramPolicy;
  /** Message template (placeholders documented server-side). */
  message_template: string;
  caption_template: string;
  channels: string[];
  /** ISO 8601; only meaningful when policy === "scheduled". */
  schedule_at: string | null;
  /** Seconds between posts when fanning out to multiple channels. */
  spacing_seconds: number;
  require_approval: boolean;
  updated_at: string | null;
}

interface BackendPolicy {
  id: string;
  content_type: string;
  policy: string;
  message_template: Record<string, string> | null;
  target_channels: string[];
  spacing_seconds: number;
  require_approval: boolean;
  schedule_config: Record<string, string> | null;
  updated_at: string | null;
}

function policyToConfig(
  contentType: string,
  contentId: string,
  p: BackendPolicy | null,
): TelegramDistributionConfig {
  if (!p) {
    return {
      content_type: contentType,
      content_id: contentId,
      policy: "never",
      message_template: "",
      caption_template: "",
      channels: [],
      schedule_at: null,
      spacing_seconds: 0,
      require_approval: false,
      updated_at: null,
    };
  }
  const tpl = p.message_template ?? {};
  return {
    content_type: p.content_type,
    content_id: contentId,
    policy: fromBackendPolicy(p.policy),
    message_template: typeof tpl.fa === "string" ? tpl.fa : "",
    caption_template:
      typeof tpl.caption_fa === "string" ? tpl.caption_fa : "",
    channels: p.target_channels ?? [],
    schedule_at:
      typeof p.schedule_config?.at === "string" ? p.schedule_config.at : null,
    spacing_seconds: p.spacing_seconds ?? 0,
    require_approval: p.require_approval ?? false,
    updated_at: p.updated_at,
  };
}

function configToBackendBody(cfg: TelegramDistributionConfig) {
  return {
    policy: toBackendPolicy(cfg.policy),
    message_template: {
      fa: cfg.message_template,
      caption_fa: cfg.caption_template,
    },
    target_channels: cfg.channels,
    spacing_seconds: cfg.spacing_seconds,
    require_approval: cfg.require_approval,
    schedule_config: cfg.schedule_at ? { at: cfg.schedule_at } : null,
  };
}

export function distributionKey(
  contentType: string,
  contentId: string,
): readonly string[] {
  return ["telegram", "distribution", contentType, contentId] as const;
}

export function useTelegramDistribution(
  contentType: string,
  contentId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: distributionKey(contentType, contentId),
    queryFn: async () => {
      const list = await apiFetch<BackendPolicy[]>(
        "/api/v1/telegram/distribute/policies",
      );
      const found = Array.isArray(list)
        ? list.find((p) => p.content_type === contentType) ?? null
        : null;
      return policyToConfig(contentType, contentId, found);
    },
    enabled,
  });
}

export function useSaveTelegramDistribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cfg: TelegramDistributionConfig) => {
      const saved = await apiFetch<BackendPolicy>(
        `/api/v1/telegram/distribute/policies/${encodeURIComponent(cfg.content_type)}`,
        { method: "PUT", body: configToBackendBody(cfg) },
      );
      return policyToConfig(cfg.content_type, cfg.content_id, saved);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({
        queryKey: distributionKey(saved.content_type, saved.content_id),
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Publish history + retry                                             */
/* ------------------------------------------------------------------ */

export type PublishLogStatus = "pending" | "sent" | "failed" | "cancelled" | "notified" | "revoked";

export interface TelegramPublishLog {
  id: string;
  content_type: string;
  content_id: string;
  target_channel: string;
  message_id: number | null;
  status: PublishLogStatus;
  error: string | null;
  sent_at: string | null;
}

interface BackendPublished {
  id: string;
  source_content_type: string;
  source_content_id: string;
  distribution_target: string;
  published_message_id: number | null;
  status: string;
  error: string | null;
  sent_at: string | null;
}

function publishedToLog(p: BackendPublished): TelegramPublishLog {
  return {
    id: p.id,
    content_type: p.source_content_type,
    content_id: p.source_content_id,
    target_channel: p.distribution_target,
    message_id: p.published_message_id,
    status: p.status as PublishLogStatus,
    error: p.error,
    sent_at: p.sent_at,
  };
}

export function publishHistoryKey(
  contentType: string,
  contentId: string,
): readonly string[] {
  return ["telegram", "publish-history", contentType, contentId] as const;
}

export function useTelegramPublishHistory(
  contentType: string,
  contentId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: publishHistoryKey(contentType, contentId),
    queryFn: async () => {
      const params = new URLSearchParams({
        content_type: contentType,
        limit: "200",
      });
      const payload = await apiFetch<{ items: BackendPublished[] }>(
        `/api/v1/telegram/distribute/log?${params.toString()}`,
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      // The backend log is per content_type; narrow to this content item.
      return items
        .filter((p) => p.source_content_id === contentId)
        .map(publishedToLog);
    },
    enabled,
  });
}

export function useRetryTelegramPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (logId: string) =>
      apiFetch<BackendPublished>(
        `/api/v1/telegram/distribute/retry/${encodeURIComponent(logId)}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["telegram", "publish-history"] });
    },
  });
}

/**
 * Manual one-off publish. The backend enqueues it immediately (idempotent on
 * a generated key) — deferred scheduling is done via the policy's
 * "scheduled" + schedule_at, not here.
 */
export function useScheduleTelegramPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      content_type: string;
      content_id: string;
      channel: string;
      schedule_at: string | null;
    }) =>
      apiFetch<BackendPublished[]>("/api/v1/telegram/distribute/publish", {
        method: "POST",
        body: {
          content_type: payload.content_type,
          content_id: payload.content_id,
          targets: [payload.channel],
          idempotency_key:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${payload.content_type}:${payload.content_id}:${payload.channel}:${Date.now()}`,
        },
      }),
    onSuccess: (_, p) => {
      void qc.invalidateQueries({
        queryKey: publishHistoryKey(p.content_type, p.content_id),
      });
    },
  });
}
