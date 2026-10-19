import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { MADHABS } from "./fatwa";
import { errText } from "./quran";

export { MADHABS, errText };

/**
 * Calculator rule-config service — Phase 7 (CRM track).
 *
 * Typed client over the Track 1 backend contract:
 *   GET    /api/v1/admin/calculators/rules?kind=inheritance|zakat
 *   POST   /api/v1/admin/calculators/rules            (perm calculators.manage)
 *   PATCH  /api/v1/admin/calculators/rules/{id}       (new version row, history kept)
 *   POST   /api/v1/admin/calculators/rules/{id}/submit  (draft → pending_review)
 *   POST   /api/v1/admin/calculators/rules/{id}/review   {decision, note}
 *          (perm calculators.approve, scholar_author role)
 *   GET    /api/v1/admin/calculators/rules/{id}/history
 *   GET    /api/v1/admin/calculators/audit             (follows the fatwa audit
 *          pattern — §14: secrets are never stored in audit values, only
 *          displayed as returned)
 *
 * Contract §15.6 / ADR-0002: all parsing, defaults and API access live
 * here, never in components. §15.4 (hard rule): no fiqh tables are
 * hardcoded or invented anywhere on this client — rule_data is entered
 * by an admin as opaque JSON and reviewed by a scholar before it can
 * ever take part in a public calculation.
 */

/* ------------------------------------------------------------------ */
/* shared shapes                                                       */
/* ------------------------------------------------------------------ */

export type RuleType = "inheritance" | "zakat";

export const RULE_TYPES: RuleType[] = ["inheritance", "zakat"];

export type RuleStatus = "draft" | "pending_review" | "approved" | "rejected";

export const RULE_STATUSES: RuleStatus[] = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
];

