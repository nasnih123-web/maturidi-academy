/**
 * apps/mobile — src/lib/hifzProtocol.test.mjs
 *
 * Node-only tests for the pure Hifz protocol helpers (no React Native,
 * no jest in apps/mobile). Run: `npm run test:hifz-protocol`
 * (Node >= 22 type-strips the .ts import).
 *
 * These tests assert the wire contract against
 * hifz_ws_contract.py / hifz_router.py / hifz_service.py — never
 * against invented behaviour. Both the v2 envelope and the bare v1
 * shape are covered, because a not-yet-upgraded server still speaks v1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HIFZ_FRAME_BYTES,
  HIFZ_MAX_FRAME_BYTES,
  HIFZ_PROTOCOL_VERSION,
  HIFZ_SAMPLE_RATE,
  buildStartMessage,
  decodeBase64ToBytes,
  dedupeByEventId,
  dedupeWordEvents,
  describeWsCloseCode,
  encodeBytesToBase64,
  encodeWav16kMono,
  isValidPcm16Frame,
  parseServerEvent,
  parseWavHeader,
  wordKey,
} from "./hifzProtocol.ts";

/** A v2-enveloped stable_word event, as the server builds it. */
const v2Word = (overrides = {}) => ({
  session_id: "attempt-1",
  event_id: "e-1",
  sequence_no: 7,
  event_type: "stable_word",
  type: "word",
  status: "correct",
  audio_ts_ms: 512,
  surah: 1,
  ayah: 1,
  word_index: 2,
  expected: "ٱلْحَمْدُ",
  prob: 0.95,
  confidence: 0.95,
  heard: "الحمد",
  ...overrides,
});

/** The same word as a bare v1 event (no envelope). */
const v1Word = (word_index, status = "correct") => ({
  type: "word",
  surah: 1,
  ayah: 1,
  word_index,
  expected: "ٱلْحَمْدُ",
  status,
  prob: 0.9,
});

test("protocol version is 2 and the start message declares the audio format", () => {
  assert.equal(HIFZ_PROTOCOL_VERSION, 2);
  assert.deepEqual(JSON.parse(buildStartMessage(2, 255)), {
    type: "start",
    surah: 2,
    ayah: 255,
    protocol_version: 2,
    audio: { sample_rate: 16000, channels: 1, format: "pcm16le" },
  });
});

test("parseServerEvent reads a v2 stable_word envelope", () => {
  const ev = parseServerEvent(JSON.stringify(v2Word()));
  assert.equal(ev?.type, "word");
  assert.equal(ev?.status, "correct");
  assert.equal(ev?.prob, 0.95);
  assert.equal(ev?.eventId, "e-1");
  assert.equal(ev?.sequenceNo, 7);
  assert.equal(ev?.audioTsMs, 512);
  assert.equal(ev?.isFinal, false);
});

test("parseServerEvent maps final_word/skipped/wrong to word events", () => {
  const fin = parseServerEvent(JSON.stringify(v2Word({ event_type: "final_word", status: "skipped", prob: 0 })));
  assert.equal(fin?.type, "word");
  assert.equal(fin?.status, "skipped");
  assert.equal(fin?.isFinal, true);
  const wrong = parseServerEvent(JSON.stringify(v2Word({ event_type: "wrong", status: "wrong" })));
  assert.equal(wrong?.status, "wrong");
});

test("parseServerEvent reads a v2 correction (same slot, new verdict)", () => {
  const ev = parseServerEvent(
    JSON.stringify({
      ...v2Word({ event_type: "correction", event_id: "e-2", sequence_no: 8, status: "close", prob: 0.65 }),
      corrects_event_id: "e-1",
      reason: "wrong_tashkeel",
    }),
  );
  assert.equal(ev?.type, "correction");
  assert.equal(ev?.status, "close");
  assert.equal(ev?.correctsEventId, "e-1");
  assert.equal(ev?.reason, "wrong_tashkeel");
});

