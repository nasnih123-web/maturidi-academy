'use client';

/**
 * useQuranPlayback — audio playback state machine for the Quran reader.
 *
 * Drives ONE HTMLAudioElement and maps playback time to the current ayah:
 * - Word-level highlight when the provider supplies `wordTimings` for the
 *   current ayah (start/end in seconds within the ayah audio).
 * - Ayah-level fallback via cumulative `audioDuration`s (see
 *   `ayahIndexAtTime` in lib/quran.ts).
 * - When only a single full-surah file exists, the element plays it and the
 *   hook still reports per-ayah position from durations; when even durations
 *   are missing, the hook degrades to "playing" with no highlight movement
 *   (the current ayah stays on the one the user pressed play on).
 *
 * The hook never fabricates timings — every position comes from the
 * provider data or the element's own `currentTime`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ayahIndexAtTime, wordIndexAtTime, type Ayah } from '../quran';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  /** 0-based index of the highlighted ayah, -1 when none. */
  ayahIndex: number;
  /** 1-based word index for word-level highlight, -1 when n/a. */
  wordIndex: number;
  currentTime: number;
  duration: number;
  error: string | null;
}

const INITIAL: PlaybackState = {
  status: 'idle',
  ayahIndex: -1,
  wordIndex: -1,
  currentTime: 0,
  duration: 0,
  error: null,
};

interface AyahAudioPlan {
  /** Flattened playlist: one entry per ayah with a playable URL. */
  urls: (string | null)[];
  /** Durations in seconds (null = unknown). */
  durations: (number | null)[];
  /** True when every ayah has its own audio file. */
  perAyah: boolean;
  /** Single full-surah file fallback. */
  surahUrl: string | null;
}

