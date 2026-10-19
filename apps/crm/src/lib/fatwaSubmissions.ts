import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { EMPTY_L10N, LocalizedText, WorkflowStatus } from "./contentApi";
import { errText, parseL10n } from "./fatwa";

export { errText };

/**
 * Fatwa author panel + question clusters — Phase 10 (CRM track).
 *
 * Typed client over the Track 1 backend contract:
 *   GET  /api/v1/fatwa/submissions?status=
 *   POST /api/v1/fatwa/submissions/{id}/approve|publish|reject {note?}
 *   POST /api/v1/fatwa/submissions/{id}/add-to-rag
 *   GET  /api/v1/fatwa/clusters
 *   GET  /api/v1/fatwa/clusters/{id}
 *   POST /api/v1/fatwa/clusters/{id}/answer {answer}
 *
 * ADR-001: all parsing / defaults / API access live here, never in
 * components. The shared §9 workflow (draft → in_review → approved →
 * published) is reused here; only the backend-declared transition
 * endpoints are called.
 */

/* ------------------------------------------------------------------ */
/* fatwa submissions (scholar-author workflow board)                   */
/* ------------------------------------------------------------------ */

export const SUBMISSION_STATUSES: WorkflowStatus[] = [
  "draft",
  "in_review",
  "approved",
  "published",
];

export interface FatwaSubmission {
  id: string;
  title: LocalizedText;
  question: string;
  answer_draft: string;
  author_id: string | null;
  author_name: string | null;
  workflow_status: WorkflowStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  in_rag: boolean;
  created_at: string;
  updated_at: string;
}

function parseStatus(raw: unknown): WorkflowStatus {
  const known = ["draft", "in_review", "approved", "published", "rejected", "archived"];
  return typeof raw === "string" && known.includes(raw) ? (raw as WorkflowStatus) : "draft";
}

function str(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function optStr(raw: unknown): string | null {
  return typeof raw === "string" && raw ? raw : null;
}

export function parseSubmission(raw: unknown): FatwaSubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    title: parseL10n(r.title),
    question: str(r.question),
    answer_draft: str(r.answer_draft),
    author_id: optStr(r.author_id),
    author_name: optStr(r.author_name) ?? optStr(r.author),
    workflow_status: parseStatus(r.workflow_status ?? r.status),
    review_note: optStr(r.review_note) ?? optStr(r.note),
    reviewed_by: optStr(r.reviewed_by),
    reviewed_at: optStr(r.reviewed_at),
    in_rag: r.in_rag === true || r.added_to_rag === true,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export interface SubmissionPage {
  items: FatwaSubmission[];
  next_cursor: string | null;
}

export const FATSUB_KEY = ["fatwa-submissions"];

export function useFatwaSubmissions(status?: string, cursor?: string) {
  return useQuery({
    queryKey: [...FATSUB_KEY, status ?? "", cursor ?? ""],
    queryFn: async (): Promise<SubmissionPage> => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      const qs = params.toString();
      const raw = await apiFetch<unknown>(
        `/api/v1/fatwa/submissions${qs ? `?${qs}` : ""}`,
      );
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : [];
      return {
        items: items.map(parseSubmission).filter((x): x is FatwaSubmission => x !== null),
        next_cursor: typeof r.next_cursor === "string" ? r.next_cursor : null,
      };
    },
    retry: false,
  });
}

function useSubmissionAction(path: "approve" | "publish" | "reject") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiFetch<unknown>(`/api/v1/fatwa/submissions/${id}/${path}`, {
        method: "POST",
        body: note ? { note } : {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FATSUB_KEY });
    },
  });
}

export const useApproveSubmission = () => useSubmissionAction("approve");
export const usePublishSubmission = () => useSubmissionAction("publish");
export const useRejectSubmission = () => useSubmissionAction("reject");

export function useAddSubmissionToRag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/fatwa/submissions/${id}/add-to-rag`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FATSUB_KEY });
    },
  });
}

export function submissionTitle(s: FatwaSubmission, locale: string): string {
  const l = s.title as LocalizedText & Record<string, string>;
  return (
    l[locale] ||
    s.title.fa ||
    s.title.en ||
    (s.question ? s.question.replace(/\s+/g, " ").slice(0, 60) : s.id.slice(0, 8))
  );
}

/* ------------------------------------------------------------------ */
/* question clusters                                                   */
/* ------------------------------------------------------------------ */

export type ClusterStatus = "open" | "answered";

export interface FatwaCluster {
  id: string;
  representative_question: string;
  member_count: number;
  status: ClusterStatus;
  answered_at: string | null;
}

export interface ClusterMember {
  id: string;
  question: string;
  asker: string | null;
  asked_at: string;
}

export interface FatwaClusterDetail extends FatwaCluster {
  members: ClusterMember[];
  answer_text: string | null;
  answered_by: string | null;
}

function parseClusterStatus(raw: unknown): ClusterStatus {
  return raw === "answered" ? "answered" : "open";
}

export function parseCluster(raw: unknown): FatwaCluster | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    representative_question:
      typeof r.representative_question === "string" ? r.representative_question : "",
    member_count: typeof r.member_count === "number" ? r.member_count : 0,
    status: parseClusterStatus(r.status),
    answered_at: typeof r.answered_at === "string" ? r.answered_at : null,
  };
}

function parseMember(raw: unknown): ClusterMember | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const asker =
    typeof r.asker === "string"
      ? r.asker
      : typeof r.asker_name === "string"
        ? r.asker_name
        : typeof r.user_label === "string"
          ? r.user_label
          : null;
  return {
    id: r.id,
    question: typeof r.question === "string" ? r.question : "",
    asker,
    asked_at: typeof r.asked_at === "string" ? r.asked_at : "",
  };
}

export function parseClusterDetail(raw: unknown): FatwaClusterDetail | null {
  const base = parseCluster(raw);
  if (!base || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const members = Array.isArray(r.members) ? r.members : [];
  return {
    ...base,
    members: members.map(parseMember).filter((m): m is ClusterMember => m !== null),
    answer_text:
      typeof r.answer_text === "string"
        ? r.answer_text
        : typeof r.answer === "string"
          ? r.answer
          : null,
    answered_by: typeof r.answered_by === "string" ? r.answered_by : null,
  };
}

export const CLUSTER_KEY = ["fatwa-clusters"];

export function useFatwaClusters() {
  return useQuery({
    queryKey: CLUSTER_KEY,
    queryFn: async (): Promise<FatwaCluster[]> => {
      const raw = await apiFetch<unknown>("/api/v1/fatwa/clusters");
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      return items.map(parseCluster).filter((x): x is FatwaCluster => x !== null);
    },
    retry: false,
  });
}

export function useFatwaCluster(id: string | null) {
  return useQuery({
    queryKey: [...CLUSTER_KEY, id ?? ""],
    queryFn: async (): Promise<FatwaClusterDetail> => {
      const raw = await apiFetch<unknown>(`/api/v1/fatwa/clusters/${id}`);
      const detail = parseClusterDetail(raw);
      if (!detail) throw new Error("bad cluster payload");
      return detail;
    },
    enabled: id !== null,
    retry: false,
  });
}

export function useAnswerCluster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) =>
      apiFetch<unknown>(`/api/v1/fatwa/clusters/${id}/answer`, {
        method: "POST",
        body: { answer },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLUSTER_KEY });
    },
  });
}

export { EMPTY_L10N };
