/**
 * apps/mobile — src/lib/listenPlayer.test.mjs
 *
 * Node-only tests for the pure listen-player logic (no React Native,
 * no audio). Run: `npm run test:listen-player`
 * (Node >= 22 type-strips the .ts import).
 *
 * These tests assert the same decisions the web player makes
 * (`apps/web/lib/hifz-player.ts`, `quran-recitation-timing.ts`) plus
 * the server merge rule (`hifz_listen_sync.py`) — never invented
 * behaviour. The two-device scenario is covered at the API level in
 * `apps/api/tests/test_hifz_listen_sync.py`; here the client-side
 * merge half is tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampListenRepeatCount,
  defaultListenPosition,
  formatListenClock,
  interpolateWordTimings,
  listenRepeatNext,
  listenRepeatRemaining,
  localPositionToServer,
  mergeListenPositions,
  nextListenRepeatMode,
  nextListenSpeed,
  normalizeListenSpeed,
  parseListenPosition,
  serverPositionToLocal,
  wordIndexAtTimeMs,
} from "./listenPlayer.ts";

const input = (overrides = {}) => ({
  currentAyah: 1,
  ayahCount: 7,
  mode: "off",
  ayahRepeatCount: 1,
  range: null,
  ayahPlays: 1,
  rangePlays: 1,
  ...overrides,
});

test("speeds: only the six Tarteel speeds are valid; cycle wraps 1.75 → 0.5", () => {
  assert.equal(normalizeListenSpeed(1.25), 1.25);
  assert.equal(normalizeListenSpeed(2), 1);
  assert.equal(normalizeListenSpeed(0.9), 1);
  assert.equal(normalizeListenSpeed("1"), 1);
  assert.equal(nextListenSpeed(1), 1.25);
  assert.equal(nextListenSpeed(1.75), 0.5);
  assert.equal(nextListenSpeed(0.5), 0.75);
});

test("repeat: off plays straight through once, then stops at the surah end", () => {
  assert.deepEqual(listenRepeatNext(input({ currentAyah: 3 })), {
    action: "goto",
    ayah: 4,
    ayahPlays: 1,
    rangePlays: 1,
  });
  assert.deepEqual(listenRepeatNext(input({ currentAyah: 7 })), {
    action: "stop",
    ayahPlays: 1,
    rangePlays: 1,
  });
});

test("repeat: ayah mode replays the ayah N times, then moves on", () => {
  const r1 = listenRepeatNext(input({ mode: "ayah", ayahRepeatCount: 3, currentAyah: 2, ayahPlays: 1 }));
  assert.equal(r1.action, "replay");
  assert.equal(r1.ayah, 2);
  const r2 = listenRepeatNext(input({ mode: "ayah", ayahRepeatCount: 3, currentAyah: 2, ayahPlays: 3 }));
  assert.deepEqual(r2, { action: "goto", ayah: 3, ayahPlays: 1, rangePlays: 1 });
  assert.equal(listenRepeatRemaining(input({ mode: "ayah", ayahRepeatCount: 3, ayahPlays: 2 })), 2);
  assert.equal(listenRepeatRemaining(input({ mode: "off" })), null);
});

test("repeat: surah mode restarts at ayah 1 after the last ayah", () => {
  assert.deepEqual(listenRepeatNext(input({ mode: "surah", currentAyah: 7 })), {
    action: "goto",
    ayah: 1,
    ayahPlays: 1,
    rangePlays: 1,
  });
});

test("repeat: range mode loops the range, then continues after it", () => {
  const range = { start: 2, end: 4, count: 2 };
  // Mid-range advances.
  assert.equal(listenRepeatNext(input({ mode: "range", range, currentAyah: 2 })).ayah, 3);
  // End of range, first pass → restart the range.
  assert.deepEqual(listenRepeatNext(input({ mode: "range", range, currentAyah: 4, rangePlays: 1 })), {
    action: "goto",
    ayah: 2,
    ayahPlays: 1,
    rangePlays: 2,
  });
  // End of range, last pass → continue after the range.
  assert.deepEqual(listenRepeatNext(input({ mode: "range", range, currentAyah: 4, rangePlays: 2 })), {
    action: "goto",
    ayah: 5,
    ayahPlays: 1,
    rangePlays: 2,
  });
  // Range ending at the surah end stops after the last pass.
  const tail = { start: 5, end: 7, count: 1 };
  assert.equal(listenRepeatNext(input({ mode: "range", range: tail, currentAyah: 7 })).action, "stop");
  assert.equal(listenRepeatRemaining(input({ mode: "range", range, rangePlays: 1 })), 2);
});

test("repeat: counts clamp to 1–20; mode cycles off → ayah → range → surah", () => {
  assert.equal(clampListenRepeatCount(0), 1);
  assert.equal(clampListenRepeatCount(99), 20);
  assert.equal(clampListenRepeatCount(Number.NaN), 1);
  assert.equal(nextListenRepeatMode("off"), "ayah");
  assert.equal(nextListenRepeatMode("range"), "surah");
  assert.equal(nextListenRepeatMode("surah"), "off");
});

test("timings: word lookup by ms; interpolation spreads by length and covers the ayah", () => {
  const words = [
    { word: 1, startMs: 0, endMs: 400 },
    { word: 2, startMs: 400, endMs: 900 },
  ];
  assert.equal(wordIndexAtTimeMs(words, 0), 1);
  assert.equal(wordIndexAtTimeMs(words, 399), 1);
  assert.equal(wordIndexAtTimeMs(words, 400), 2);
  assert.equal(wordIndexAtTimeMs(words, 900), null);
  assert.equal(wordIndexAtTimeMs(words, -5), null);

  const interp = interpolateWordTimings(["ab", "cdef"], 1000);
  assert.equal(interp.length, 2);
  assert.equal(interp[0].startMs, 0);
  assert.equal(interp[1].endMs, 1000);
  // "ab" (2 chars) gets 1/3 of the duration, "cdef" (4) gets 2/3.
  assert.equal(interp[0].endMs, 333);
  assert.deepEqual(interpolateWordTimings([], 1000), []);
  assert.deepEqual(interpolateWordTimings(["x"], 0), []);
});

test("position: parse accepts a valid position, rejects corrupt/out-of-range", () => {
  const good = parseListenPosition({
    reciter: "husary",
    surah: 36,
    ayah: 12,
    progressMs: 120000,
    speed: 1.25,
    repeatMode: "ayah",
    repeatAyah: 3,
    repeatRangeStart: null,
    repeatRangeEnd: null,
    repeatRangeCount: 1,
    updatedAt: 1000,
  });
  assert.ok(good);
  assert.equal(good.surah, 36);
  assert.equal(good.speed, 1.25);
  assert.equal(parseListenPosition(null), null);
  assert.equal(parseListenPosition({ reciter: "x", surah: 115, ayah: 1, progressMs: 0 }), null);
  assert.equal(parseListenPosition({ reciter: "x", surah: 1, ayah: 0, progressMs: 0 }), null);
  assert.equal(parseListenPosition({ reciter: "x", surah: 1, ayah: 1, progressMs: -1 }), null);
  // Invalid speed falls back to 1 instead of rejecting (web parity).
  assert.equal(parseListenPosition({ reciter: "x", surah: 1, ayah: 1, progressMs: 0, speed: 2 })?.speed, 1);
  // Range mode without bounds is rejected.
  assert.equal(
    parseListenPosition({ reciter: "x", surah: 1, ayah: 1, progressMs: 0, repeatMode: "range" }),
    null,
  );
});

test("merge: server-newer wins, local-newer (or equal) keeps local + pushes", () => {
  const local = { ...defaultListenPosition("alafasy", 2), ayah: 5, updatedAt: 2000 };
  const serverOld = { ...defaultListenPosition("alafasy", 2), ayah: 3, updatedAt: 1000 };
  const serverNew = { ...defaultListenPosition("alafasy", 2), ayah: 9, updatedAt: 3000 };

  assert.deepEqual(mergeListenPositions(local, null), { source: "local", shouldPush: true, position: local });
  assert.deepEqual(mergeListenPositions(null, serverNew), {
    source: "server",
    shouldPush: false,
    position: serverNew,
  });
  assert.deepEqual(mergeListenPositions(null, null), { source: "none", shouldPush: false, position: null });
  // Local newer → keep local, push it.
  assert.equal(mergeListenPositions(local, serverOld).source, "local");
  assert.equal(mergeListenPositions(local, serverOld).shouldPush, true);
  // Server newer → adopt server, do not push.
  const adopted = mergeListenPositions(local, serverNew);
  assert.equal(adopted.source, "server");
  assert.equal(adopted.shouldPush, false);
  assert.equal(adopted.position.ayah, 9);
  // Equal timestamps → local wins (deterministic tie-break).
  assert.equal(mergeListenPositions(local, { ...serverOld, updatedAt: 2000 }).source, "local");
});

test("wire mapping: server snake_case round-trips through local and back", () => {
  const wire = {
    reciter: "husary",
    surah: 36,
    ayah: 12,
    progress_ms: 120000,
    speed: 1,
    repeat_mode: "off",
    repeat_ayah: 1,
    repeat_range_start: null,
    repeat_range_end: null,
    repeat_range_count: 1,
    updated_at: "2026-11-07T12:00:00Z",
    created_at: "2026-11-07T12:00:00Z",
  };
  const local = serverPositionToLocal(wire);
  assert.ok(local);
  assert.equal(local.surah, 36);
  assert.equal(local.updatedAt, Date.parse("2026-11-07T12:00:00Z"));
  const back = localPositionToServer(local);
  assert.equal(back.reciter, "husary");
  assert.equal(back.progress_ms, 120000);
  assert.equal(back.updated_at, "2026-11-07T12:00:00.000Z");
  assert.equal(serverPositionToLocal(null), null);
  assert.equal(serverPositionToLocal({ reciter: "x", surah: 999 }), null);
});

test("clock: ms formats as m:ss", () => {
  assert.equal(formatListenClock(0), "0:00");
  assert.equal(formatListenClock(65000), "1:05");
  assert.equal(formatListenClock(600000), "10:00");
  assert.equal(formatListenClock(-500), "0:00");
});