test("parseServerEvent reads partial/progress/readiness/warning/session_ended/final", () => {
  const partial = parseServerEvent(
    JSON.stringify({ event_type: "partial", type: "partial", status: "partial", surah: 1, ayah: 1, word_index: 0, expected: "قُلْ", sequence_no: 3 }),
  );
  assert.deepEqual(
    { type: partial?.type, word_index: partial?.word_index, expected: partial?.expected },
    { type: "partial", word_index: 0, expected: "قُلْ" },
  );
  const progress = parseServerEvent(
    JSON.stringify({ event_type: "progress", type: "progress", status: "ok", surah: 1, ayah: 2, words: 5, skipped: 1 }),
  );
  assert.equal(progress?.type, "progress");
  assert.equal(progress?.ayah, 2);
  const listening = parseServerEvent(
    JSON.stringify({ event_type: "listening", type: "listening", status: "ok", surah: 1, ayah: 1 }),
  );
  assert.equal(listening?.type, "listening");
  const warning = parseServerEvent(
    JSON.stringify({ event_type: "warning", type: "warning", status: "warning", code: "hifz_audio_clipping", message: "clip" }),
  );
  assert.equal(warning?.type, "warning");
  assert.equal(warning?.code, "hifz_audio_clipping");
  const ended = parseServerEvent(
    JSON.stringify({ event_type: "session_ended", type: "session_ended", status: "ok", reason: "max_duration", words: 40, skipped: 2, audio_ms: 60000 }),
  );
  assert.equal(ended?.type, "session_ended");
  assert.equal(ended?.reason, "max_duration");
  const fin = parseServerEvent(
    JSON.stringify({ event_type: "final", type: "final", status: "ok", attempt_id: "a-1", surah: 1, ayahs: [1], counts: { correct: 5, close: 1, wrong: 0, skipped: 1 }, extra_words: [] }),
  );
  assert.equal(fin?.type, "final");
  assert.deepEqual(fin?.counts, { correct: 5, close: 1, wrong: 0, skipped: 1 });
});

test("parseServerEvent still reads bare v1 events (old server)", () => {
  const ev = parseServerEvent(JSON.stringify(v1Word(2, "close")));
  assert.deepEqual(ev, { ...v1Word(2, "close"), heard: null, reason: undefined, isFinal: false, eventId: undefined, sequenceNo: undefined, audioTsMs: undefined });
});

test("parseServerEvent rejects malformed frames without throwing", () => {
  assert.equal(parseServerEvent("not json"), null);
  assert.equal(parseServerEvent('{"type":"word","surah":1}'), null); // missing fields
  assert.equal(parseServerEvent('{"type":"word","surah":1,"ayah":1,"word_index":0,"expected":"x","status":"nope","prob":0.5}'), null);
  assert.equal(parseServerEvent('{"type":"mystery"}'), null);
  assert.equal(parseServerEvent('{"event_type":"stable_word","surah":1}'), null);
});

test("dedupeByEventId drops an exact retransmit, keeps distinct events", () => {
  const a = v2Word({ event_id: "e-1" });
  const b = v2Word({ event_id: "e-2", word_index: 3 });
  const out = dedupeByEventId([a, b, a].map((e) => parseServerEvent(JSON.stringify(e))));
  assert.equal(out.length, 2);
  assert.equal(out[1].word_index, 3);
});

test("dedupeWordEvents drops a repeated v1 word slot, keeps order", () => {
  const events = [v1Word(0), v1Word(1), v1Word(0), { type: "extra", text: "e" }, v1Word(1, "wrong")];
  const out = dedupeWordEvents(events.map((e) => parseServerEvent(JSON.stringify(e))));
  assert.equal(out.length, 3);
  assert.equal(out[0].word_index, 0);
  assert.equal(out[1].word_index, 1);
  assert.equal(out[2].type, "extra");
  // The first occurrence wins, not the later "wrong" duplicate.
  assert.equal(out[1].status, "correct");
});

