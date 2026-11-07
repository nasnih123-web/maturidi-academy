/**
 * apps/mobile — src/lib/hifzProtocol.ts
 *
 * Pure Hifz wire-protocol helpers (no React Native imports): the
 * versioned WebSocket contract of
 * `apps/api/app/modules/quran/hifz_ws_contract.py` (phase 5) and the
 * 16 kHz mono PCM16 frame format, plus WAV encoding for the
 * record-then-grade path.
 *
 * Contract v2 (current; `HIFZ_PROTOCOL_VERSION = 2`):
 * - REST base: /api/v1/quran/hifz (attempts, grade, grade-word, peek,
 *   complete, status). Grade endpoints take multipart form fields
 *   {surah, ayah[, word_index], audio: WAV 16 kHz mono}.
 * - Live WS: /api/v1/quran/hifz/attempts/{id}/stream?ticket=<one-time
 *   ticket from POST /api/v1/auth/ws-ticket, 60 s>. `?token=<JWT>` is
 *   never accepted; a rejected handshake closes with 4401. The ticket
 *   never appears in logs.
 * - First client message (v2):
 *   {"type":"start","surah":N,"ayah":M,"protocol_version":2,
 *    "audio":{"sample_rate":16000,"channels":1,"format":"pcm16le"}}
 *   Unknown versions and forbidden fields (user_id/attempt_id/owner/
 *   session_id/user) → error + close 4400. `surah` must equal the
 *   attempt's surah. A v1 client (start without protocol_version)
 *   still works; this client always speaks v2.
 * - Readiness (v2, R-02 fixed server-side): after `start` the server
 *   sends, in order, `session_started`, `engine_ready` (after the
 *   recogniser is built AND warmed up with real silence),
 *   `audio_ready`, then `listening`. The client shows "listening"
 *   and sends frames ONLY after `listening`. Frames sent before
 *   readiness are rejected and reported with a `warning`
 *   (hifz_frames_before_ready), never silently dropped.
 * - Audio frames: binary Int16LE mono 16 kHz; the healthy profile is
 *   4096 samples (256 ms, 8192 bytes) per frame, ~4 frames/second.
 *   The server validates even length and a 64 KiB cap
 *   (`hifz_frame_malformed` / `hifz_frame_too_large`, non-fatal, 3
 *   violations → close 1009) and a token-bucket rate limit
 *   (50 fps sustained; flood → warning `hifz_rate_limited`, then
 *   close 4409). Session max 30 minutes, then finalised like `end`.
 * - Server events (v2 envelope): every event carries `session_id`,
 *   `event_id`, `sequence_no` (monotonic from 1), `event_type`,
 *   `status`, `audio_ts_ms`, plus the legacy `type` for v1 clients.
 *   Word events: `stable_word` (correct/close), `final_word`
 *   (trailing words of finish, usually skipped), `skipped`, `wrong`
 *   — all with legacy type "word" and `confidence` (= prob). A word
 *   event may carry `needs_review` (phase 6: borderline close) and
 *   `finality` (provisional/stable/final). A later decision for the
 *   same slot arrives as `correction` (with `corrects_event_id`); a
 *   slot is never written twice. `partial` marks the word currently
 *   being read (never counted, never a written word); a `partial`
 *   with `retracted: true` (phase 6) withdraws a stale preview.
 *   `repeat`/`revisit` (phase 6) are counters, not words.
 *   `progress` syncs position/counts on ayah advance.
 *   `warning` (non-fatal: hifz_frames_before_ready,
 *   hifz_rate_limited, hifz_audio_clipping) and `error` (with
 *   `fatal`) are envelope events. Readiness events carry their
 *   payload (engine_ready: engine/build_ms/warmup_ms). `final`
 *   arrives after storing (attempt_id/surah/ayahs/counts/
 *   extra_words); `session_ended` (reason end/max_duration/cancel/
 *   disconnect/error, plus state/words/skipped/audio_ms) precedes
 *   the 1000 close. Close 4409 is shared by the frame-rate limiter
 *   and the live-stream limiter (phase 11) — the close REASON
 *   (hifz_rate_limited vs hifz_too_many_streams) tells which fired.
 *   The client sends {"type":"end"} to store, or
 *   {"type":"cancel"} to close without storing; an abrupt close
 *   without either stores nothing.
 * - v1 fallback: an older server (no envelope) still sends bare
 *   {"type":"word",...} events. This parser accepts both shapes:
 *   it prefers `event_type`, falls back to `type`, and treats a
 *   missing `event_id`/`sequence_no` as "unknown, dedupe by slot".
 *
 * Pure data/logic — no business state (ADR-001). Tested by
 * hifzProtocol.test.mjs with node --test (no jest in apps/mobile).
 */

