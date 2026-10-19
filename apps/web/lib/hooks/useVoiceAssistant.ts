'use client';

/**
 * useVoiceAssistant — Phase 12 bilingual (fa/ar) voice assistant state machine.
 *
 * Owns the full push-to-talk lifecycle:
 *   idle → recording (timer) → transcribing → answering → playing → idle
 * plus cancellation and error branches. All network I/O goes through
 * lib/voice.ts; all user-visible strings are returned as error *codes* —
 * the component maps them to labels (ADR-001: no strings in logic).
 *
 * Mic interaction model (press-and-hold AND click-to-toggle):
 *  - pointerdown starts capture immediately (hold mode);
 *  - pointerup after ≥300ms stops and sends;
 *  - a quick tap (<300ms) converts to toggle mode: the next tap/click stops;
 *  - keyboard (Space/Enter) fires click → toggles start/stop.
 * The component only forwards DOM events; the disambiguation lives here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  askVoice,
  isVoiceCaptureSupported,
  pickAudioMimeType,
  type VoiceAskResponse,
  type VoiceAudioKind,
  type VoiceCitation,
} from '../voice';

export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'answering' | 'playing';

/** Machine-readable failure reasons — the component maps these to labels. */
export type VoiceErrorCode =
  | 'mic_unsupported'
  | 'mic_denied'
  | 'mic_error'
  | 'upload_failed'
  | 'api_error'
  | null;

export interface VoiceTurn {
  id: string;
  role: 'user' | 'assistant';
  /** User turn: transcribed query (empty while pending). Assistant: answer text. */
  text: string;
  audioUrl: string | null;
  audioKind: VoiceAudioKind;
  intent: string;
  lang: 'fa' | 'ar';
  /** Honest degradation code from the backend (e.g. "tts_unavailable"). */
  notice: string | null;
  citations: VoiceCitation[];
  createdAt: string;
  pending: boolean;
}

const HOLD_TOGGLE_MS = 300;

let turnSeq = 0;
function nextTurnId(): string {
  turnSeq += 1;
  return `v${Date.now()}_${turnSeq}`;
}

export interface UseVoiceAssistant {
  phase: VoicePhase;
  turns: VoiceTurn[];
  error: VoiceErrorCode;
  elapsedSec: number;
  micSupported: boolean;
  playingTurnId: string | null;
  isPlaying: boolean;
  playbackProgress: number;
  /** Pointer pressed on the mic button. */
  onMicPress: () => void;
  /** Pointer released from the mic button. */
  onMicRelease: () => void;
  /** Click on the mic button (tap-toggle + keyboard). */
  onMicClick: () => void;
  /** Discard the current recording without sending. */
  cancelRecording: () => void;
  /** Abort an in-flight upload/request. */
  cancelRequest: () => void;
  toggleTurnAudio: (turn: VoiceTurn) => void;
  stopPlayback: () => void;
  clearConversation: () => void;
  dismissError: () => void;
}