export function useQuranPlayback(
  ayahs: Ayah[],
  opts: {
    surahAudioUrl?: string | null;
    autoplay?: boolean;
    /** Player default speed (CRM quran.player_default_speed), 0.5–2. */
    initialRate?: number;
    initialVolume?: number;
  } = {},
) {
  const [state, setState] = useState<PlaybackState>(INITIAL);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const planRef = useRef<AyahAudioPlan | null>(null);
  const indexRef = useRef(0);
  // Rate/volume live on the single element; refs mirror state so a
  // lazily created element still picks up the current values.
  const [rate, setRateState] = useState(() => clampRate(opts.initialRate ?? 1));
  const [volume, setVolumeState] = useState(() => clampVolume(opts.initialVolume ?? 1));
  const rateRef = useRef(rate);
  const volumeRef = useRef(volume);

  const plan: AyahAudioPlan = useMemo(() => {
    const urls = ayahs.map((a) => a.audioUrl);
    const durations = ayahs.map((a) => a.audioDuration);
    const perAyah = urls.length > 0 && urls.every((u) => typeof u === 'string' && u.length > 0);
    return { urls, durations, perAyah, surahUrl: opts.surahAudioUrl ?? null };
  }, [ayahs, opts.surahAudioUrl]);

  planRef.current = plan;

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'none'; // performance budget: audio is lazy, never autoplay
      el.playbackRate = rateRef.current;
      el.volume = volumeRef.current;
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const setRate = useCallback((r: number) => {
    const next = clampRate(r);
    rateRef.current = next;
    setRateState(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  const setVolume = useCallback((v: number) => {
    const next = clampVolume(v);
    volumeRef.current = next;
    setVolumeState(next);
    if (audioRef.current) audioRef.current.volume = next;
  }, []);

  const updatePosition = useCallback(
    (el: HTMLAudioElement) => {
      const planNow = planRef.current;
      if (!planNow) return;
      const t = el.currentTime;
      if (planNow.perAyah) {
        const i = indexRef.current;
        const ayah = ayahs[i];
        const word =
          ayah?.wordTimings && ayah.wordTimings.length > 0 ? wordIndexAtTime(ayah.wordTimings, t) : -1;
        setState((s) => ({ ...s, ayahIndex: i, wordIndex: word, currentTime: t }));
      } else if (planNow.surahUrl) {
        const idx = ayahIndexAtTime(planNow.durations, t);
        const ayah = idx >= 0 ? ayahs[idx] : null;
        const perAyahT = idx >= 0 ? t - prefixSum(planNow.durations, idx) : 0;
        const word =
          ayah?.wordTimings && ayah.wordTimings.length > 0 ? wordIndexAtTime(ayah.wordTimings, perAyahT) : -1;
        setState((s) => ({
          ...s,
          ayahIndex: idx,
          wordIndex: word,
          currentTime: t,
          duration: el.duration || s.duration,
        }));
      } else {
        setState((s) => ({ ...s, currentTime: t }));
      }
    },
    [ayahs],
  );

  // Wire element events once.
  useEffect(() => {
    const el = ensureAudio();
    const onTime = () => updatePosition(el);
    const onPlay = () => setState((s) => ({ ...s, status: 'playing', error: null }));
    const onPause = () => setState((s) => (s.status === 'ended' ? s : { ...s, status: 'paused' }));
    const onEnded = () => {
      const planNow = planRef.current;
      if (planNow?.perAyah && indexRef.current < ayahs.length - 1) {
        // Advance to the next ayah automatically.
        playIndex(indexRef.current + 1);
      } else {
        setState((s) => ({ ...s, status: 'ended' }));
      }
    };
    const onError = () =>
      setState((s) => ({ ...s, status: 'error', error: 'audio_failed' }));
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureAudio]);

  const playIndex = useCallback(
    (i: number) => {
      const planNow = planRef.current;
      if (!planNow) return;
      const el = ensureAudio();
      if (planNow.perAyah) {
        const url = planNow.urls[i];
        if (!url) {
          setState((s) => ({ ...s, status: 'error', error: 'audio_missing' }));
          return;
        }
        indexRef.current = i;
        setState((s) => ({ ...s, status: 'loading', ayahIndex: i, wordIndex: -1, error: null }));
        el.src = url;
        void el.play().catch(() =>
          setState((s) => ({ ...s, status: 'error', error: 'audio_failed' })),
        );
      } else if (planNow.surahUrl) {
        indexRef.current = i;
        setState((s) => ({ ...s, status: 'loading', ayahIndex: i, wordIndex: -1, error: null }));
        if (el.src !== planNow.surahUrl) el.src = planNow.surahUrl;
        // Seek to the ayah start when durations are known.
        const start = prefixSum(planNow.durations, i);
        try {
          el.currentTime = start;
        } catch {
          /* seeking before metadata is fine to skip */
        }
        void el.play().catch(() =>
          setState((s) => ({ ...s, status: 'error', error: 'audio_failed' })),
        );
      } else {
        setState((s) => ({ ...s, status: 'error', error: 'audio_missing' }));
      }
    },
    [ensureAudio],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    void el.play().catch(() =>
      setState((s) => ({ ...s, status: 'error', error: 'audio_failed' })),
    );
  }, []);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    setState(INITIAL);
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.currentTime = Math.max(0, seconds);
    } catch {
      /* ignore */
    }
  }, []);

  // Optional autoplay (off by default; browsers block it anyway).
  useEffect(() => {
    if (opts.autoplay && ayahs.length > 0) playIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    canPlay: plan.perAyah || plan.surahUrl !== null,
    playIndex,
    pause,
    resume,
    stop,
    seek,
    rate,
    volume,
    setRate,
    setVolume,
  };
}

function clampRate(r: number): number {
  if (!Number.isFinite(r)) return 1;
  return Math.min(2, Math.max(0.5, r));
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

function prefixSum(durations: (number | null)[], upto: number): number {
  let sum = 0;
  for (let i = 0; i < upto; i++) {
    const d = durations[i];
    if (d === null || d <= 0) return sum; // unknown — best effort from here
    sum += d;
  }
  return sum;
}
