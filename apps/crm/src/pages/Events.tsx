import React from "react";
import { useI18n } from "../lib/i18n";
import { useEventFeed } from "../lib/events";
import { useEventChime } from "../lib/sound";

/**
 * Live event feed — the Phase 2 acceptance-critical page.
 * Realtime logic lives in lib/events (useEventFeed); this page is the
 * turbo-styled timeline presentation of the same feed.
 */

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