export function useVoiceAssistant(locale: 'fa' | 'ar'): UseVoiceAssistant {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<VoiceErrorCode>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [micSupported, setMicSupported] = useState(false);
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const recStartRef = useRef(0);
  const holdModeRef = useRef<'hold' | 'toggle' | null>(null);
  const pressStartRef = useRef(0);
  const suppressClickRef = useRef(false);
  const phaseRef = useRef<VoicePhase>('idle');
  const localeRef = useRef(locale);

  phaseRef.current = phase;
  localeRef.current = locale;

  useEffect(() => {
    setMicSupported(isVoiceCaptureSupported());
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseMicStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  /** Lazily create the single shared audio element (browser only). */
  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('timeupdate', () => {
        const d = el.duration;
        setPlaybackProgress(d > 0 && Number.isFinite(d) ? el.currentTime / d : 0);
      });
      el.addEventListener('play', () => setIsPlaying(true));
      el.addEventListener('pause', () => setIsPlaying(false));
      el.addEventListener('ended', () => {
        setIsPlaying(false);
        setPlayingTurnId(null);
        setPlaybackProgress(0);
        if (phaseRef.current === 'playing') setPhase('idle');
      });
      el.addEventListener('error', () => {
        setIsPlaying(false);
        setPlayingTurnId(null);
        if (phaseRef.current === 'playing') setPhase('idle');
      });
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    setIsPlaying(false);
    setPlayingTurnId(null);
    setPlaybackProgress(0);
    if (phaseRef.current === 'playing') setPhase('idle');
  }, []);

  const playTurn = useCallback(
    (turn: VoiceTurn) => {
      if (!turn.audioUrl) return;
      const el = ensureAudio();
      if (!el) return;
      setPhase('answering');
      setPlayingTurnId(turn.id);
      setPlaybackProgress(0);
      el.src = turn.audioUrl;
      el.play()
        .then(() => setPhase('playing'))
        .catch(() => {
          // Autoplay blocked or decode error — stay readable; the user can
          // replay manually from the turn's play button.
          setPhase('idle');
          setPlayingTurnId(null);
        });
    },
    [ensureAudio],
  );

  const toggleTurnAudio = useCallback(
    (turn: VoiceTurn) => {
      if (!turn.audioUrl) return;
      const el = audioRef.current;
      if (playingTurnId === turn.id && el && !el.paused) {
        el.pause();
        return;
      }
      if (playingTurnId === turn.id && el && el.paused) {
        void el.play().catch(() => undefined);
        return;
      }
      stopPlayback();
      playTurn(turn);
    },
    [playingTurnId, playTurn, stopPlayback],
  );

  /** Stop the recorder and either send the audio or discard it. */
  const finishRecording = useCallback(
    (send: boolean) => {
      const recorder = recorderRef.current;
      holdModeRef.current = null;
      stopTimer();
      setElapsedSec(0);
      if (!recorder || recorder.state === 'inactive') {
        releaseMicStream();
        setPhase('idle');
        return;
      }
      chunksRef.current = [];
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        const hadAudio = blob.size > 0;
        releaseMicStream();
        if (!send || !hadAudio) {
          setPhase('idle');
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        const userTurn: VoiceTurn = {
          id: nextTurnId(),
          role: 'user',
          text: '',
          audioUrl: null,
          audioKind: 'none',
          intent: '',
          lang: localeRef.current,
          notice: null,
          citations: [],
          createdAt: new Date().toISOString(),
          pending: true,
        };
        setTurns((prev) => [...prev, userTurn]);
        setPhase('transcribing');
        askVoice(blob, { locale: localeRef.current, signal: controller.signal })
          .then((res: VoiceAskResponse) => {
            abortRef.current = null;
            setPhase('answering');
            const assistantTurn: VoiceTurn = {
              id: nextTurnId(),
              role: 'assistant',
              text: res.text,
              audioUrl: res.audioUrl,
              audioKind: res.audioKind,
              intent: res.intent,
              lang: res.lang,
              notice: res.notice,
              citations: res.citations,
              createdAt: new Date().toISOString(),
              pending: false,
            };
            setTurns((prev) => [
              ...prev.map((t) =>
                t.id === userTurn.id ? { ...t, text: res.query, pending: false } : t,
              ),
              assistantTurn,
            ]);
            if (res.audioUrl) {
              playTurn(assistantTurn);
            } else {
              setPhase('idle');
            }
          })
          .catch((err: unknown) => {
            abortRef.current = null;
            if (err instanceof DOMException && err.name === 'AbortError') {
              // User-cancelled — drop the pending user turn silently.
              setTurns((prev) => prev.filter((t) => t.id !== userTurn.id));
              setPhase('idle');
              return;
            }
            setTurns((prev) => prev.filter((t) => t.id !== userTurn.id));
            setError(err instanceof Error && err.name === 'VoiceApiError' && (err as { status?: number }).status === 0
              ? 'upload_failed'
              : 'api_error');
            setPhase('idle');
          });
      };
      recorder.onerror = () => {
        releaseMicStream();
        stopTimer();
        setElapsedSec(0);
        setError('mic_error');
        setPhase('idle');
      };
      try {
        recorder.stop();
      } catch {
        releaseMicStream();
        setPhase('idle');
      }
    },
    [playTurn, releaseMicStream, stopTimer],
  );

  const beginCapture = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    if (!isVoiceCaptureSupported()) {
      setError('mic_unsupported');
      return;
    }
    stopPlayback();
    setError(null);
    const start = (stream: MediaStream) => {
      try {
        const mime = pickAudioMimeType();
        const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        recorderRef.current = recorder;
        streamRef.current = stream;
        chunksRef.current = [];
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(250);
        recStartRef.current = Date.now();
        setElapsedSec(0);
        timerRef.current = window.setInterval(() => {
          setElapsedSec(Math.floor((Date.now() - recStartRef.current) / 1000));
        }, 250);
        setPhase('recording');
      } catch {
        releaseMicStream();
        setError('mic_error');
      }
    };
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(start)
      .catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : '';
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_error');
      });
  }, [releaseMicStream, stopPlayback, stopTimer]);

  const onMicPress = useCallback(() => {
    if (phaseRef.current === 'recording') return; // toggle mode: release/click handles it
    if (phaseRef.current !== 'idle') return;
    holdModeRef.current = 'hold';
    pressStartRef.current = Date.now();
    suppressClickRef.current = false;
    beginCapture();
  }, [beginCapture]);

  const onMicRelease = useCallback(() => {
    if (phaseRef.current !== 'recording') return;
    if (holdModeRef.current !== 'hold') return;
    suppressClickRef.current = true;
    if (Date.now() - pressStartRef.current < HOLD_TOGGLE_MS) {
      // Quick tap → stay recording in toggle mode; the suppressed click is
      // swallowed and the *next* tap stops.
      holdModeRef.current = 'toggle';
      return;
    }
    finishRecording(true);
  }, [finishRecording]);

  const onMicClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (phaseRef.current === 'recording' && holdModeRef.current === 'toggle') {
      finishRecording(true);
      return;
    }
    if (phaseRef.current === 'idle') {
      holdModeRef.current = 'toggle';
      pressStartRef.current = Date.now();
      beginCapture();
    }
  }, [beginCapture, finishRecording]);

  const cancelRecording = useCallback(() => {
    if (phaseRef.current !== 'recording') return;
    finishRecording(false);
  }, [finishRecording]);

  const cancelRequest = useCallback(() => {
    const controller = abortRef.current;
    if (controller) controller.abort();
  }, []);

  const clearConversation = useCallback(() => {
    stopPlayback();
    cancelRequest();
    setTurns([]);
    setError(null);
    setPhase('idle');
  }, [cancelRequest, stopPlayback]);

  const dismissError = useCallback(() => setError(null), []);

  // Teardown on unmount: stop mic tracks, abort request, stop audio.
  useEffect(() => {
    return () => {
      stopTimer();
      const stream = streamRef.current;
      if (stream) for (const track of stream.getTracks()) track.stop();
      abortRef.current?.abort();
      audioRef.current?.pause();
    };
  }, [stopTimer]);

  return {
    phase,
    turns,
    error,
    elapsedSec,
    micSupported,
    playingTurnId,
    isPlaying,
    playbackProgress,
    onMicPress,
    onMicRelease,
    onMicClick,
    cancelRecording,
    cancelRequest,
    toggleTurnAudio,
    stopPlayback,
    clearConversation,
    dismissError,
  };
}
