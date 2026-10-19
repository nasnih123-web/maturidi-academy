import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { errText } from "./quran";

export { errText };

/**
 * Moderation service — Phase 10 (CRM track).
 *
 * Typed client over the Track 1 backend contract:
 *   GET  /api/v1/admin/social/reports?status=
 *   POST /api/v1/admin/social/reports/{id}/action {action, note}
 *   GET/POST /api/v1/moderation/banned-words
 *   DELETE /api/v1/moderation/banned-words/{id}
 *
 * ADR-001: all parsing / defaults / SLA math live here, never in
 * components. The audit timeline below is derived from the report's own
 * lifecycle fields (reported_at / triaged_at / actioned_at) that the
 * contract returns — no invented endpoints.
 */

/* ------------------------------------------------------------------ */
/* social reports                                                      */
/* ------------------------------------------------------------------ */

export const REPORT_STATUSES = ["open", "triaged", "dismissed", "actioned"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ["triage", "dismiss", "remove_content", "warn_user"] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export interface SocialReport {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  reporter: string | null;
  status: ReportStatus;
  reported_at: string;
  triaged_at: string | null;
  actioned_at: string | null;
  sla_due_at: string | null;
  overdue: boolean;
  /** Last moderator note, if the backend returns one (optional). */
  note: string | null;
}

function pickString(raw: unknown, ...keys: string[]): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function parseReportStatus(raw: unknown): ReportStatus {
  return typeof raw === "string" && (REPORT_STATUSES as readonly string[]).includes(raw)
    ? (raw as ReportStatus)
    : "open";
}

function parseReporter(raw: unknown): string | null {
  if (typeof raw === "string") return raw || null;
  return pickString(raw, "display_name", "full_name", "name", "email", "id");
}

export function parseReport(raw: unknown): SocialReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    target_type: typeof r.target_type === "string" ? r.target_type : "post",
    target_id: typeof r.target_id === "string" ? r.target_id : "",
    reason: typeof r.reason === "string" ? r.reason : "",
    // Task contract names it `reporter`; the Track 1 backend (social/schemas.py)
    // ships it as `reported_by` (UUID string). Accept both — integration-safe.
    reporter: parseReporter(r.reporter) ?? parseReporter(r.reported_by),
    status: parseReportStatus(r.status),
    reported_at: typeof r.reported_at === "string" ? r.reported_at : "",
    triaged_at: typeof r.triaged_at === "string" ? r.triaged_at : null,
    actioned_at: typeof r.actioned_at === "string" ? r.actioned_at : null,
    sla_due_at: typeof r.sla_due_at === "string" ? r.sla_due_at : null,
    overdue: r.overdue === true,
    note: pickString(r, "note", "last_note", "review_note"),
  };
}

export interface ReportPage {
  items: SocialReport[];
  next_cursor: string | null;
}

export const REPORT_KEY = ["social-reports"];

export function useReports(status?: string, cursor?: string) {
  return useQuery({
    queryKey: [...REPORT_KEY, status ?? "", cursor ?? ""],
    queryFn: async (): Promise<ReportPage> => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      const qs = params.toString();
      const raw = await apiFetch<unknown>(
        `/api/v1/admin/social/reports${qs ? `?${qs}` : ""}`,
      );
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : [];
      return {
        items: items.map(parseReport).filter((x): x is SocialReport => x !== null),
        next_cursor: typeof r.next_cursor === "string" ? r.next_cursor : null,
      };
    },
    retry: false,
  });
}

export interface ReportActionBody {
  action: ReportAction;
  note: string;
}

export function useActOnReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReportActionBody }) =>
      apiFetch<unknown>(`/api/v1/admin/social/reports/${id}/action`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REPORT_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* SLA helpers (pure — components only render the strings)              */
/* ------------------------------------------------------------------ */

/** Milliseconds until the SLA deadline; null when the report has no deadline. */
export function slaRemainingMs(report: SocialReport, nowMs?: number): number | null {
  if (!report.sla_due_at) return null;
  const due = Date.parse(report.sla_due_at);
  if (Number.isNaN(due)) return null;
  return due - (nowMs ?? Date.now());
}

/**
 * Localized countdown label. Negative ms = overdue. Uses only i18n strings —
 * no hardcoded user-visible text (§15.4 / dict convention).
 */
export function formatSlaCountdown(t: (k: string) => string, ms: number): string {
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${t("social10.unitH")}`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} ${t("social10.unitM")}`);
  const span = parts.join(" ");
  return ms >= 0 ? `${span} ${t("social10.slaLeft")}` : `${t("social10.slaOverdue")} ${span}`;
}

export interface AuditStep {
  key: "reported" | "triaged" | "actioned";
  at: string;
}

/** Lifecycle timeline derived from the contract's own timestamp fields. */
export function reportAuditTrail(report: SocialReport): AuditStep[] {
  const steps: AuditStep[] = [];
  if (report.reported_at) steps.push({ key: "reported", at: report.reported_at });
  if (report.triaged_at) steps.push({ key: "triaged", at: report.triaged_at });
  if (report.actioned_at) steps.push({ key: "actioned", at: report.actioned_at });
  return steps;
}

/* ------------------------------------------------------------------ */
/* banned words                                                        */
/* ------------------------------------------------------------------ */

export interface BannedWord {
  id: string;
  word: string;
  scope: string;
  created_at: string;
  created_by: string | null;
}

export function parseBannedWord(raw: unknown): BannedWord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const word = pickString(r, "word", "term");
  if (typeof r.id !== "string" || !r.id || !word) return null;
  return {
    id: r.id,
    word,
    scope: typeof r.scope === "string" ? r.scope : "all",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    created_by: parseReporter(r.created_by),
  };
}

export const BANNED_KEY = ["moderation-banned-words"];

export function useBannedWords() {
  return useQuery({
    queryKey: BANNED_KEY,
    queryFn: async (): Promise<BannedWord[]> => {
      const raw = await apiFetch<unknown>("/api/v1/moderation/banned-words");
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      return items.map(parseBannedWord).filter((x): x is BannedWord => x !== null);
    },
    retry: false,
  });
}

export function useAddBannedWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (word: string) =>
      apiFetch<unknown>("/api/v1/moderation/banned-words", {
        method: "POST",
        body: { word },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BANNED_KEY });
    },
  });
}

export function useDeleteBannedWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/moderation/banned-words/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BANNED_KEY });
    },
  });
}