test("dedupeWordEvents shares the seen-set across batches", () => {
  const seen = new Set();
  assert.equal(dedupeWordEvents([parseServerEvent(JSON.stringify(v1Word(0)))], seen).length, 1);
  assert.equal(dedupeWordEvents([parseServerEvent(JSON.stringify(v1Word(0))), parseServerEvent(JSON.stringify(v1Word(1)))], seen).length, 1);
  assert.equal(wordKey(1, 2, 3), "1:2:3");
});

test("base64 round-trips PCM bytes (incl. padding cases)", () => {
  for (const bytes of [
    new Uint8Array([0]),
    new Uint8Array([0, 1]),
    new Uint8Array([0, 1, 2]),
    new Uint8Array([255, 254, 253, 252, 251]),
    new Uint8Array(1600).map((_, i) => i % 256),
  ]) {
    assert.deepEqual(decodeBase64ToBytes(encodeBytesToBase64(bytes)), bytes);
  }
  assert.deepEqual(decodeBase64ToBytes("AAEC"), new Uint8Array([0, 1, 2]));
  assert.deepEqual(decodeBase64ToBytes("AAE="), new Uint8Array([0, 1]));
  assert.deepEqual(decodeBase64ToBytes("AA=="), new Uint8Array([0]));
});

test("encodeWav16kMono produces a header validate_wav_16k_mono accepts", () => {
  const pcm = new Uint8Array(3200); // 100 ms @16 kHz mono PCM16
  const wav = encodeWav16kMono(pcm);
  assert.equal(wav.length, 44 + 3200);
  const header = parseWavHeader(wav);
  assert.deepEqual(header, { channels: 1, sampleRate: HIFZ_SAMPLE_RATE, bitsPerSample: 16, dataBytes: 3200 });
  // Round-trip: payload survives the header.
  assert.deepEqual(wav.slice(44), pcm);
});

test("encodeWav16kMono rejects odd-length PCM", () => {
  assert.throws(() => encodeWav16kMono(new Uint8Array([1])), /even length/);
});

test("parseWavHeader rejects non-WAV input", () => {
  assert.equal(parseWavHeader(new Uint8Array([1, 2, 3])), null);
  assert.equal(parseWavHeader(new Uint8Array(44)), null);
});

test("isValidPcm16Frame enforces the v2 server limits", () => {
  assert.equal(HIFZ_FRAME_BYTES, 8192);
  assert.equal(isValidPcm16Frame(new Uint8Array(8192)), true); // healthy v2 profile
  assert.equal(isValidPcm16Frame(new Uint8Array(3200)), true); // shorter chunk still valid
  assert.equal(isValidPcm16Frame(new Uint8Array(HIFZ_MAX_FRAME_BYTES)), true);
  assert.equal(isValidPcm16Frame(new Uint8Array(0)), false);
  assert.equal(isValidPcm16Frame(new Uint8Array(3)), false);
  assert.equal(isValidPcm16Frame(new Uint8Array(HIFZ_MAX_FRAME_BYTES + 2)), false);
});

test("describeWsCloseCode names the v2 close codes", () => {
  assert.equal(describeWsCloseCode(4401), "auth-rejected");
  assert.equal(describeWsCloseCode(4404), "session-not-found");
  assert.equal(describeWsCloseCode(4409), "rate-limited");
  assert.equal(describeWsCloseCode(1009), "frame-too-large");
  assert.equal(describeWsCloseCode(4500), "engine-or-mapping-unavailable");
  assert.equal(describeWsCloseCode(1000), "closed-normal");
  assert.equal(describeWsCloseCode(1011), "stream-error");
});

