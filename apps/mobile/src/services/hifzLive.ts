/**
 * apps/mobile — src/services/hifzLive.ts
 *
 * Live Hifz WebSocket client (versioned contract v2:
 * apps/api/app/modules/quran/hifz_ws_contract.py, phase 5).
 * Transport only — no audio capture (hifzAudio.ts), no session state
 * (hooks/useHifz.ts).
 *
 * Flow: issue a one-time ticket (POST /api/v1/auth/ws-ticket, 60 s) →
 * open wss://…/api/v1/quran/hifz/attempts/{id}/stream?ticket=… → send
 * {"type":"start","surah":N,"ayah":M,"protocol_version":2,
 *  "audio":{"sample_rate":16000,"channels":1,"format":"pcm16le"}} →
 * wait for the server's readiness sequence (session_started →
 * engine_ready → audio_ready → listening) → stream binary Int16LE
 * mono 16 kHz frames (4096 samples / 256 ms each) → receive
 * enveloped events → send {"type":"end"} to store + receive `final`
 * + `session_ended` + close 1000, or {"type":"cancel"} to close
 * without storing. An abrupt close without either stores nothing.
 *
 * Readiness is real in v2 (R-02 fixed server-side): `listening`
 * here means the recogniser was built AND warmed up with real
 * silence. Frames are gated — this client sends NOTHING before the
 * `listening` event, so no frame is ever rejected as pre-ready.
 * The connect promise resolves only on `listening`.
 *
 * Events (v2 envelope: session_id/event_id/sequence_no/event_type/
 * status/audio_ts_ms + legacy `type`): stable_word/final_word/
 * skipped/wrong (legacy "word"), correction (a later verdict for an
 * already-written slot — it OVERWRITES, never duplicates), partial
 * (word currently being read — never counted), progress (position/
 * counts on ayah advance), warning (non-fatal), error (with fatal),
 * final, session_ended. Dedup is by `event_id`; sequence gaps are
 * reported (the server never replays — a gap is only reported).
 * Bare v1 events (an older server) are still parsed (see
 * hifzProtocol.parseServerEvent) and deduped by word slot.
 */
import { apiBaseUrl } from "../lib/config";
import {
  CANCEL_MESSAGE,
  END_MESSAGE,
  buildStartMessage,
  dedupeByEventId,
  dedupeWordEvents,
  describeWsCloseCode,
  isValidPcm16Frame,
  parseServerEvent,
  type HifzFinalEvent,
  type HifzReadinessEvent,
  type HifzReadinessKind,
  type HifzServerEvent,
  type HifzSessionEndedEvent,
  type HifzWarningEvent,
} from "../lib/hifzProtocol";
import { issueWsTicket } from "./hifz";

/** Same connect budget as the web study page (15 s, socket only). */
const CONNECT_TIMEOUT_MS = 15_000;
/**
 * Readiness budget after `start`: the first session after a deploy
 * builds the 73 MB recogniser and warms it up; 60 s covers a cold
 * start without hanging the UI forever.
 */
const READINESS_TIMEOUT_MS = 60_000;
/** How long `end()` waits for the server's `final` before closing. */
const FINAL_TIMEOUT_MS = 10_000;

export type HifzLiveState =
  | "connecting"
  | "waiting_engine"
  | "listening"
  | "ending"
  | "closed";

export interface HifzLiveCallbacks {
  onEvent: (event: HifzServerEvent) => void;
  onState: (state: HifzLiveState) => void;
  /** Readiness milestone; the full event rides along so the caller
      can read engine_ready's engine/build_ms/warmup_ms. */
  onReadiness: (kind: HifzReadinessKind, ev: HifzReadinessEvent) => void;
  /** Server `error` event or a transport failure. */
  onError: (code: string, message?: string, fatal?: boolean) => void;
  onWarning: (event: HifzWarningEvent) => void;
  onFinal: (event: HifzFinalEvent) => void;
  onSessionEnded: (event: HifzSessionEndedEvent) => void;
  onSequenceGap: (expected: number, got: number) => void;
  onClosed: (code: number, reason: string) => void;
}

function wsBaseUrl(): string {
  const base = apiBaseUrl();
  if (base.startsWith("https://")) return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  throw new Error("invalid-api-url");
}

export class HifzLiveClient {
  private ws: WebSocket | null = null;
  private state: HifzLiveState = "closed";
  private seenEventIds = new Set<string>();
  private seenWordSlots = new Set<string>();
  private lastSequenceNo: number | null = null;
  private finalWaiter: ((ev: HifzFinalEvent | null) => void) | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private readinessTimer: ReturnType<typeof setTimeout> | null = null;
  private readyWaiter: (() => void) | null = null;
  private ended = false;

  constructor(private readonly cb: HifzLiveCallbacks) {}

  private setState(s: HifzLiveState): void {
    this.state = s;
    this.cb.onState(s);
  }

