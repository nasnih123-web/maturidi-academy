/**
 * apps/mobile — src/services/hifzAudio.ts
 *
 * Native microphone capture for Hifz, via the public `useAudioRecorder`
 * hook of @siteed/audio-studio (MIT; the maintained successor of
 * @siteed/expo-audio-stream). One native module serves both Hifz
 * paths, so the audio format is identical on both:
 *
 * - live: PCM16 mono 16 kHz frames streamed to the WebSocket
 *   (hifzLive.ts) — the exact format hifz_router.py demands;
 * - record-then-grade: the same frames are accumulated and wrapped
 *   in a WAV by hifzProtocol.encodeWav16kMono for POST /grade.
 *
 * Why this module and not expo-audio: expo-audio records to a file
 * and exposes no raw PCM frames, so it cannot feed the live socket
 * and cannot guarantee 16 kHz mono WAV on Android (MediaRecorder has
 * no WAV/PCM output). audio-studio streams raw PCM16 at a configured
 * sample rate on both platforms — no resampling step, no unknown
 * native rate (risk R-01 in docs/quran/hifz-risk-register.md).
 *
 * The module's config plugin (app.json) adds RECORD_AUDIO on Android
 * and NSMicrophoneUsageDescription on iOS; this file only asks for
 * the runtime permission. The native module object is typed `any`
 * upstream, so the two permission calls used here are pinned behind
 * the narrow AudioStudioModuleLike interface — one cast, one place.
 *
 * Audio is transient: frames live in memory only for the running
 * session; nothing is written to disk by this file (the grade WAV is
 * built in memory and deleted right after upload, see services/hifz.ts).
 * Background/foreground and interruption policy live in
 * hooks/useHifz.ts; this file only surfaces the interruption events.
 */
import { useCallback, useRef } from "react";
import {
  AudioStudioModule,
  useAudioRecorder,
  type AudioDataEvent,
  type RecordingInterruptionEvent,
} from "@siteed/audio-studio";
import { HIFZ_CHANNELS, HIFZ_SAMPLE_RATE, decodeBase64ToBytes } from "../lib/hifzProtocol";

/** Live frames are emitted every 256 ms (4096 samples = 8192 bytes) —
 * the v2 healthy-client profile (hifz_ws_contract: frame_samples). */
export const HIFZ_FRAME_INTERVAL_MS = 256;

/** Grade recordings longer than this are refused (memory bound). */
const MAX_GRADE_MS = 5 * 60 * 1000;
const MAX_GRADE_BYTES = (HIFZ_SAMPLE_RATE * 2 * MAX_GRADE_MS) / 1000;

export type HifzMicPermission = "granted" | "denied" | "undetermined";

export interface HifzAudioCallbacks {
  /** One raw PCM16 mono 16 kHz frame (copied; safe to keep). */
  onFrame: (pcm: Uint8Array) => void;
  /** Native interruption (call, route loss, focus loss, …). */
  onInterruption: (event: RecordingInterruptionEvent) => void;
}

interface AudioStudioModuleLike {
  requestPermissionsAsync: () => Promise<{ status?: string; granted?: boolean }>;
  getPermissionsAsync: () => Promise<{ status?: string; granted?: boolean }>;
}

const nativeModule = AudioStudioModule as unknown as AudioStudioModuleLike;

function toPermission(res: { status?: string; granted?: boolean }): HifzMicPermission {
  if (res.granted === true || res.status === "granted") return "granted";
  if (res.status === "denied") return "denied";
  return "undetermined";
}

/** Ask the OS for microphone access. Never record without it. */
export async function requestMicPermission(): Promise<HifzMicPermission> {
  return toPermission(await nativeModule.requestPermissionsAsync());
}

export async function getMicPermission(): Promise<HifzMicPermission> {
  try {
    return toPermission(await nativeModule.getPermissionsAsync());
  } catch {
    return "undetermined";
  }
}

function float32ToPcm16(samples: Float32Array | number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Native stream event → raw PCM16 mono 16 kHz (base64 on native). */
function eventToPcm(event: AudioDataEvent): Uint8Array | null {
  if (typeof event.data === "string" && event.data.length > 0) {
    return decodeBase64ToBytes(event.data);
  }
  if (event.data instanceof Float32Array || Array.isArray(event.data)) {
    return float32ToPcm16(event.data);
  }
  if (event.data instanceof Int16Array) {
    return new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
  }
  return null;
}

export function useHifzAudioRecorder(): {
  isRecording: boolean;
  durationMs: number;
  startCapture: (callbacks: HifzAudioCallbacks, opts: { accumulate: boolean }) => Promise<void>;
  stopCapture: () => Promise<Uint8Array>;
} {
  // Destructure the hook's stable callbacks (the state object itself is
  // recreated every render; the callbacks are useCallback-pinned).
  const { isRecording, durationMs, startRecording, stopRecording } = useAudioRecorder();
  const callbacksRef = useRef<HifzAudioCallbacks | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const totalBytesRef = useRef(0);
  const accumulateRef = useRef(false);
  const oversizeRef = useRef(false);

  const startCapture = useCallback(
    async (callbacks: HifzAudioCallbacks, opts: { accumulate: boolean }): Promise<void> => {
      callbacksRef.current = callbacks;
      chunksRef.current = [];
      totalBytesRef.current = 0;
      accumulateRef.current = opts.accumulate;
      oversizeRef.current = false;
      await startRecording({
        sampleRate: HIFZ_SAMPLE_RATE,
        channels: HIFZ_CHANNELS,
        encoding: "pcm_16bit",
        interval: HIFZ_FRAME_INTERVAL_MS,
        keepAwake: true,
        autoResumeAfterInterruption: false,
        ...(opts.accumulate
          ? { maxDurationMs: MAX_GRADE_MS, autoStopOnMaxDuration: true }
          : {}),
        ios: { audioSession: { category: "Record" } },
        onAudioStream: async (event) => {
          const pcm = eventToPcm(event);
          if (!pcm || pcm.length === 0) return;
          if (accumulateRef.current) {
            totalBytesRef.current += pcm.length;
            if (totalBytesRef.current > MAX_GRADE_BYTES) {
              // Stop feeding the accumulator; the session ends with a
              // clear error instead of growing memory unboundedly.
              oversizeRef.current = true;
              return;
            }
            chunksRef.current.push(pcm);
          }
          callbacksRef.current?.onFrame(pcm);
        },
        onRecordingInterrupted: (event) => {
          callbacksRef.current?.onInterruption(event);
        },
      });
    },
    [startRecording],
  );

  const stopCapture = useCallback(async (): Promise<Uint8Array> => {
    try {
      await stopRecording();
    } catch {
      // The recorder may already be stopped (interruption); the
      // frames already received are still valid.
    } finally {
      callbacksRef.current = null;
    }
    if (oversizeRef.current) throw new Error("recording-too-long");
    const out = new Uint8Array(totalBytesRef.current);
    let offset = 0;
    for (const c of chunksRef.current) {
      out.set(c, offset);
      offset += c.length;
    }
    chunksRef.current = [];
    totalBytesRef.current = 0;
    return out;
  }, [stopRecording]);

  return {
    isRecording,
    durationMs,
    startCapture,
    stopCapture,
  };
}