/** Audio format the server demands on both paths (hifz_service.py). */
export const HIFZ_SAMPLE_RATE = 16000;
export const HIFZ_CHANNELS = 1;
export const HIFZ_BITS_PER_SAMPLE = 16;
/** v2 audio format declaration sent in `start`. */
export const HIFZ_AUDIO_FORMAT = "pcm16le" as const;
/** v2 healthy frame profile: 4096 samples = 256 ms = 8192 bytes. */
export const HIFZ_FRAME_SAMPLES = 4096;
export const HIFZ_FRAME_MS = 256;
export const HIFZ_FRAME_BYTES = (HIFZ_FRAME_SAMPLES * HIFZ_BITS_PER_SAMPLE) / 8;
/** Server cap on one binary frame (hifz_ws_contract.MAX_FRAME_BYTES). */
export const HIFZ_MAX_FRAME_BYTES = 65536;
/** Server session cap (hifz_ws_contract.MAX_SESSION_SECONDS). */
export const HIFZ_MAX_SESSION_SECONDS = 1800;

/** Current wire protocol version (hifz_ws_contract.HIFZ_WS_PROTOCOL_VERSION). */
export const HIFZ_PROTOCOL_VERSION = 2;

/** Word verdicts, shared by the live stream and the grade responses. */
export type HifzWordStatus = "correct" | "close" | "wrong" | "skipped";