export interface RuleConfig {
  id: string;
  rule_type: RuleType;
  madhab: string;
  source: string;
  version: number;
  status: RuleStatus;
  effective_from: string | null;
  effective_to: string | null;
  approved_by: string | null;
  approved_at: string | null;
  change_reason: string | null;
  rule_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function parseRuleType(raw: unknown): RuleType {
  return raw === "zakat" ? "zakat" : "inheritance";
}

// Backend serializes the discriminator as `kind` (see _rule_to_dict);
// accept both wire names.
function parseRuleKind(r: Record<string, unknown>): RuleType {
  return parseRuleType(r.rule_type ?? r.kind);
}

function parseRuleStatus(raw: unknown): RuleStatus {
  return typeof raw === "string" && (RULE_STATUSES as string[]).includes(raw)
    ? (raw as RuleStatus)
    : "draft";
}

function parseDateStr(raw: unknown): string | null {
  return typeof raw === "string" && raw ? raw : null;
}

export function parseRuleConfig(raw: unknown): RuleConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const rule_data =
    r.rule_data && typeof r.rule_data === "object" && !Array.isArray(r.rule_data)
      ? (r.rule_data as Record<string, unknown>)
      : {};
  return {
    id: r.id,
    rule_type: parseRuleKind(r),
    madhab: typeof r.madhab === "string" ? r.madhab : "",
    source: typeof r.source === "string" ? r.source : "",
    version: typeof r.version === "number" ? r.version : 1,
    status: parseRuleStatus(r.status),
    effective_from: parseDateStr(r.effective_from),
    effective_to: parseDateStr(r.effective_to),
    approved_by: typeof r.approved_by === "string" ? r.approved_by : null,
    approved_at: parseDateStr(r.approved_at),
    change_reason: typeof r.change_reason === "string" ? r.change_reason : null,
    rule_data,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

function parseList(raw: unknown): RuleConfig[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
  return items
    .map(parseRuleConfig)
    .filter((x): x is RuleConfig => x !== null);
}

/**
 * Localized status label — falls back to the raw status when the
 * `status.*` key is missing in the dictionary.
 */
export function statusLabel(t: (k: string) => string, s: string): string {
  const k = t(`status.${s}`);
  return k === `status.${s}` ? s : k;
}

/* ------------------------------------------------------------------ */
/* rule configs — read                                                 */
/* ------------------------------------------------------------------ */

export const RULES_KEY = ["calculator-rules"];

export function useRuleConfigs(type: RuleType) {
  return useQuery({
    queryKey: [...RULES_KEY, type],
    queryFn: async (): Promise<RuleConfig[]> => {
      const raw = await apiFetch<unknown>(
        `/api/v1/admin/calculators/rules?kind=${encodeURIComponent(type)}`,
      );
      return parseList(raw);
    },
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* rule configs — write (always a NEW draft version, never overwrite)  */
/* ------------------------------------------------------------------ */

/** Create body. `version` is assigned by the backend — never sent. */
export interface CreateRuleBody {
  rule_type: RuleType;
  madhab: string;
  source: string;
  effective_from?: string | null;
  effective_to?: string | null;
  change_reason?: string;
  rule_data: Record<string, unknown>;
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRuleBody) =>
      apiFetch<unknown>("/api/v1/admin/calculators/rules", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

/** Edit body. PATCH creates a NEW version row — history is never rewritten. */
export interface UpdateRuleBody {
  madhab?: string;
  source?: string;
  effective_from?: string | null;
  effective_to?: string | null;
  change_reason?: string;
  rule_data?: Record<string, unknown>;
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRuleBody }) =>
      apiFetch<unknown>(`/api/v1/admin/calculators/rules/${id}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

export function useSubmitRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/admin/calculators/rules/${id}/submit`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* review (scholar_author)                                             */
/* ------------------------------------------------------------------ */

export type ReviewDecision = "approve" | "reject";

export function useReviewRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: ReviewDecision;
      note: string;
    }) =>
      apiFetch<unknown>(`/api/v1/admin/calculators/rules/${id}/review`, {
        method: "POST",
        body: { decision, note },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* version history                                                     */
/* ------------------------------------------------------------------ */

export function useRuleHistory(id: string | null) {
  return useQuery({
    queryKey: [...RULES_KEY, "history", id],
    queryFn: async (): Promise<RuleConfig[]> => {
      const raw = await apiFetch<unknown>(
        `/api/v1/admin/calculators/rules/${id}/history`,
      );
      return parseList(raw);
    },
    enabled: id !== null,
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* audit (§14) — read only, never write secrets                        */
/* ------------------------------------------------------------------ */

export interface CalculatorAuditEntry {
  id: string;
  actor_id: string | null;
  actor_type: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  request_id: string | null;
  created_at: string;
  summary: string | null;
}

function parseAuditEntry(raw: unknown): CalculatorAuditEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  return {
    id: typeof e.id === "string" ? e.id : "",
    actor_id: typeof e.actor_id === "string" ? e.actor_id : null,
    actor_type: typeof e.actor_type === "string" ? e.actor_type : null,
    action: typeof e.action === "string" ? e.action : "",
    entity_type: typeof e.entity_type === "string" ? e.entity_type : null,
    entity_id: typeof e.entity_id === "string" ? e.entity_id : null,
    ip: typeof e.ip === "string" ? e.ip : null,
    request_id: typeof e.request_id === "string" ? e.request_id : null,
    created_at: typeof e.created_at === "string" ? e.created_at : "",
    summary: typeof e.summary === "string" ? e.summary : null,
  };
}

export const CALC_AUDIT_KEY = ["calculator-audit"];

export function useCalculatorAudit(limit = 100) {
  return useQuery({
    queryKey: [...CALC_AUDIT_KEY, limit],
    queryFn: async (): Promise<CalculatorAuditEntry[]> => {
      const raw = await apiFetch<unknown>(
        `/api/v1/admin/calculators/audit?limit=${limit}`,
      );
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items)
        ? r.items
        : Array.isArray(raw)
          ? raw
          : [];
      return items
        .map(parseAuditEntry)
        .filter((x): x is CalculatorAuditEntry => x !== null);
    },
    retry: false,
  });
}