test("parseServerEvent keeps needs_review and finality on word events (phase 6)", () => {
  const ev = parseServerEvent(JSON.stringify(v2Word({ needs_review: true, finality: "stable" })));
  assert.equal(ev?.type, "word");
  assert.equal(ev?.needsReview, true);
  assert.equal(ev?.finality, "stable");
  const plain = parseServerEvent(JSON.stringify(v2Word()));
  assert.equal(plain?.needsReview, undefined);
  assert.equal(plain?.finality, undefined);
});

test("parseServerEvent keeps needs_review on correction events (phase 6)", () => {
  const ev = parseServerEvent(
    JSON.stringify({ ...v2Word({ event_type: "correction", corrects_event_id: "e-0", needs_review: true }) }),
  );
  assert.equal(ev?.type, "correction");
  assert.equal(ev?.needsReview, true);
  assert.equal(ev?.correctsEventId, "e-0");
});

test("parseServerEvent marks a retracted partial (phase 6)", () => {
  const ev = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-9", sequence_no: 9, event_type: "partial", type: "partial",
      status: "retracted", audio_ts_ms: 100, surah: 1, ayah: 1, word_index: 3,
      expected: "ٱلرَّحْمَٰنِ", heard: null, retracted: true,
    }),
  );
  assert.equal(ev?.type, "partial");
  assert.equal(ev?.retracted, true);
  const live = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-8", sequence_no: 8, event_type: "partial", type: "partial",
      status: "partial", audio_ts_ms: 90, surah: 1, ayah: 1, word_index: 3,
      expected: "ٱلرَّحْمَٰنِ", heard: null,
    }),
  );
  assert.equal(live?.retracted, undefined);
});

test("parseServerEvent parses repeat and revisit events (phase 6)", () => {
  const rep = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-10", sequence_no: 10, event_type: "repeat", type: "repeat",
      status: "ok", audio_ts_ms: 200, surah: 18, ayah: 110, word_index: 0, expected: "قُلْ",
    }),
  );
  assert.equal(rep?.type, "repeat");
  assert.equal(rep?.ayah, 110);
  assert.equal(rep?.expected, "قُلْ");
  const rev = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-11", sequence_no: 11, event_type: "revisit", type: "revisit",
      status: "ok", audio_ts_ms: 210, surah: 18, ayah: 109,
    }),
  );
  assert.equal(rev?.type, "revisit");
  assert.equal(rev?.ayah, 109);
});

test("parseServerEvent keeps readiness payload and warning counters", () => {
  const ready = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-2", sequence_no: 2, event_type: "engine_ready", type: "engine_ready",
      status: "ok", audio_ts_ms: 0, engine: "zipformer", build_ms: 1200.5, warmup_ms: 300.2,
      state: "engine_loading",
    }),
  );
  assert.equal(ready?.type, "engine_ready");
  assert.equal(ready?.engine, "zipformer");
  assert.equal(ready?.buildMs, 1200.5);
  assert.equal(ready?.warmupMs, 300.2);
  const warn = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-3", sequence_no: 3, event_type: "warning", type: "warning",
      status: "warning", audio_ts_ms: 0, code: "hifz_audio_clipping", clipped_frames: 12,
    }),
  );
  assert.equal(warn?.type, "warning");
  assert.equal(warn?.clippedFrames, 12);
  const ended = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-4", sequence_no: 4, event_type: "session_ended", type: "session_ended",
      status: "ok", audio_ts_ms: 0, reason: "max_duration", state: "completed", words: 10, skipped: 1, audio_ms: 5000,
    }),
  );
  assert.equal(ended?.type, "session_ended");
  assert.equal(ended?.state, "completed");
  assert.equal(ended?.audioMs, 5000);
  const located = parseServerEvent(
    JSON.stringify({
      session_id: "a", event_id: "e-5", sequence_no: 5, event_type: "located", type: "located",
      status: "ok", audio_ts_ms: 0, surah: 18, ayah: 110,
    }),
  );
  assert.equal(located?.type, "located");
  assert.equal(located?.surah, 18);
  assert.equal(located?.ayah, 110);
});
