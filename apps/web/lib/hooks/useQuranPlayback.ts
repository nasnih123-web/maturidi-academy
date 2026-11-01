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
  /**
   * The playback ayahs, mirrored in a ref so event handlers wired once
   * (timeupdate/ended) always see the CURRENT reading set when the
   * reader swaps surah ↔ range views. The plan useMemo below still
   * recomputes from the `ayahs` prop itself.
   */
  const ayahsRef = useRef(ayahs);
  ayahsRef.current = ayahs;
  /**
   * Shared Web Audio context for the waveform visualizer.
   *
   * SOUND-BUG FIX (user phone report 2026-11-01: wave visible, no
   * sound): once an element is captured by a MediaElementSource its
   * audio routes ONLY through the graph, so a suspended context means
   * total silence while progress still advances. The context is
   * therefore created/resumed SYNCHRONOUSLY inside the play-click
   * handler path (primeAudio, a user gesture), and the visualizer
   * HARD-GATES capture on ctx.state === 'running' — a suspended
   * context must NEVER capture the element, so native playback (and
   * sound) is guaranteed and only the decorative indicator shows.
   */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [ctxState, setCtxState] = useState<'running' | 'suspended' | null>(null);

  /**
   * Create/resume the visualizer context. MUST be called synchronously
   * from a user gesture (play/resume/step click) — a post-state-change
   * effect is too late on mobile Chrome and the context stays
   * suspended. Returns true only when the context is running right
   * now; otherwise the caller must not build the analyser graph.
   */
  const primeAudio = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return false;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'running') {
        setCtxState('running');
        return true;
      }
      void ctx
        .resume()
        .then(() => setCtxState(ctx.state === 'running' ? 'running' : 'suspended'))
        .catch(() => setCtxState('suspended'));
      return false;
    } catch {
      return false;
    }
  }, []);

  /** The shared visualizer context, for the waveform component only. */
  const getAudioContext = useCallback((): AudioContext | null => audioCtxRef.current, []);
  // Rate/volume live on the single element; refs mirror state so a
  // lazily created element still picks up the current values.
  const [rate, setRateState] = useState(() => clampRate(opts.initialRate ?? 1));
  const [volume, setVolumeState] = useState(() => clampVolume(opts.initialVolume ?? 1));
  const rateRef = useRef(rate);
  const volumeRef = useRef(volume);
  /**
   * Total audio duration of the whole surah in seconds, or null when
   * unknown. Per-ayah mode: sum of per-ayah metadata durations, set
   * only when EVERY ayah resolved (a partial sum would mislead).
   * Single-file mode: the file's own duration once its metadata loads.
   */
  const [surahDuration, setSurahDuration] = useState<number | null>(null);

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

  /**
   * The single playback element, for the waveform visualizer only.
   * The visualizer must never change src/volume/rate — it only reads
   * through an AnalyserNode (or falls back when the data is tainted).
   */
  const getAudioElement = useCallback((): HTMLAudioElement | null => audioRef.current, []);

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
        const ayah = ayahsRef.current[i];
        const word =
          ayah?.wordTimings && ayah.wordTimings.length > 0 ? wordIndexAtTime(ayah.wordTimings, t) : -1;
        // Duration used to stay 0 in per-ayah mode (only the surah-file
        // branch copied el.duration), so the progress bar never moved
        // and no time could be shown. The element knows each ayah file.
        setState((s) => ({
          ...s,
          ayahIndex: i,
          wordIndex: word,
          currentTime: t,
          duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : s.duration,
        }));
      } else if (planNow.surahUrl) {
        const idx = ayahIndexAtTime(planNow.durations, t);
        const ayah = idx >= 0 ? ayahsRef.current[idx] : null;
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
    [],
  );

  // Wire element events once.
  useEffect(() => {
    const el = ensureAudio();
    const onTime = () => updatePosition(el);
    const onPlay = () => setState((s) => ({ ...s, status: 'playing', error: null }));
    const onPause = () => setState((s) => (s.status === 'ended' ? s : { ...s, status: 'paused' }));
    const onEnded = () => {
      const planNow = planRef.current;
      if (planNow?.perAyah && indexRef.current < ayahsRef.current.length - 1) {
        // Advance to the next ayah automatically.
        playIndex(indexRef.current + 1);
      } else {
        setState((s) => ({ ...s, status: 'ended' }));
      }
    };
    const onError = () =>
      setState((s) => ({ ...s, status: 'error', error: 'audio_failed' }));
    const onMeta = () => {
      // Speed persistence: re-apply the selected rate whenever new
      // media metadata loads — a fresh src must never silently
      // restart at 1x. Duration here is what makes the time display
      // and the progress bar work from the first seconds.
      el.playbackRate = rateRef.current;
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setState((s) => ({ ...s, duration: el.duration }));
        if (!planRef.current?.perAyah) setSurahDuration(el.duration);
      }
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    el.addEventListener('loadedmetadata', onMeta);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.removeEventListener('loadedmetadata', onMeta);
      el.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureAudio]);

  // Surah-total duration scan (per-ayah mode only): metadata-only
  // probes, 4 concurrent, never autoplay. Stops on unmount/plan
  // change. A partial sum is never shown — unknown stays null.
  useEffect(() => {
    if (!plan.perAyah) return;
    const urls = plan.urls;
    if (urls.length === 0 || urls.some((u) => typeof u !== 'string' || u.length === 0)) {
      setSurahDuration(null);
      return;
    }
    let cancelled = false;
    const probes: HTMLAudioElement[] = [];
    const durations: (number | null)[] = new Array(urls.length).fill(null);
    let next = 0;
    const worker = async () => {
      for (;;) {
        if (cancelled) return;
        const i = next;
        next += 1;
        if (i >= urls.length) return;
        const el = new Audio();
        el.preload = 'metadata';
        probes.push(el);
        try {
          const d = await new Promise<number>((resolve, reject) => {
            const cleanup = () => {
              el.removeEventListener('loadedmetadata', onMeta);
              el.removeEventListener('error', onErr);
            };
            const onMeta = () => {
              cleanup();
              resolve(el.duration);
            };
            const onErr = () => {
              cleanup();
              reject(new Error('metadata failed'));
            };
            el.addEventListener('loadedmetadata', onMeta);
            el.addEventListener('error', onErr);
            el.src = urls[i] as string;
          });
          durations[i] = d;
        } catch {
          durations[i] = null;
        }
      }
    };
    setSurahDuration(null);
    void Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      if (cancelled) return;
      if (durations.some((d) => d === null || !(d > 0))) {
        setSurahDuration(null);
        return;
      }
      setSurahDuration(durations.reduce<number>((a, b) => a + (b ?? 0), 0));
    });
    return () => {
      cancelled = true;
      for (const el of probes) {
        el.removeAttribute('src');
        el.load();
      }
    };
  }, [plan]);

  const playIndex = useCallback(
    (i: number) => {
      const planNow = planRef.current;
      if (!planNow) return;
      // Gesture-path priming: the context must be resumed synchronously
      // from the click that starts playback (see primeAudio). When it
      // is not running, the visualizer never captures the element, so
      // this play() still produces sound through native playback.
      primeAudio();
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
        // Whole-surah speed: the selected rate is re-applied on every
        // ayah change, so it can never reset to 1x mid-surah.
        el.playbackRate = rateRef.current;
        void el.play().catch(() =>
          setState((s) => ({ ...s, status: 'error', error: 'audio_failed' })),
        );
      } else if (planNow.surahUrl) {
        indexRef.current = i;
        setState((s) => ({ ...s, status: 'loading', ayahIndex: i, wordIndex: -1, error: null }));
        if (el.src !== planNow.surahUrl) el.src = planNow.surahUrl;
        el.playbackRate = rateRef.current;
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
    [ensureAudio, primeAudio],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    primeAudio();
    setState((s) => ({ ...s, status: 'loading', error: null }));
    el.playbackRate = rateRef.current;
    void el.play().catch(() =>
      setState((s) => ({ ...s, status: 'error', error: 'audio_failed' })),
    );
  }, [primeAudio]);

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
    surahDuration,
    getAudioElement,
    primeAudio,
    getAudioContext,
    ctxState,
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
