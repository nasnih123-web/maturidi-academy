/**
 * apps/mobile — src/hooks/useHifz.ts
 *
 * Hifz session state machine (native). Owns no UI: the screen renders
 * this hook's state and calls its actions.
 *
 * Two modes, two server paths (same as the web study page):
 * - live:  mic → PCM16 frames → WebSocket → word events in real time.
 * - grade: mic → accumulate → WAV → POST /grade after stopping.
 *
 * Safety rules (all deliberate, all surfaced — never silent):
 * - Microphone permission is requested before any capture; a denial
 *   ends the start with a clear error, never with a fake session.
 * - Live start first checks GET /hifz/status: Whisper is not a
 *   streaming engine, so a CRM-selected Whisper engine makes live
 *   fail fast with a clear message instead of a dead socket (R-10);
 *   a missing phoneme map fails fast too.
 * - `listening` means the server's recogniser was built AND warmed
 *   up (v2 readiness: session_started → engine_ready → audio_ready
 *   → listening). Frames are sent only after `listening`, so no
 *   frame is ever rejected as pre-ready; the waiting phase is shown
 *   honestly as "engine warming up" instead of fake listening.
 * - Backgrounding the app ends the session safely: live sends `end`
 *   (the partial session is stored); a grade recording is discarded
 *   with a message, because ungraded audio is never stored silently.
 * - Any native interruption that pauses capture ends the session the
 *   same way: a paused recorder that never resumes would otherwise
 *   look live while grading nothing.
 * - An abrupt close without `end` stores nothing (server contract);
 *   this hook always prefers the graceful `end()` path.
 *
 * Audio is transient: frames are streamed or held in memory only for
 * the running session; nothing is written to disk here (the grade WAV
 * lives in services/hifz.ts and is deleted right after upload).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { HIFZ_SAMPLE_RATE, wordKey, type HifzReadinessKind, type HifzServerEvent, type HifzWordStatus } from "../lib/hifzProtocol";
import {
  completeAttempt,
  createAttempt,
  getAttemptDetail,
  getHifzStatus,
  gradeAyah,
  peekWord,
  type HifzAttempt,
  type HifzGrade,
} from "../services/hifz";
import { requestMicPermission, useHifzAudioRecorder, type HifzMicPermission } from "../services/hifzAudio";
import { HifzLiveClient } from "../services/hifzLive";

export type HifzPhase =
  | "idle"
  | "preparing"
  | "waiting_engine"
  | "listening"
  | "recording"
  | "grading"
  | "done"
  | "error";
export type HifzMode = "live" | "grade";

export interface HifzLiveWord {
  surah: number;
  ayah: number;
  wordIndex: number;
  expected: string;
  status: HifzWordStatus;
  prob: number;
  heard: string | null;
  /** Phase 6: borderline verdict — not certain, wants review. The
      web study page carries the same signal without displaying it;
      mobile stores it the same way. */
  needsReview?: boolean;
  /** True while this is the most recently heard word (Tarteel: blue). */
  isLatest: boolean;
  /** Revealed with Peek (registered as a mistake server-side). */
  peeked: boolean;
}

export interface HifzDiag {
  sampleRate: number;
  framesSent: number;
  framesDropped: number;
  framesReceived: number;
  extraWords: number;
  seqGaps: number;
  /** Phase 6 counters: re-reads of an already-written unit and
      proven returns to an earlier ayah (web counts them too). */
  repeatCount: number;
  revisitCount: number;
  startedAt: number | null;
}

const EMPTY_DIAG: HifzDiag = {
  sampleRate: HIFZ_SAMPLE_RATE,
  framesSent: 0,
  framesDropped: 0,
  framesReceived: 0,
  extraWords: 0,
  seqGaps: 0,
  repeatCount: 0,
  revisitCount: 0,
  startedAt: null,
};

export interface HifzPartialWord {
  surah: number;
  ayah: number;
  wordIndex: number;
  expected: string;
}

function errorCode(e: unknown): string {
  if (e instanceof Error) return e.message || "unknown";
  return "unknown";
}

