import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { errText } from "./library";

/**
 * Phase 13 (CRM) — sync status dashboard client.
 *
 * Management-plane client over the REAL Phase-13 backend contract
 * (Track 1, apps/api/app/modules/sync, ADR-0010):
 *
 * - GET  /api/v1/sync/conflicts?only_pending=&limit=
 *        → {items:[{id, entity_type, entity_id, local_payload, remote_payload,
 *                   local_version, remote_version, resolution, created_at,
 *                   resolved_at, resolution_note}], total}
 * - POST /api/v1/sync/conflicts/{id}/resolve?device_id=crm
 *        ← {resolution: "keep_local"|"keep_remote"|"merged",
 *            merged_payload?, note?}
 *        → {id, resolution, applied_version}
 * - GET  /api/v1/sync/offline-pack
 *        → {items:[{kind, ref_id, title, score, reason}], generated_at}
 *
 * BACKEND (فاز ۱۳، تکمیلی هماهنگ‌کننده): جدول دستگاه‌ها از
 *   GET /api/v1/admin/sync/devices
 *     → {devices:[{user_id, device_id, cursor_seq, updated_at, platform}]}
 * خوانده می‌شود (مجوز sync.manage) — بدون mock (§۱۵.۹).
 */

export { errText };

export type ConflictResolution = "keep_local" | "keep_remote" | "merged";

export interface SyncConflict {
  id: string;
  entity_type: string;
  entity_id: string;
  local_payload: Record<string, unknown> | null;
  remote_payload: Record<string, unknown> | null;
  local_version: number | null;
  remote_version: number | null;
  resolution: string;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface DeviceCursor {
  user_id: string;
  device_id: string;
  cursor_seq: number;
  updated_at: string;
}

export interface OfflinePackItem {
  kind: string;
  ref_id: string;
  title: Record<string, string>;
  score: number;
  reason: "started" | "followed" | "popular";
}

const QK = {
  conflicts: ["sync13", "conflicts"] as const,
  devices: ["sync13", "devices"] as const,
  pack: ["sync13", "pack"] as const,
};

export function useConflicts(onlyPending = true) {
  return useQuery({
    queryKey: [...QK.conflicts, onlyPending],
    queryFn: async (): Promise<{ items: SyncConflict[]; total: number }> => {
      const q = new URLSearchParams({ only_pending: String(onlyPending), limit: "50" });
      return apiFetch(`/api/v1/sync/conflicts?${q.toString()}`);
    },
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      resolution: ConflictResolution;
      merged_payload?: Record<string, unknown>;
      note?: string;
    }): Promise<{ id: string; resolution: string; applied_version: number | null }> => {
      return apiFetch(
        `/api/v1/sync/conflicts/${encodeURIComponent(input.id)}/resolve?device_id=crm`,
        {
          method: "POST",
          body: {
            resolution: input.resolution,
            merged_payload: input.merged_payload ?? null,
            note: input.note ?? null,
          },
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.conflicts });
    },
  });
}

export function useDevices() {
  return useQuery({
    queryKey: QK.devices,
    queryFn: async (): Promise<{ devices: DeviceCursor[] }> => {
      // داشبورد ادمین: همهٔ دستگاه‌ها (مجوز sync.manage لازم است).
      return apiFetch(`/api/v1/admin/sync/devices`);
    },
    retry: 1,
  });
}

export function useOfflinePack() {
  return useQuery({
    queryKey: QK.pack,
    queryFn: async (): Promise<{ items: OfflinePackItem[]; generated_at: string }> => {
      return apiFetch(`/api/v1/sync/offline-pack`);
    },
  });
}

export function pickTitle(
  title: Record<string, string> | null | undefined,
  locale: string,
  fallback: string,
): string {
  if (!title) return fallback;
  return title[locale] || title.fa || title.en || title.ar || fallback;
}
