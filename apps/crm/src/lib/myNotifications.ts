import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { LocalizedText } from "./contentApi";

/**
 * Phase 16 (coordinator integration) — service layer for the user's own
 * received-notifications inbox.
 *
 * ADR-001: all parsing, API access and defaults live here; components
 * only render. Backend: GET/POST /api/v1/users/me/notifications*
 * (fulfils the Phase-2 promise that «وب/CRM آن را از API می‌خوانند»).
 */

export interface MyNotification {
  id: string;
  notif_type: string;
  title: LocalizedText;
  body: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface MyNotificationsPage {
  items: MyNotification[];
  unread_count: number;
  next_cursor: string | null;
}

const QK = ["my-notifications"] as const;

export function useMyNotificationsQuery(unreadOnly: boolean) {
  return useQuery({
    queryKey: [...QK, unreadOnly ? "unread" : "all"],
    queryFn: () =>
      apiFetch<MyNotificationsPage>(
        `/api/v1/users/me/notifications?unread_only=${unreadOnly ? "true" : "false"}&limit=30`,
      ),
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<MyNotification>(`/api/v1/users/me/notifications/${id}/read`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK });
    },
  });
}

/** Human label for a notification kind — pure presentation helper. */
export function notifKindLabel(notifType: string, t: (k: string) => string): string {
  const key = `mynotif.kind.${notifType}`;
  const labeled = t(key);
  return labeled === key ? notifType : labeled;
}
