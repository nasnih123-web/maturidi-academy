/**
 * Phase 14 — react-query hooks for the CRM Control Center.
 *
 * Thin data layer: pages consume these hooks; they never touch `apiFetch`
 * or reason about URLs/field shapes (ADR-001/0002). Query keys are exported
 * so invalidation is explicit and SSR harnesses can pre-seed.
 *
 * Connections/builds/BI live in the sibling track's lib/ops14.ts —
 * this file covers content, users, moderation flags, notifications, roles.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BroadcastPayload,
  BulkAction,
  ContentRef,
  DistributionPolicy,
  FlagAction,
  InboxFilters,
  NotifyChannel,
  Placement,
  PlacementInput,
  actOnContentFlag,
  checkExternalSource,
  compareVersions,
  createPlacement,
  createRole,
  deletePlacement,
  deleteRole,
  getContentAudit,
  getContentCalendar,
  getContentDetail,
  getDistribution,
  getUser360,
  getUserAudit,
  listAiSources,
  listContentFlags,
  listContentInbox,
  listExternalSources,
  listItemPlacements,
  listNotificationLog,
  listPlacements,
  listRoles,
  listTelegramDedupe,
  listTelegramHistory,
  listTelegramPolicies,
  listTelegramQueue,
  listTelegramSchedule,
  listUsers,
  listVersions,
  previewBroadcast,
  reindexAiSource,
  retryTelegramMessage,
  rollbackVersion,
  runBulkAction,
  sendBroadcast,
  setRolePermissions,
  setUserRoles,
  revokeUserSessions,
  telegramQueueDecision,
  transitionContent,
  updateDistribution,
  updateExternalSource,
  updatePlacement,
  updateRole,
  updateTelegramPolicy,
  reorderPlacements,
  WorkflowStatus,
} from "./admin14";

export type ItemRef = Pick<ContentRef, "domain" | "content_type" | "id">;

export const admin14Keys = {
  all: ["admin14"] as const,
  inbox: (f: InboxFilters) => ["admin14", "inbox", JSON.stringify(f)] as const,
  detail: (ref: ItemRef) => ["admin14", "detail", ref.domain, ref.content_type, ref.id] as const,
  versions: (ref: ItemRef) => ["admin14", "versions", ref.domain, ref.content_type, ref.id] as const,
  compare: (ref: ItemRef, v: string) => ["admin14", "compare", ref.domain, ref.content_type, ref.id, v] as const,
  itemPlacements: (ref: ItemRef) => ["admin14", "item-placements", ref.domain, ref.content_type, ref.id] as const,
  placements: (surface?: string) => ["admin14", "placements", surface ?? "all"] as const,
  distribution: (ref: ItemRef) => ["admin14", "distribution", ref.domain, ref.content_type, ref.id] as const,
  calendar: (from: string, to: string) => ["admin14", "calendar", from, to] as const,
  audit: (ref: ItemRef) => ["admin14", "audit", ref.domain, ref.content_type, ref.id] as const,
  aiSources: (status?: string, scope?: string) => ["admin14", "ai-sources", status ?? "", scope ?? ""] as const,
  externalSources: ["admin14", "external-sources"] as const,
  tgPolicies: ["admin14", "telegram", "policies"] as const,
  tgQueue: ["admin14", "telegram", "queue"] as const,
  tgSchedule: ["admin14", "telegram", "schedule"] as const,
  tgHistory: ["admin14", "telegram", "history"] as const,
  tgDedupe: ["admin14", "telegram", "dedupe"] as const,
  users: (f: { q?: string; role?: string }) => ["admin14", "users", JSON.stringify(f)] as const,
  user360: (id: string) => ["admin14", "user360", id] as const,
  userAudit: (id: string) => ["admin14", "user-audit", id] as const,
  flags: (status?: string) => ["admin14", "flags", status ?? "all"] as const,
  notifyLog: ["admin14", "notify-log"] as const,
  roles: ["admin14", "roles"] as const,
};

/* ---------------- content ---------------- */

export function useInbox(filters: InboxFilters) {
  return useQuery({
    queryKey: admin14Keys.inbox(filters),
    queryFn: () => listContentInbox(filters),
    staleTime: 15_000,
    retry: false,
  });
}

export function useContentDetail(ref: ItemRef | null) {
  return useQuery({
    queryKey: admin14Keys.detail(ref ?? { domain: "none", content_type: "none", id: "none" }),
    queryFn: () => getContentDetail(ref as ItemRef),
    enabled: ref !== null,
    retry: false,
  });
}

