import React from "react";
import { apiUrl, getAccessToken } from "./api";

/**
 * Live event feed hook — the Phase 2 acceptance-critical realtime client.
 *
 * WebSocket client for `/ws/events?token=<jwt>` (Phase 2 spec):
 * - JWT passed at handshake (query token)
 * - auto-reconnect with exponential backoff + jitter
 * - on reconnect sends `last_event_id`; the gateway replays missed events
 *   from the DB (contract §4 outbox), not just memory
 * - heartbeat: server pings are answered with pong; a missed heartbeat
 *   window forces a reconnect (detects silent drops)
 * - incoming events are de-duplicated by `event_id` (contract §4: consumers
 *   are idempotent) and delivered without any page refresh
 *
 * Pure logic (no JSX) so any page can consume the same feed — per ADR-001
 * business/realtime logic lives outside components.
 */

export interface DomainEvent {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export type FeedStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_BACKOFF_MS = 30_000;

function toWsUrl(): string {
  const base = apiUrl().replace(/^http/, "ws");
  return `${base}/ws/events`;
}

export function useEventFeed(maxEvents = 200): {
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
    setStatus((prev) =>
      prev === "connected" ? prev : backoffRef.current > 1_000 ? "reconnecting" : "connecting",
    );

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
      setEvents((prev) => [event, ...prev].slice(0, maxEvents));
    };

    const scheduleReconnect = (): void => {
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
  }, [armHeartbeat, clearTimers, maxEvents]);

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