export interface HifzWordEvent {
  type: "word";
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
  status: HifzWordStatus;
  prob: number;
  heard?: string | null;
  reason?: string;
  /** True for trailing words of finish (event_type final_word). */
  isFinal?: boolean;
  /** Phase 6: a borderline close (or exact match with a low engine
      prob) is not certain — it wants review, not a silent verdict. */
  needsReview?: boolean;
  /** Phase 6 three-state finality: provisional | stable | final. */
  finality?: "provisional" | "stable" | "final";
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzCorrectionEvent {
  type: "correction";
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
  status: HifzWordStatus;
  prob: number;
  heard?: string | null;
  reason?: string;
  needsReview?: boolean;
  finality?: "provisional" | "stable" | "final";
  correctsEventId?: string;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzPartialEvent {
  type: "partial";
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
  /** Phase 6: the server retracts a stale preview with a `partial`
      event whose status is "retracted" and retracted=true. A
      retracted partial clears the current-word marker — it must
      never be shown as the word being read. */
  retracted?: boolean;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

/** Phase 6: the user re-read a unit already written in this ayah.
    It consumes the buffer, writes no word and never moves the
    pointer — a counter, not a word event. */
export interface HifzRepeatEvent {
  type: "repeat";
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

/** Phase 6: the heard phonemes proved an earlier ayah. The session
    does NOT move back; it only reports the revisit. */
export interface HifzRevisitEvent {
  type: "revisit";
  surah: number;
  ayah: number;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzProgressEvent {
  type: "progress";
  surah: number;
  ayah: number;
  words: number;
  skipped: number;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzExtraEvent {
  type: "extra";
  text: string;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzLocatedEvent {
  type: "located";
  surah?: number;
  ayah: number;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzFinalEvent {
  type: "final";
  attempt_id?: string;
  surah?: number;
  ayahs?: number[];
  counts?: { correct: number; close: number; wrong: number; skipped: number };
  extra_words?: string[];
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzErrorEvent {
  type: "error";
  code: string;
  message?: string;
  fatal?: boolean;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzWarningEvent {
  type: "warning";
  code: string;
  message?: string;
  /** Frames dropped before readiness (hifz_frames_before_ready). */
  dropped?: number;
  /** Clipped frames counted so far (hifz_audio_clipping). */
  clippedFrames?: number;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

/** Readiness milestones, in server order. */
export type HifzReadinessKind = "session_started" | "engine_ready" | "audio_ready" | "listening";

export interface HifzReadinessEvent {
  type: HifzReadinessKind;
  surah?: number;
  ayah?: number;
  /** engine_ready: the streaming engine ("zipformer") + build/warmup timings. */
  engine?: string;
  buildMs?: number;
  warmupMs?: number;
  /** Server state-machine state carried by the readiness events. */
  state?: string;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export interface HifzSessionEndedEvent {
  type: "session_ended";
  reason: string;
  state?: string;
  words?: number;
  skipped?: number;
  audioMs?: number;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
}

export type HifzServerEvent =
  | HifzWordEvent
  | HifzCorrectionEvent
  | HifzPartialEvent
  | HifzRepeatEvent
  | HifzRevisitEvent
  | HifzProgressEvent
  | HifzExtraEvent
  | HifzLocatedEvent
  | HifzFinalEvent
  | HifzErrorEvent
  | HifzWarningEvent
  | HifzReadinessEvent
  | HifzSessionEndedEvent;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isWordStatus(v: unknown): v is HifzWordStatus {
  return v === "correct" || v === "close" || v === "wrong" || v === "skipped";
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

interface Envelope {
  eventType: string;
  eventId?: string;
  sequenceNo?: number;
  audioTsMs?: number;
  sessionId?: string;
}

function readEnvelope(msg: Record<string, unknown>): Envelope {
  const eventType = asString(msg.event_type) ?? asString(msg.type) ?? "";
  return {
    eventType,
    eventId: asString(msg.event_id),
    sequenceNo: asNumber(msg.sequence_no),
    audioTsMs: asNumber(msg.audio_ts_ms),
    sessionId: asString(msg.session_id),
  };
}

function wordFields(
  msg: Record<string, unknown>,
  env: Envelope,
): Omit<HifzWordEvent, "type"> | null {
  const surah = asNumber(msg.surah);
  const ayah = asNumber(msg.ayah);
  const wordIndex = asNumber(msg.word_index);
  const expected = asString(msg.expected);
  const status = msg.status;
  const prob = asNumber(msg.prob) ?? asNumber(msg.confidence);
  if (
    surah === undefined ||
    ayah === undefined ||
    wordIndex === undefined ||
    expected === undefined ||
    !isWordStatus(status) ||
    prob === undefined
  ) {
    return null;
  }
  const finality = asString(msg.finality);
  const out: Omit<HifzWordEvent, "type"> = {
    surah,
    ayah,
    word_index: wordIndex,
    expected,
    status,
    prob,
    heard: asString(msg.heard) ?? null,
    reason: asString(msg.reason),
    eventId: env.eventId,
    sequenceNo: env.sequenceNo,
    audioTsMs: env.audioTsMs,
  };
  // Optional phase-6 fields stay ABSENT when the server does not send
  // them (v1 servers): callers deep-compare these objects, and an
  // explicit `undefined` key is not the same as a missing key.
  if (msg.needs_review === true) out.needsReview = true;
  if (finality === "provisional" || finality === "stable" || finality === "final") {
    out.finality = finality;
  }
  return out;
}

/**
 * Parse one server text frame (v2 envelope or bare v1 shape). Returns
 * null for anything that is not a well-formed Hifz event (unknown
 * type, wrong shape) — the caller logs and ignores it, never crashes
 * the session on it.
 */
export function parseServerEvent(raw: string): HifzServerEvent | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(msg)) return null;
  const env = readEnvelope(msg);
  switch (env.eventType) {
    case "stable_word":
    case "final_word":
    case "skipped":
    case "wrong":
    case "word": {
      const w = wordFields(msg, env);
      if (!w) return null;
      return { type: "word", ...w, isFinal: env.eventType === "final_word" };
    }
    case "correction": {
      const w = wordFields(msg, env);
      if (!w) return null;
      return { type: "correction", ...w, correctsEventId: asString(msg.corrects_event_id) };
    }
    case "partial": {
      const surah = asNumber(msg.surah);
      const ayah = asNumber(msg.ayah);
      const wordIndex = asNumber(msg.word_index);
      const expected = asString(msg.expected);
      if (surah === undefined || ayah === undefined || wordIndex === undefined || expected === undefined) {
        return null;
      }
      return {
        type: "partial",
        surah,
        ayah,
        word_index: wordIndex,
        expected,
        retracted: msg.retracted === true ? true : undefined,
        eventId: env.eventId,
        sequenceNo: env.sequenceNo,
        audioTsMs: env.audioTsMs,
      };
    }
    case "repeat": {
      const surah = asNumber(msg.surah);
      const ayah = asNumber(msg.ayah);
      const wordIndex = asNumber(msg.word_index);
      const expected = asString(msg.expected);
      if (surah === undefined || ayah === undefined || wordIndex === undefined || expected === undefined) {
        return null;
      }
      return {
        type: "repeat",
        surah,
        ayah,
        word_index: wordIndex,
        expected,
        eventId: env.eventId,
        sequenceNo: env.sequenceNo,
        audioTsMs: env.audioTsMs,
      };
    }
    case "revisit": {
      const surah = asNumber(msg.surah);
      const ayah = asNumber(msg.ayah);
      if (surah === undefined || ayah === undefined) {
        return null;
      }
      return {
        type: "revisit",
        surah,
        ayah,
        eventId: env.eventId,
        sequenceNo: env.sequenceNo,
        audioTsMs: env.audioTsMs,
      };
    }
    case "progress": {
      const surah = asNumber(msg.surah);
      const ayah = asNumber(msg.ayah);
      const words = asNumber(msg.words);
      const skipped = asNumber(msg.skipped);
      if (surah === undefined || ayah === undefined || words === undefined || skipped === undefined) {
        return null;
      }
      return {
        type: "progress",
        surah,
        ayah,
        words,
        skipped,
        eventId: env.eventId,
        sequenceNo: env.sequenceNo,
        audioTsMs: env.audioTsMs,
      };
    }
    case "extra":
      return asString(msg.text) !== undefined
        ? {
            type: "extra",
            text: asString(msg.text) as string,
            eventId: env.eventId,
            sequenceNo: env.sequenceNo,
            audioTsMs: env.audioTsMs,
          }
        : null;
    case "located":
      return asNumber(msg.ayah) !== undefined
        ? {
            type: "located",
            surah: asNumber(msg.surah),
            ayah: asNumber(msg.ayah) as number,
            eventId: env.eventId,
            sequenceNo: env.sequenceNo,
            audioTsMs: env.audioTsMs,
          }
        : null;
    case "final": {
      const counts = msg.counts;
      return {
        type: "final",
        attempt_id: asString(msg.attempt_id),
        surah: asNumber(msg.surah),
        ayahs: Array.isArray(msg.ayahs)
          ? (msg.ayahs.filter((n) => typeof n === "number") as number[])
          : undefined,
        counts: isRecord(counts) ? (counts as HifzFinalEvent["counts"]) : undefined,
        extra_words: Array.isArray(msg.extra_words)
          ? (msg.extra_words.filter((s) => typeof s === "string") as string[])
          : undefined,
        eventId: env.eventId,
        sequenceNo: env.sequenceNo,
        audioTsMs: env.audioTsMs,
      };
    }
    case "error":
      return asString(msg.code) !== undefined
        ? {
            type: "error",
            code: asString(msg.code) as string,
            message: asString(msg.message),
            fatal: typeof msg.fatal === "boolean" ? msg.fatal : undefined,
            eventId: env.eventId,
            sequenceNo: env.sequenceNo,
            audioTsMs: env.audioTsMs,
          }
        : null;
    case "warning":
      return asString(msg.code) !== undefined
        ? {
            type: "warning",
            code: asString(msg.code) as string,
            message: asString(msg.message),
            dropped: asNumber(msg.dropped),
            clippedFrames: asNumber(msg.clipped_frames),
            eventId: env.eventId,
            sequenceNo: env.sequenceNo,
            audioTsMs: env.audioTsMs,
          }
        : null;
    case "session_started":
    case "engine_ready":
    case "audio_ready":
    case "listening":
      return {
        type: env.eventType as HifzReadinessKind,
        surah: asNumber(msg.surah),
        ayah: asNumber(msg.ayah),
        engine: asString(msg.engine),
        buildMs: asNumber(msg.build_ms),
        warmupMs: asNumber(msg.warmup_ms),
        state: asString(msg.state),
        eventId: env.eventId,
        sequenceNo: env.sequenceNo,
        audioTsMs: env.audioTsMs,
      };
    case "session_ended":
      return asString(msg.reason) !== undefined
        ? {
            type: "session_ended",
            reason: asString(msg.reason) as string,
            state: asString(msg.state),
            words: asNumber(msg.words),
            skipped: asNumber(msg.skipped),
            audioMs: asNumber(msg.audio_ms),
            eventId: env.eventId,
            sequenceNo: env.sequenceNo,
            audioTsMs: env.audioTsMs,
          }
        : null;
    default:
      return null;
  }
}

/** Stable key of one word slot: surah:ayah:word_index. */
export function wordKey(surah: number, ayah: number, wordIndex: number): string {
  return `${surah}:${ayah}:${wordIndex}`;
}

/**
 * Drop exact retransmits (v2: same `event_id` twice). The server
 * never replays, but on an unstable network a frame can arrive twice;
 * `event_id` is the authoritative dedup key. Events without an id
 * (v1 servers) pass through — slot-level dedup below covers them.
 */
export function dedupeByEventId(
  events: HifzServerEvent[],
  seen: Set<string> = new Set<string>(),
): HifzServerEvent[] {
  const out: HifzServerEvent[] = [];
  for (const ev of events) {
    const id = "eventId" in ev ? ev.eventId : undefined;
    if (id === undefined) {
      out.push(ev);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(ev);
  }
  return out;
}

/**
 * Slot-level dedup for v1 servers (no `event_id`): keep the FIRST
 * `word` event per slot; a `correction` always overwrites. v2
 * servers never send a duplicate slot as a `word` (they send
 * `correction`), so this is a no-op there.
 */
export function dedupeWordEvents(
  events: HifzServerEvent[],
  seen: Set<string> = new Set<string>(),
): HifzServerEvent[] {
  const out: HifzServerEvent[] = [];
  for (const ev of events) {
    if (ev.type !== "word") {
      out.push(ev);
      continue;
    }
    const key = wordKey(ev.surah, ev.ayah, ev.word_index);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

/** First client message on the live socket (v2 contract). */
export function buildStartMessage(surah: number, ayah: number): string {
  return JSON.stringify({
    type: "start",
    surah,
    ayah,
    protocol_version: HIFZ_PROTOCOL_VERSION,
    audio: { sample_rate: HIFZ_SAMPLE_RATE, channels: HIFZ_CHANNELS, format: HIFZ_AUDIO_FORMAT },
  });
}

/** Client message that stores the session and asks for `final`. */
export const END_MESSAGE = JSON.stringify({ type: "end" });

/** Client message that closes without storing (same as abrupt close). */
export const CANCEL_MESSAGE = JSON.stringify({ type: "cancel" });

/**
 * True for a well-formed live audio frame: even length (Int16LE),
 * non-empty, within the server's 64 KiB cap. The healthy profile is
 * 4096 samples (8192 bytes); the server accepts any even length up
 * to the cap, so a native chunk that is not exactly 4096 samples is
 * still valid — it is just not the documented profile.
 */
export function isValidPcm16Frame(bytes: Uint8Array): boolean {
  return bytes.length > 0 && bytes.length % 2 === 0 && bytes.length <= HIFZ_MAX_FRAME_BYTES;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 → bytes without Buffer/atob (neither is guaranteed in Hermes). */
export function decodeBase64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4) - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const n =
      (B64_ALPHABET.indexOf(clean[i] ?? "A") << 18) |
      (B64_ALPHABET.indexOf(clean[i + 1] ?? "A") << 12) |
      ((clean[i + 2] === "=" ? 0 : B64_ALPHABET.indexOf(clean[i + 2] ?? "A")) << 6) |
      (clean[i + 3] === "=" ? 0 : B64_ALPHABET.indexOf(clean[i + 3] ?? "A"));
    if (o < outLen) out[o] = (n >> 16) & 0xff;
    if (o + 1 < outLen) out[o + 1] = (n >> 8) & 0xff;
    if (o + 2 < outLen) out[o + 2] = n & 0xff;
    o += 3;
  }
  return out;
}

/** Bytes → base64 (kept for symmetry; the grade path writes raw bytes). */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(n >> 18) & 63];
    out += B64_ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64_ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[n & 63] : "=";
  }
  return out;
}

/**
 * Wrap raw PCM16 mono 16 kHz samples in a 44-byte RIFF/WAVE header —
 * exactly what `validate_wav_16k_mono` (hifz_service.py) accepts.
 * The input MUST already be 16 kHz mono PCM16 (the capture layer
 * records at that rate natively; no resampling is done here — R-01:
 * never send a frame whose real rate is unknown).
 */
export function encodeWav16kMono(pcm: Uint8Array): Uint8Array {
  if (pcm.length % 2 !== 0) throw new Error("pcm16 buffer must have even length");
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, HIFZ_CHANNELS, true);
  view.setUint32(24, HIFZ_SAMPLE_RATE, true);
  view.setUint32(28, HIFZ_SAMPLE_RATE * HIFZ_CHANNELS * 2, true); // byte rate
  view.setUint16(32, HIFZ_CHANNELS * 2, true); // block align
  view.setUint16(34, HIFZ_BITS_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Read back a WAV header the way the server validates it. */
export function parseWavHeader(wav: Uint8Array): {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
} | null {
  if (wav.length < 44) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset: number, len: number): string => {
    let s = "";
    for (let i = 0; i < len; i += 1) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE" || ascii(12, 4) !== "fmt ") return null;
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}

/** Human-readable meaning of a live-socket close code. 4409 is
    shared by the frame-rate limiter and the live-stream limiter
    (phase 11): the server's close REASON names which one fired
    (hifz_rate_limited vs hifz_too_many_streams) — see
    HifzLiveClient.onclose, which prefers the reason. 1011 is the
    router's generic stream error (hifz_stream_error). */
export function describeWsCloseCode(code: number): string {
  switch (code) {
    case 1000:
      return "closed-normal";
    case 1009:
      return "frame-too-large";
    case 1011:
      return "stream-error";
    case 4400:
      return "bad-start-message";
    case 4401:
      return "auth-rejected";
    case 4404:
      return "session-not-found";
    case 4409:
      return "rate-limited";
    case 4500:
      return "engine-or-mapping-unavailable";
    default:
      return `closed-${code}`;
  }
}