export function useVersions(ref: ItemRef | null) {
  return useQuery({
    queryKey: admin14Keys.versions(ref ?? { domain: "none", content_type: "none", id: "none" }),
    queryFn: () => listVersions(ref as ItemRef),
    enabled: ref !== null,
    retry: false,
  });
}

export function useCompare(ref: ItemRef | null, versionId: string | null) {
  return useQuery({
    queryKey: admin14Keys.compare(ref ?? { domain: "none", content_type: "none", id: "none" }, versionId ?? "none"),
    queryFn: () => compareVersions(ref as ItemRef, versionId as string),
    enabled: ref !== null && versionId !== null,
    retry: false,
  });
}

export function useContentMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: admin14Keys.all });
  };
  const transition = useMutation({
    mutationFn: ({ ref, to, note }: { ref: ItemRef; to: WorkflowStatus; note?: string }) =>
      transitionContent(ref, to, note),
    onSettled: invalidate,
  });
  const rollback = useMutation({
    mutationFn: ({ ref, versionId }: { ref: ItemRef; versionId: string }) =>
      rollbackVersion(ref, versionId),
    onSettled: invalidate,
  });
  const bulk = useMutation({
    mutationFn: ({ action, refs, payload }: { action: BulkAction; refs: ContentRef[]; payload?: Record<string, unknown> }) =>
      runBulkAction(action, refs, payload),
    onSettled: invalidate,
  });
  const distribution = useMutation({
    mutationFn: ({ ref, policy, scheduledAt, untilAt }: {
      ref: ItemRef; policy: DistributionPolicy; scheduledAt?: string | null; untilAt?: string | null;
    }) => updateDistribution(ref, policy, scheduledAt, untilAt),
    onSettled: invalidate,
  });
  return { transition, rollback, bulk, distribution };
}

export function useItemPlacements(ref: ItemRef | null) {
  return useQuery({
    queryKey: admin14Keys.itemPlacements(ref ?? { domain: "none", content_type: "none", id: "none" }),
    queryFn: () => listItemPlacements(ref as ItemRef),
    enabled: ref !== null,
    retry: false,
  });
}

export function usePlacements(surface?: string) {
  return useQuery({
    queryKey: admin14Keys.placements(surface),
    queryFn: () => listPlacements(surface),
    retry: false,
  });
}

export function useDistribution(ref: ItemRef | null) {
  return useQuery({
    queryKey: admin14Keys.distribution(ref ?? { domain: "none", content_type: "none", id: "none" }),
    queryFn: () => getDistribution(ref as ItemRef),
    enabled: ref !== null,
    retry: false,
  });
}

export function usePlacementMutation() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: admin14Keys.all });
  return {
    create: useMutation({
      mutationFn: (p: { ref: ItemRef; placement: PlacementInput }) => createPlacement(p.ref, p.placement),
      onSettled: invalidate,
    }),
    update: useMutation({
      mutationFn: (p: { pid: string; patch: Partial<Placement> }) => updatePlacement(p.pid, p.patch),
      onSettled: invalidate,
    }),
    remove: useMutation({
      mutationFn: (pid: string) => deletePlacement(pid),
      onSettled: invalidate,
    }),
    reorder: useMutation({
      mutationFn: (orderedIds: string[]) => reorderPlacements(orderedIds),
      onSettled: invalidate,
    }),
  };
}

export function useContentCalendar(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: admin14Keys.calendar(from, to),
    queryFn: () => getContentCalendar(from, to),
    enabled,
    retry: false,
  });
}

export function useContentAudit(ref: ItemRef | null) {
  return useQuery({
    queryKey: admin14Keys.audit(ref ?? { domain: "none", content_type: "none", id: "none" }),
    queryFn: () => getContentAudit(ref as ItemRef),
    enabled: ref !== null,
    retry: false,
  });
}

/* ---------------- AI sources / external sources ---------------- */

export function useAiSources(status?: string, scope?: string) {
  return useQuery({
    queryKey: admin14Keys.aiSources(status, scope),
    queryFn: () => listAiSources(status, scope),
    retry: false,
  });
}

export function useReindexSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: ItemRef) => reindexAiSource(ref),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin14", "ai-sources"] }),
  });
}

export function useExternalSources() {
  return useQuery({ queryKey: admin14Keys.externalSources, queryFn: listExternalSources, retry: false });
}

export function useExternalSourceMutation() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: admin14Keys.externalSources });
  return {
    update: useMutation({
      mutationFn: (p: { id: string; patch: Parameters<typeof updateExternalSource>[1] }) =>
        updateExternalSource(p.id, p.patch),
      onSettled: invalidate,
    }),
    check: useMutation({ mutationFn: (id: string) => checkExternalSource(id), onSettled: invalidate }),
  };
}

