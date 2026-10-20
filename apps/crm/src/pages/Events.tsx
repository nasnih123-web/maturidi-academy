import React from "react";
import { useI18n } from "../lib/i18n";
import { useEventFeed } from "../lib/events";
import { useEventChime } from "../lib/sound";
import { useAuth } from "../lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import {
  contentRefFromEvent,
  errText,
  transitionContent,
  type WorkflowStatus,
} from "../lib/admin14";
import { admin14Keys } from "../lib/admin14Hooks";
import type { DomainEvent } from "../lib/events";

/**
 * Live event feed — the Phase 2 acceptance-critical page.
 * Realtime logic lives in lib/events (useEventFeed); this page is the
 * turbo-styled timeline presentation of the same feed.
 *
 * Phase 14 extension: direct moderation actions from the feed. Any event
 * that resolves to actionable content (lib/admin14.contentRefFromEvent)
 * gets Approve / Publish buttons:
 * - optimistic UI: the row shows the action as in-flight immediately
 * - on success the inbox/detail caches are invalidated (immediate effect)
 * - on error the row rolls back to its pre-action state with the error shown
 * Sensitive ops are permission-gated and confirm before firing.
 */

type PendingMap = Record<string, WorkflowStatus>;
type DoneMap = Record<string, WorkflowStatus>;
type ErrorMap = Record<string, string>;

function ActionBox({ event }: { event: DomainEvent }): React.ReactElement | null {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [pending, setPending] = React.useState<PendingMap>({});
  const [done, setDone] = React.useState<DoneMap>({});
  const [errors, setErrors] = React.useState<ErrorMap>({});
  const [confirming, setConfirming] = React.useState<WorkflowStatus | null>(null);

  const ref = React.useMemo(
    () =>
      contentRefFromEvent({
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        payload: event.payload,
      }),
    [event],
  );

  if (!ref) return null;

  const canAct = hasPermission("content.publish");
  const eid = event.event_id;
  const inFlight = pending[eid];
  const finished = done[eid];

  const fire = (to: WorkflowStatus): void => {
    setConfirming(null);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[eid];
      return next;
    });
    // Optimistic: show the action as in-flight immediately.
    setPending((prev) => ({ ...prev, [eid]: to }));
    transitionContent(ref, to)
      .then(() => {
        setPending((prev) => {
          const next = { ...prev };
          delete next[eid];
          return next;
        });
        setDone((prev) => ({ ...prev, [eid]: to }));
        // Immediate effect across the CRM: refresh the control center data.
        void qc.invalidateQueries({ queryKey: admin14Keys.all });
      })
      .catch((err: unknown) => {
        // Rollback: clear the optimistic state, surface the error.
        setPending((prev) => {
          const next = { ...prev };
          delete next[eid];
          return next;
        });
        setErrors((prev) => ({ ...prev, [eid]: errText(err) }));
      });
  };

  const ask = (to: WorkflowStatus): React.ReactElement => (
    <button
      key={to}
      type="button"
      className={`btn${to === "published" ? " primary" : ""}`}
      disabled={!canAct || !!inFlight}
      onClick={() => (confirming === to ? fire(to) : setConfirming(to))}
    >
      {confirming === to ? `✓ ${t("admin14.evActConfirm")}` : to === "published" ? t("admin14.evActPublish") : t("admin14.evActApprove")}
    </button>
  );

  return (
    <div className="feed-actions">
      {inFlight && (
        <span className="hint">
          {t("admin14.evActWorking")} → {inFlight}
        </span>
      )}
      {finished && !inFlight && (
        <span className="ok-text">
          {t("admin14.evActDone")} → {finished}
        </span>
      )}
      {!inFlight && !finished && (
        <div className="row">
          {ask("approved")}
          {ask("published")}
        </div>
      )}
      {errors[eid] && (
        <p className="error-text">
          {t("admin14.evActFailed")} — {errors[eid]}
        </p>
      )}
    </div>
  );
}

export default function Events(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events, lastEventId, retryInSec } = useEventFeed();
  useEventChime(events);

  const statusKey = `events.status${status[0].toUpperCase()}${status.slice(1)}`;

  return (
    <div className="page" style={{ maxWidth: "900px" }}>
      <h1>{t("events.title")}</h1>

      <section className="panel" style={{ marginBottom: "1rem" }} aria-label={t("events.title")}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <span
            className={`dot-live ${status === "connected" ? "" : status === "disconnected" ? "down" : "warn"}`}
            aria-hidden="true"
          />
          <span style={{ fontSize: "0.85rem", color: "var(--x-text2)" }}>{t(statusKey)}</span>
          {status === "reconnecting" && retryInSec !== null && (
            <span className="hint">{t("events.retryIn").replace("{s}", String(retryInSec))}</span>
          )}
          {lastEventId && (
            <span className="hint" style={{ marginInlineStart: "auto" }}>
              {t("events.lastEvent")}: <code>{lastEventId.slice(0, 8)}…</code>
            </span>
          )}
        </div>
      </section>

      {events.length === 0 ? (
        <div className="empty-state">
          <h3>{t("events.empty")}</h3>
          <p>{t("events.emptyHint")}</p>
        </div>
      ) : (
        <section className="panel">
          <ol className="timeline">
            {events.map((event, i) => (
              <li key={event.event_id} className={`tl-row${i === 0 ? " fresh" : ""}`}>
                <span className="tl-dot" aria-hidden="true" />
                <div className="tl-body">
                  <div className="tl-head">
                    <strong>
                      <code>{event.event_type}</code>
                    </strong>
                    <time className="tl-time" dateTime={event.created_at}>
                      {formatDate(event.created_at)}
                    </time>
                  </div>
                  <div className="tl-summary">
                    {event.aggregate_type} · <code>{String(event.aggregate_id).slice(0, 8)}…</code>
                  </div>
                  <ActionBox event={event} />
                  <details className="event-details">
                    <summary>{t("events.payload")}</summary>
                    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                  </details>
                  <code className="tl-id">
                    {t("events.eventId")}: {event.event_id.slice(0, 8)}…
                  </code>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
