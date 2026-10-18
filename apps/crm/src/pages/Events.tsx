import React from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { apiUrl, getAccessToken } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * Live event feed — the Phase 2 acceptance-critical page.
 *
 * WebSocket client for `/ws/events?token=<jwt>` (Phase 2 spec):
 * - JWT passed at handshake (query token)
 * - auto-reconnect with exponential backoff + jitter
 * - on reconnect sends `last_event_id`; the gateway replays missed events
 *   from the DB (contract §4 outbox), not just memory
 * - heartbeat: server pings are answered with pong; a missed heartbeat
 *   window forces a reconnect (detects silent drops)
 * - incoming events are de-duplicated by `event_id` (contract §4: consumers
 *   are idempotent) and rendered without any page refresh
 */

interface DomainEvent {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

type FeedStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

const MAX_EVENTS = 200;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_BACKOFF_MS = 30_000;

function toWsUrl(): string {
  const base = apiUrl().replace(/^http/, "ws");
  return `${base}/ws/events`;
}

function useEventFeed(): {
  status: FeedStatus;
  events: DomainEvent[];
  lastEventId: string | null;
  retryInSec: number | null;
} {
  const [status, setStatus] = React.useState<FeedStatus>("connecting");
  const [events, setEvents] = React.useState<DomainEvent[]>([]);
  const [lastEventId, setLastEventId] = React.useState<string | null>(null);
  const [retryInSec, setRetryInSec] = React.useState<number | null>(null);

  const wsRef = React.useRef<WebSocket | null>(null);
  const timersRef = React.useRef<number[]>([]);
  const backoffRef = React.useRef(1_000);
  const lastIdRef = React.useRef<string | null>(null);
  const seenRef = React.useRef<Set<string>>(new Set());
  const manualCloseRef = React.useRef(false);
  const heartbeatRef = React.useRef<number | null>(null);

  const clearTimers = React.useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    if (heartbeatRef.current !== null) {
      window.clearTimeout(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    setRetryInSec(null);
  }, []);

  const armHeartbeat = React.useCallback(() => {
    if (heartbeatRef.current !== null) window.clearTimeout(heartbeatRef.current);
    heartbeatRef.current = window.setTimeout(() => {
      // Silent drop: no frame inside the heartbeat window → force reconnect.
      wsRef.current?.close();
    }, HEARTBEAT_TIMEOUT_MS);
  }, []);

  const connect = React.useCallback(() => {
    const token = getAccessToken();
    if (!token) {
      setStatus("disconnected");
      return;
    }
    clearTimers();
    setStatus((prev) => (prev === "connected" ? prev : backoffRef.current > 1_000 ? "reconnecting" : "connecting"));

    const ws = new WebSocket(`${toWsUrl()}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 1_000;
      setStatus("connected");
      armHeartbeat();
      // Resume from the last seen event so the gateway replays what we missed.
      if (lastIdRef.current) {
        ws.send(JSON.stringify({ type: "resume", last_event_id: lastIdRef.current }));
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      armHeartbeat();
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg === null || typeof msg !== "object") return;
      const kind = (msg as { type?: string }).type;
      if (kind === "ping" || kind === "heartbeat") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (kind !== "event") return;
      const event = (msg as { event?: DomainEvent }).event;
      if (!event || typeof event.event_id !== "string") return;
      if (seenRef.current.has(event.event_id)) return; // idempotent consumer (§4)
      seenRef.current.add(event.event_id);
      lastIdRef.current = event.event_id;
      setLastEventId(event.event_id);
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
    };

    const scheduleReconnect = () => {
      if (manualCloseRef.current) {
        setStatus("disconnected");
        return;
      }
      setStatus("reconnecting");
      const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
      const jitter = Math.floor(Math.random() * 500);
      const waitMs = delay + jitter;
      setRetryInSec(Math.ceil(waitMs / 1000));
      const tick = window.setInterval(() => {
        setRetryInSec((s) => (s !== null && s > 1 ? s - 1 : s));
      }, 1000);
      const id = window.setTimeout(() => {
        window.clearInterval(tick);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        connect();
      }, waitMs);
      timersRef.current.push(id);
    };

    ws.onerror = () => {
      // onclose follows and drives the reconnect; nothing to do here.
    };
    ws.onclose = () => {
      if (heartbeatRef.current !== null) {
        window.clearTimeout(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      scheduleReconnect();
    };
  }, [armHeartbeat, clearTimers]);

  React.useEffect(() => {
    manualCloseRef.current = false;
    connect();
    return () => {
      manualCloseRef.current = true;
      clearTimers();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, clearTimers]);

  return { status, events, lastEventId, retryInSec };
}

const STATUS_TONE: Record<FeedStatus, "info" | "success" | "warning" | "danger"> = {
  connecting: "info",
  connected: "success",
  reconnecting: "warning",
  disconnected: "danger",
};

const STATUS_DOT: Record<FeedStatus, string> = {
  connecting: "#3b82f6",
  connected: "#16a34a",
  reconnecting: "#d97706",
  disconnected: "#dc2626",
};

export default function Events(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events, lastEventId, retryInSec } = useEventFeed();

  return (
    <div className="page">
      <h1>{t("events.title")}</h1>

      <Card style={{ marginBottom: "1rem" }}>
        <CardContent>
          <span className="status-dot" style={{ background: STATUS_DOT[status] }} />
          <Badge tone={STATUS_TONE[status]}>
            {t(`events.status${status[0].toUpperCase()}${status.slice(1)}`)}
          </Badge>
          {status === "reconnecting" && retryInSec !== null && (
            <span style={{ marginInlineStart: "0.75rem", color: "#64748b", fontSize: "0.85rem" }}>
              {t("events.retryIn").replace("{s}", String(retryInSec))}
            </span>
          )}
          {lastEventId && (
            <span style={{ marginInlineStart: "0.75rem", color: "#64748b", fontSize: "0.85rem" }}>
              {t("events.lastEvent")}: <code>{lastEventId.slice(0, 8)}…</code>
            </span>
          )}
        </CardContent>
      </Card>

      {events.length === 0 ? (
        <div className="empty">
          <p>{t("events.empty")}</p>
          <p style={{ fontSize: "0.85rem" }}>{t("events.emptyHint")}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {events.map((event) => (
            <Card key={event.event_id} padding="1rem">
              <CardHeader>
                <CardTitle>
                  <code style={{ fontSize: "0.9rem" }}>{event.event_type}</code>
                </CardTitle>
                <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                  {formatDate(event.created_at)}
                </span>
              </CardHeader>
              <CardContent>
                <div style={{ fontSize: "0.85rem", color: "#475569", marginBottom: "0.5rem" }}>
                  {event.aggregate_type} · <code>{String(event.aggregate_id).slice(0, 8)}…</code>
                </div>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#1d4ed8" }}>
                    {t("events.payload")}
                  </summary>
                  <pre
                    dir="ltr"
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "0.75rem",
                      fontSize: "0.78rem",
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