/* ---------------- telegram center ---------------- */

export function useTelegramPolicies() {
  return useQuery({ queryKey: admin14Keys.tgPolicies, queryFn: listTelegramPolicies, retry: false });
}

export function useTelegramQueue() {
  return useQuery({ queryKey: admin14Keys.tgQueue, queryFn: listTelegramQueue, retry: false });
}

export function useTelegramSchedule() {
  return useQuery({ queryKey: admin14Keys.tgSchedule, queryFn: listTelegramSchedule, retry: false });
}

export function useTelegramHistory() {
  return useQuery({ queryKey: admin14Keys.tgHistory, queryFn: listTelegramHistory, retry: false });
}

export function useTelegramDedupe() {
  return useQuery({ queryKey: admin14Keys.tgDedupe, queryFn: listTelegramDedupe, retry: false });
}

export function useTelegramMutation() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin14", "telegram"] });
  return {
    policy: useMutation({
      mutationFn: (p: { domain: string; type: string; patch: Parameters<typeof updateTelegramPolicy>[2] }) =>
        updateTelegramPolicy(p.domain, p.type, p.patch),
      onSettled: invalidate,
    }),
    decide: useMutation({
      mutationFn: (p: { id: string; approve: boolean; note?: string }) =>
        telegramQueueDecision(p.id, p.approve, p.note),
      onSettled: invalidate,
    }),
    retry: useMutation({
      mutationFn: (id: string) => retryTelegramMessage(id),
      onSettled: invalidate,
    }),
  };
}

/* ---------------- users ---------------- */

export function useUserSearch(q?: string, role?: string) {
  return useQuery({
    queryKey: admin14Keys.users({ q, role }),
    queryFn: () => listUsers({ q, role }),
    enabled: (q?.length ?? 0) > 0 || !!role,
    retry: false,
  });
}

export function useUser360(id: string | null) {
  return useQuery({
    queryKey: admin14Keys.user360(id ?? "none"),
    queryFn: () => getUser360(id as string),
    enabled: !!id,
    retry: false,
  });
}

export function useUserAuditTrail(userId: string | null) {
  return useQuery({
    queryKey: admin14Keys.userAudit(userId ?? "none"),
    queryFn: () => getUserAudit(userId as string),
    enabled: !!userId,
    retry: false,
  });
}

export function useUserAdminMutation() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: admin14Keys.all });
  return {
    setRoles: useMutation({
      mutationFn: (p: { id: string; roles: string[] }) => setUserRoles(p.id, p.roles),
      onSettled: invalidate,
    }),
    revokeSessions: useMutation({
      mutationFn: (id: string) => revokeUserSessions(id),
      onSettled: invalidate,
    }),
  };
}

/* ---------------- moderation flags ---------------- */

export function useContentFlags(status?: string) {
  return useQuery({
    queryKey: admin14Keys.flags(status),
    queryFn: () => listContentFlags(status),
    retry: false,
  });
}

export function useFlagAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; action: FlagAction; note?: string }) =>
      actOnContentFlag(p.id, p.action, p.note),
    onSettled: () => void qc.invalidateQueries({ queryKey: admin14Keys.flags() }),
  });
}

/* ---------------- notifications ---------------- */

export function useNotificationLog() {
  return useQuery({ queryKey: admin14Keys.notifyLog, queryFn: () => listNotificationLog(), retry: false });
}

export function useBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: BroadcastPayload) => sendBroadcast(p),
    onSettled: () => void qc.invalidateQueries({ queryKey: admin14Keys.notifyLog }),
  });
}

export function useBroadcastPreview() {
  return useMutation({
    mutationFn: (p: { title: string; body: string; channels: NotifyChannel[]; user_id: string }) =>
      previewBroadcast(p),
  });
}

/* ---------------- roles ---------------- */

export function useRoles() {
  return useQuery({ queryKey: admin14Keys.roles, queryFn: listRoles, retry: false });
}

export function useRoleMutation() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: admin14Keys.roles });
  return {
    create: useMutation({
      mutationFn: (p: { name: string; description?: string }) => createRole(p.name, p.description),
      onSettled: invalidate,
    }),
    update: useMutation({
      mutationFn: (p: { id: string; patch: { name?: string; description?: string } }) =>
        updateRole(p.id, p.patch),
      onSettled: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => deleteRole(id), onSettled: invalidate }),
    setPermissions: useMutation({
      mutationFn: (p: { id: string; keys: string[] }) => setRolePermissions(p.id, p.keys),
      onSettled: invalidate,
    }),
  };
}