  /**
   * Open the socket, send `start`, and resolve ONLY when the server's
   * `listening` event arrives (engine built + warmed up). Rejects on
   * connect timeout, readiness timeout, or any fatal server error.
   */
  async connect(opts: { attemptId: string; surah: number; ayah: number }): Promise<void> {
    if (this.ws) throw new Error("already-connected");
    this.setState("connecting");
    const ticket = await issueWsTicket();
    const url =
      `${wsBaseUrl()}/api/v1/quran/hifz/attempts/${opts.attemptId}/stream` +
      `?ticket=${encodeURIComponent(ticket.ticket)}`;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      const fail = (code: string, message?: string): void => {
        if (settled) return;
        settled = true;
        this.clearTimers();
        this.cb.onError(code, message, true);
        reject(new Error(code));
      };

      this.connectTimer = setTimeout(() => fail("connect-timeout"), CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        try {
          ws.send(buildStartMessage(opts.surah, opts.ayah));
        } catch {
          fail("send-failed");
          return;
        }
        this.setState("waiting_engine");
        this.readyWaiter = () => {
          if (settled) return;
          settled = true;
          this.clearTimers();
          this.setState("listening");
          resolve();
        };
        this.readinessTimer = setTimeout(() => fail("engine-ready-timeout"), READINESS_TIMEOUT_MS);
      };

      ws.onmessage = (msg) => {
        if (typeof msg.data !== "string") return; // server never sends binary
        const ev = parseServerEvent(msg.data);
        if (!ev) return;
        // Dedup by event_id (v2); v1 servers have none — slot dedup
        // below covers their word events.
        const [unique] = dedupeByEventId([ev], this.seenEventIds);
        if (!unique) return;
        if (unique.sequenceNo !== undefined) {
          if (this.lastSequenceNo !== null && unique.sequenceNo !== this.lastSequenceNo + 1) {
            this.cb.onSequenceGap(this.lastSequenceNo + 1, unique.sequenceNo);
          }
          this.lastSequenceNo = unique.sequenceNo;
        }
        switch (unique.type) {
          case "session_started":
          case "engine_ready":
          case "audio_ready":
            this.cb.onReadiness(unique.type, unique);
            this.cb.onEvent(unique);
            return;
          case "listening":
            this.cb.onReadiness("listening", unique);
            this.cb.onEvent(unique);
            if (this.readyWaiter) {
              const w = this.readyWaiter;
              this.readyWaiter = null;
              w();
            }
            return;
          case "word": {
            const [deduped] = dedupeWordEvents([unique], this.seenWordSlots);
            if (!deduped) return;
            this.cb.onEvent(deduped);
            return;
          }
          case "error":
            // Non-fatal frame errors (fatal:false) are reported, not
            // session-ending; fatal ones fail the connect/session.
            this.cb.onError(unique.code, unique.message, unique.fatal);
            if (unique.fatal !== false && !settled) fail(unique.code, unique.message);
            return;
          case "warning":
            this.cb.onWarning(unique);
            this.cb.onEvent(unique);
            return;
          case "final":
            this.cb.onFinal(unique);
            this.resolveFinal(unique);
            this.cb.onEvent(unique);
            return;
          case "session_ended":
            this.cb.onSessionEnded(unique);
            this.cb.onEvent(unique);
            return;
          default:
            this.cb.onEvent(unique);
            return;
        }
      };

      ws.onerror = () => {
        // onclose follows with the real code; only fail connect here
        // when the socket never opened.
        if (!settled) fail("socket-error");
      };

      ws.onclose = (e) => {
        this.clearTimers();
        this.setState("closed");
        this.resolveFinal(null);
        const code = typeof e.code === "number" ? e.code : 1006;
        // The server's close reason names the cause (4409 is shared
        // by the rate limiter and the stream limiter, phase 11); the
        // generic code name is only the fallback.
        const reason = typeof e.reason === "string" && e.reason.length > 0 ? e.reason : describeWsCloseCode(code);
        this.cb.onClosed(code, reason);
        if (!settled) fail("socket-closed");
      };
    });
  }

  /**
   * Send one PCM16 frame. Gated on `listening`: frames before
   * readiness are never sent (the server would reject them), and
   * frames after the session ended are dropped. Invalid frames are
   * dropped locally and counted by the caller via the return value.
   */
  sendFrame(pcm: Uint8Array): boolean {
    if (this.state !== "listening" || !this.ws) return false;
    if (!isValidPcm16Frame(pcm)) return false;
    try {
      // Copy: the caller's buffer is reused by the capture layer.
      this.ws.send(pcm.slice().buffer as ArrayBuffer);
      return true;
    } catch {
      // A failed send surfaces via onclose/onerror; never throw into
      // the audio callback.
      return false;
    }
  }

  /**
   * Graceful end: send `end`, wait for the server's `final` (bounded),
   * then close. Resolves with the final event, or null on timeout.
   */
  async end(): Promise<HifzFinalEvent | null> {
    if (!this.ws || this.ended) return null;
    this.ended = true;
    this.setState("ending");
    const done = new Promise<HifzFinalEvent | null>((resolve) => {
      this.finalWaiter = resolve;
      this.finalTimer = setTimeout(() => this.resolveFinal(null), FINAL_TIMEOUT_MS);
    });
    try {
      this.ws.send(END_MESSAGE);
    } catch {
      this.resolveFinal(null);
    }
    const final = await done;
    this.close();
    return final;
  }

  /**
   * Cancel without storing: tell the server (so it ends the session
   * cleanly instead of seeing a bare disconnect), then close.
   */
  abort(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.ws) {
      try {
        this.ws.send(CANCEL_MESSAGE);
      } catch {
        // Socket already gone — same outcome.
      }
    }
    this.close();
  }

  private resolveFinal(ev: HifzFinalEvent | null): void {
    if (this.finalTimer) {
      clearTimeout(this.finalTimer);
      this.finalTimer = null;
    }
    if (this.finalWaiter) {
      const w = this.finalWaiter;
      this.finalWaiter = null;
      w(ev);
    }
  }

  private clearTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.readinessTimer) {
      clearTimeout(this.readinessTimer);
      this.readinessTimer = null;
    }
  }

  private close(): void {
    const ws = this.ws;
    this.ws = null;
    this.readyWaiter = null;
    if (ws) {
      try {
        ws.close(1000);
      } catch {
        // Already closed.
      }
    }
    this.setState("closed");
  }
}
