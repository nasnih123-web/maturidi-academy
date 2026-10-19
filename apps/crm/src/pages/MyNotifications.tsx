import * as React from "react";
import { useI18n } from "../lib/i18n";
import {
  notifKindLabel,
  useMarkNotificationRead,
  useMyNotificationsQuery,
} from "../lib/myNotifications";
import { l10n } from "../lib/projects16";

/**
 * Phase 16 (coordinator integration) — «اعلان‌های من»: inbox of the
 * notifications this staff member actually received (task assignments,
 * due-date reminders, …). Purely presentational; all logic lives in
 * lib/myNotifications.ts (ADR-001).
 */
export default function MyNotifications(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const { data, isLoading, isError, refetch } = useMyNotificationsQuery(unreadOnly);
  const markRead = useMarkNotificationRead();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("mynotif.title")}</h1>
          <p className="muted">{t("mynotif.subtitle")}</p>
        </div>
        <div className="row gap">
          <button
            type="button"
            className={unreadOnly ? "btn primary" : "btn"}
            onClick={() => setUnreadOnly((v) => !v)}
          >
            {t("mynotif.unreadOnly")} ({data?.unread_count ?? 0})
          </button>
          <button type="button" className="btn" onClick={() => void refetch()}>
            {t("mynotif.refresh")}
          </button>
        </div>
      </div>

      {isLoading && <p className="muted">{t("mynotif.loading")}</p>}
      {isError && <p className="error">{t("mynotif.loadError")}</p>}

      {data && data.items.length === 0 && (
        <div className="empty-state">
          <p>{unreadOnly ? t("mynotif.emptyUnread") : t("mynotif.empty")}</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="notif-list">
          {data.items.map((n) => (
            <li
              key={n.id}
              className={`notif-item${n.read_at ? "" : " unread"}`}
              onClick={() => {
                if (!n.read_at && !markRead.isPending) markRead.mutate(n.id);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !n.read_at && !markRead.isPending)
                  markRead.mutate(n.id);
              }}
            >
              <span className="notif-kind">{notifKindLabel(n.notif_type, t)}</span>
              <div className="notif-body">
                <strong>{l10n(locale, n.title) || "—"}</strong>
                {n.body && <p className="muted">{n.body}</p>}
                <time className="muted small">{formatDate(n.created_at)}</time>
              </div>
              {!n.read_at && <span className="dot-unread" aria-label={t("mynotif.unread")} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