export function useHifz(): {
  phase: HifzPhase;
  mode: HifzMode;
  attempt: HifzAttempt | null;
  words: Record<string, HifzLiveWord>;
  counts: { correct: number; close: number; wrong: number; skipped: number };
  locatedAyah: number | null;
  partialWord: HifzPartialWord | null;
  readiness: HifzReadinessKind | null;
  notice: string | null;
  error: string | null;
  diag: HifzDiag;
  elapsedSec: number;
  engine: string | null;
  startLive: (surah: number, ayah: number) => Promise<void>;
  stopLive: () => Promise<void>;
  startRecording: (surah: number, ayah: number) => Promise<void>;
  stopAndGrade: () => Promise<void>;
  peekNext: (surah: number, ayah: number, ayahWords: string[]) => Promise<void>;
  completeSession: () => Promise<void>;
  reset: () => void;
} {
  const [phase, setPhase] = useState<HifzPhase>("idle");
  const [mode, setMode] = useState<HifzMode>("live");
  const [attempt, setAttempt] = useState<HifzAttempt | null>(null);
  const [words, setWords] = useState<Record<string, HifzLiveWord>>({});
  const [locatedAyah, setLocatedAyah] = useState<number | null>(null);
  const [partialWord, setPartialWord] = useState<HifzPartialWord | null>(null);
  const [readiness, setReadiness] = useState<HifzReadinessKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<HifzDiag>(EMPTY_DIAG);
  const [engine, setEngine] = useState<string | null>(null);

  const clientRef = useRef<HifzLiveClient | null>(null);
  const captureActiveRef = useRef(false);
  const surahRef = useRef(0);
  const ayahRef = useRef(0);
  const phaseRef = useRef<HifzPhase>("idle");
  const modeRef = useRef<HifzMode>("live");
  const attemptRef = useRef<HifzAttempt | null>(null);
  const latestKeyRef = useRef<string | null>(null);
  const audio = useHifzAudioRecorder();
  // The recorder object is recreated on state updates; async callbacks
  // and the unmount cleanup must use the ref, never a stale closure.
  const audioRef = useRef(audio);
  audioRef.current = audio;
  // Session clock: the recorder's native duration (ms), not a JS timer.
  const elapsedSec = Math.floor(audio.durationMs / 1000);

  phaseRef.current = phase;
  modeRef.current = mode;
  attemptRef.current = attempt;

  const counts = useMemo(() => {
    const c = { correct: 0, close: 0, wrong: 0, skipped: 0 };
    for (const w of Object.values(words)) c[w.status] += 1;
    return c;
  }, [words]);

  // Session clock comes from the native recorder (audio.durationMs);
  // no JS interval is kept for it.

  const fail = useCallback((code: string) => {
    setError(code);
    setPhase("error");
  }, []);

  const applyWordEvent = useCallback((ev: Extract<HifzServerEvent, { type: "word" }>) => {
    const key = wordKey(ev.surah, ev.ayah, ev.word_index);
    latestKeyRef.current = key;
    setWords((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const w = next[k];
        if (w) next[k] = { ...w, isLatest: false };
      }
      next[key] = {
        surah: ev.surah,
        ayah: ev.ayah,
        wordIndex: ev.word_index,
        expected: ev.expected,
        status: ev.status,
        prob: ev.prob,
        heard: ev.heard ?? null,
        needsReview: ev.needsReview ?? false,
        isLatest: true,
        peeked: prev[key]?.peeked ?? false,
      };
      return next;
    });
    setPartialWord(null);
    setDiag((d) => ({ ...d, framesReceived: d.framesReceived + 1 }));
  }, []);

  /**
   * v2 correction: a later verdict for an already-written slot
   * OVERWRITES it (same key, new status/prob/heard). It is never a
   * second word and never becomes the "latest heard" word.
   */
  const applyCorrection = useCallback((ev: Extract<HifzServerEvent, { type: "correction" }>) => {
    const key = wordKey(ev.surah, ev.ayah, ev.word_index);
    setWords((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return {
        ...prev,
        [key]: {
          ...existing,
          status: ev.status,
          prob: ev.prob,
          heard: ev.heard ?? null,
          needsReview: ev.needsReview ?? false,
          isLatest: false,
        },
      };
    });
  }, []);

  const mergeGrade = useCallback((grade: HifzGrade) => {
    setWords((prev) => {
      const next = { ...prev };
      for (const w of grade.words) {
        const key = wordKey(grade.surah, grade.ayah, w.word_index);
        next[key] = {
          surah: grade.surah,
          ayah: grade.ayah,
          wordIndex: w.word_index,
          expected: w.expected,
          status: w.status,
          prob: w.prob,
          heard: w.heard,
          isLatest: false,
          peeked: prev[key]?.peeked ?? false,
        };
      }
      return next;
    });
    setDiag((d) => ({ ...d, extraWords: d.extraWords + grade.extra_words.length }));
    setEngine(grade.engine_used);
  }, []);

  /** End the running session safely (live: graceful `end`; grade: discard). */
  const stopSessionSafely = useCallback(async (reason: string): Promise<void> => {
    const ph = phaseRef.current;
    if (ph !== "listening" && ph !== "recording" && ph !== "waiting_engine") return;
    if (captureActiveRef.current) {
      captureActiveRef.current = false;
      await audioRef.current.stopCapture().catch(() => undefined);
    }
    if (ph === "listening" && clientRef.current) {
      const client = clientRef.current;
      clientRef.current = null;
      await client.end().catch(() => undefined);
      setPhase("done");
      setError(reason);
      return;
    }
    // Still waiting for the engine, or recording: cancel, don't store.
    clientRef.current?.abort();
    clientRef.current = null;
    setPhase("idle");
    setError(reason);
  }, []);

  /** Stop capture if one is running (idempotent helper for catch paths). */
  const stopCaptureIfActive = useCallback(async (): Promise<void> => {
    if (!captureActiveRef.current) return;
    captureActiveRef.current = false;
    await audioRef.current.stopCapture().catch(() => undefined);
  }, []);

  // Backgrounding ends the session safely; unmount aborts it.
  const stopSafelyRef = useRef(stopSessionSafely);
  stopSafelyRef.current = stopSessionSafely;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "background") {
        void stopSafelyRef.current("background-stopped");
      }
    });
    return () => {
      sub.remove();
      clientRef.current?.abort();
      clientRef.current = null;
      if (captureActiveRef.current) {
        captureActiveRef.current = false;
        void audioRef.current.stopCapture().catch(() => undefined);
      }
    };
  }, []);

  const ensureMic = useCallback(async (): Promise<boolean> => {
    let perm: HifzMicPermission;
    try {
      perm = await requestMicPermission();
    } catch {
      fail("mic-permission-error");
      return false;
    }
    if (perm !== "granted") {
      fail("mic-permission-denied");
      return false;
    }
    return true;
  }, [fail]);

  const startLive = useCallback(
    async (surah: number, ayah: number): Promise<void> => {
      if (phaseRef.current !== "idle" && phaseRef.current !== "done" && phaseRef.current !== "error") return;
      setMode("live");
      modeRef.current = "live";
      setPhase("preparing");
      setError(null);
      setNotice(null);
      setReadiness(null);
      setPartialWord(null);
      setLocatedAyah(null);
      surahRef.current = surah;
      ayahRef.current = ayah;
      try {
        const status = await getHifzStatus();
        setEngine(status.engine);
        if (!status.available) {
          fail(status.reason || "engine-unavailable");
          return;
        }
        if (!status.map_available) {
          fail("mapping-unavailable");
          return;
        }
        if (status.engine === "whisper_quran") {
          // R-10: Whisper is not a streaming engine; the live socket
          // would reject the session. Fail fast with a clear message.
          fail("live-unavailable-whisper");
          return;
        }
        if (!(await ensureMic())) return;
        const att = await createAttempt(surah);
        setAttempt(att);
        const client = new HifzLiveClient({
          onEvent: (ev) => {
            if (ev.type === "word") applyWordEvent(ev);
            else if (ev.type === "correction") applyCorrection(ev);
            else if (ev.type === "partial") {
              if (ev.retracted) {
                // Phase 6: the server withdrew a stale preview — clear
                // the marker only if it is still that same slot.
                setPartialWord((prev) =>
                  prev !== null && prev.ayah === ev.ayah && prev.wordIndex === ev.word_index ? null : prev,
                );
              } else {
                setPartialWord({
                  surah: ev.surah,
                  ayah: ev.ayah,
                  wordIndex: ev.word_index,
                  expected: ev.expected,
                });
              }
            } else if (ev.type === "repeat") {
              setDiag((d) => ({ ...d, repeatCount: d.repeatCount + 1 }));
            } else if (ev.type === "revisit") {
              setDiag((d) => ({ ...d, revisitCount: d.revisitCount + 1 }));
            } else if (ev.type === "progress") setLocatedAyah(ev.ayah);
            else if (ev.type === "extra") setDiag((d) => ({ ...d, extraWords: d.extraWords + 1 }));
            else if (ev.type === "located") setLocatedAyah(ev.ayah);
          },
          onState: () => undefined,
          onReadiness: (kind, ev) => {
            setReadiness(kind);
            if (kind === "engine_ready" && ev.engine) setEngine(ev.engine);
            setPhase((p) => (p === "preparing" ? "waiting_engine" : p));
          },
          onError: (code, _message, fatal) => {
            // Non-fatal server errors (bad frame, rate warning) are
            // notices, not session failures.
            if (fatal === false) {
              setNotice(code);
              return;
            }
            fail(code);
            clientRef.current?.abort();
            clientRef.current = null;
          },
          onWarning: (ev) => {
            setNotice(ev.code);
          },
          onFinal: () => undefined,
          onSessionEnded: (ev) => {
            if (ev.reason === "max_duration") {
              // Server-side 30-minute cap: the session was finalised
              // like `end`; stop capture and show the stored result.
              void stopSessionSafely("session-max-duration");
            }
          },
          onSequenceGap: () => {
            setDiag((d) => ({ ...d, seqGaps: d.seqGaps + 1 }));
          },
          onClosed: () => undefined,
        });
        clientRef.current = client;
        // Resolves only on the server's `listening` event (engine
        // built + warmed up). Readiness milestones above move the
        // phase to waiting_engine in the meantime.
        await client.connect({ attemptId: att.id, surah, ayah });
        await audio.startCapture(
          {
            onFrame: (pcm) => {
              const sent = client.sendFrame(pcm);
              setDiag((d) => ({
                ...d,
                framesSent: d.framesSent + (sent ? 1 : 0),
                framesDropped: d.framesDropped + (sent ? 0 : 1),
              }));
            },
            onInterruption: () => {
              void stopSessionSafely("interrupted");
            },
          },
          { accumulate: false },
        );
        captureActiveRef.current = true;
        setDiag({ ...EMPTY_DIAG, startedAt: Date.now() });
        setPhase("listening");
      } catch (e) {
        clientRef.current?.abort();
        clientRef.current = null;
        await stopCaptureIfActive();
        fail(errorCode(e));
      }
    },
    [applyCorrection, applyWordEvent, audio, ensureMic, fail, stopCaptureIfActive, stopSessionSafely],
  );

  const stopLive = useCallback(async (): Promise<void> => {
    if (phaseRef.current !== "listening") return;
    const client = clientRef.current;
    clientRef.current = null;
    await stopCaptureIfActive();
    if (client) {
      await client.end().catch(() => undefined);
    }
    // Refresh the stored scores so the screen shows the server truth,
    // not only the live stream.
    const att = attemptRef.current;
    if (att) {
      try {
        const detail = await getAttemptDetail(att.id);
        setWords((prev) => {
          const next = { ...prev };
          for (const w of detail.words) {
            const key = wordKey(w.surah, w.ayah, w.word_index);
            next[key] = {
              surah: w.surah,
              ayah: w.ayah,
              wordIndex: w.word_index,
              expected: w.expected_text,
              status: w.status,
              prob: w.prob,
              heard: w.heard,
              isLatest: false,
              peeked: prev[key]?.peeked ?? false,
            };
          }
          return next;
        });
      } catch {
        // Live words stay visible; the stored detail just refreshes later.
      }
    }
    setPhase("done");
  }, [stopCaptureIfActive]);

  const startRecording = useCallback(
    async (surah: number, ayah: number): Promise<void> => {
      if (phaseRef.current !== "idle" && phaseRef.current !== "done" && phaseRef.current !== "error") return;
      setMode("grade");
      modeRef.current = "grade";
      setPhase("preparing");
      setError(null);
      surahRef.current = surah;
      ayahRef.current = ayah;
      try {
        if (!(await ensureMic())) return;
        const att = await createAttempt(surah);
        setAttempt(att);
        await audio.startCapture(
          {
            onFrame: () => {
              setDiag((d) => ({ ...d, framesSent: d.framesSent + 1 }));
            },
            onInterruption: () => {
              void stopSessionSafely("interrupted");
            },
          },
          { accumulate: true },
        );
        captureActiveRef.current = true;
        setDiag({ ...EMPTY_DIAG, startedAt: Date.now() });
        setPhase("recording");
      } catch (e) {
        await stopCaptureIfActive();
        fail(errorCode(e));
      }
    },
    [audio, ensureMic, fail, stopCaptureIfActive, stopSessionSafely],
  );

  const stopAndGrade = useCallback(async (): Promise<void> => {
    if (phaseRef.current !== "recording") return;
    if (!captureActiveRef.current) {
      fail("no-recording");
      return;
    }
    const att = attemptRef.current;
    if (!att) {
      fail("no-recording");
      return;
    }
    setPhase("grading");
    try {
      captureActiveRef.current = false;
      const pcm = await audio.stopCapture();
      if (pcm.length === 0) {
        fail("empty-audio");
        return;
      }
      const grade = await gradeAyah(att.id, surahRef.current, ayahRef.current, pcm);
      mergeGrade(grade);
      setPhase("done");
    } catch (e) {
      fail(errorCode(e));
    }
  }, [audio, fail, mergeGrade]);

  const peekNext = useCallback(
    async (surah: number, ayah: number, ayahWords: string[]): Promise<void> => {
      const att = attemptRef.current;
      if (!att) return;
      const firstHidden = ayahWords.findIndex((_, i) => {
        const key = wordKey(surah, ayah, i);
        return words[key] === undefined;
      });
      if (firstHidden < 0) return;
      try {
        const peek = await peekWord(att.id, surah, ayah, firstHidden);
        const key = wordKey(surah, ayah, firstHidden);
        setWords((prev) => ({
          ...prev,
          [key]: {
            surah,
            ayah,
            wordIndex: firstHidden,
            expected: peek.word,
            status: "skipped",
            prob: 0,
            heard: null,
            isLatest: false,
            peeked: true,
          },
        }));
      } catch (e) {
        setError(errorCode(e));
      }
    },
    [words],
  );

  const completeSession = useCallback(async (): Promise<void> => {
    const att = attemptRef.current;
    if (!att) return;
    try {
      const done = await completeAttempt(att.id);
      setAttempt(done);
    } catch (e) {
      setError(errorCode(e));
    }
  }, []);

  const reset = useCallback(() => {
    clientRef.current?.abort();
    clientRef.current = null;
    setPhase("idle");
    setMode("live");
    setAttempt(null);
    setWords({});
    setLocatedAyah(null);
    setPartialWord(null);
    setReadiness(null);
    setNotice(null);
    setError(null);
    setDiag(EMPTY_DIAG);
    setEngine(null);
    latestKeyRef.current = null;
  }, []);

  return {
    phase,
    mode,
    attempt,
    words,
    counts,
    locatedAyah,
    partialWord,
    readiness,
    notice,
    error,
    diag,
    elapsedSec,
    engine,
    startLive,
    stopLive,
    startRecording,
    stopAndGrade,
    peekNext,
    completeSession,
    reset,
  };
}
