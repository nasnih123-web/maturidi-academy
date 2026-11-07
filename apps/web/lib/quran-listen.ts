/**
 * quran-listen: the listen/follow mode hook for the hifz study page.
 *
 * When the reciter's audio plays, the current word is highlighted on
 * the mushaf page in sync with the audio (like the QUL Segment
 * builder: only the current word is highlighted, green background
 * #188653 + white text; before the first word and after the last,
 * no word is highlighted). The page follows the current ayah and
 * turns automatically.
 *
 * Two playback strategies (the caller is told which one is in use):
 * - SEGMENTS (real): the backend timing endpoint returns the
 *   per-surah audio URL + per-ayah ranges + per-word segments
 *   (Quran.com v4). One audio file; the hook seeks to the ayah's
 *   range and highlights by the real segments.
 * - INTERPOLATED (fallback): the timing endpoint is unavailable.
 *   The per-ayah audio (site's active reciter, from getSurah) is
 *   played ayah by ayah and the ayah duration is spread across its
 *   words by length. The UI labels this as estimated.
 *
 * Phase 5 (hifz redesign): the Tarteel speed set (0.5×–1.75×, spec
 * §11.2 — 2× is not offered), counted ayah/range repeats wired to
 * the Phase 4 range/repeat inputs, playback-position persistence
 * (localStorage, per reciter+surah — see lib/hifz-player.ts for why
 * there is no server endpoint for it), real loading/buffering/error
 * states with retry, and next-ayah preloading in interpolated mode.
 * The hook owns the playback state and the rAF tracking loop; the
 * component owns the <audio> element (passed by ref) and renders the
 * highlight from the onAyahChange/onWordChange callbacks.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  clearListenPosition,
  listenRepeatNext,
  listenRepeatRemaining,
  loadListenPosition,
  nextListenSpeed,
  normalizeListenSpeed,
  saveListenPosition,
  saveListenSpeed,
  type ListenErrorKind,
  type ListenPosition,
  type ListenRepeatMode,
  type ListenRepeatRange,
  type ListenStatus,
} from '@/lib/hifz-player';
import {
  fetchRecitationTiming,
  interpolateWordTimings,
  wordIndexAtTimeMs,
  type RecitationTiming,
  type RecitationWordTiming,
  type TimingSource,
} from '@/lib/quran-recitation-timing';

export interface ListenConfig {
  reciter: string;
  surah: number;
  /** Ayah -> text (word counts for interpolation). */
  ayahTexts: Record<number, string>;
  /** Ayah -> per-ayah audio URL (site's active reciter; fallback). */
  ayahAudioUrls: Record<number, string | null>;
  ayahCount: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  onAyahChange: (ayah: number) => void;
  onWordChange: (ayah: number, word: number | null) => void;
  /** Phase 5: total plays of each ayah (Phase 4 repeatAyah input, 1–20). */
  repeatAyahCount?: number;
  /** Phase 5: range repeat (Phase 4 range + repeatRange inputs); null = no range. */
  repeatRange?: ListenRepeatRange | null;
  /** Phase 5: persisted speed to start from (localStorage). */
  initialSpeed?: number;
}

/** Re-exported so callers keep one import site for the mode type. */
export type { ListenRepeatMode } from '@/lib/hifz-player';

export interface ListenControls {
  isPlaying: boolean;
  currentAyah: number;
  currentWord: number | null;
  /** Which timing source is in use (null = not loaded yet). */
  timingSource: TimingSource | null;
  listenError: string | null;
  /** Phase 5: honest error kind (audio / timing / offline). */
  listenErrorKind: ListenErrorKind | null;
  /** Phase 5: loading / buffering / playing / paused / error / idle. */
  listenStatus: ListenStatus;
  isBuffering: boolean;
  play: () => void;
  pause: () => void;
  /** Resume after pause (same as play once audio is loaded). */
  resume: () => void;
  stop: () => void;
  /** Phase 5: clear the error and try the current ayah again. */
  retry: () => void;
  playAyah: (ayah: number) => void;
  prevAyah: () => void;
  nextAyah: () => void;
  repeatMode: ListenRepeatMode;
  setRepeatMode: (mode: ListenRepeatMode) => void;
  /** Phase 5: plays left of the current ayah (ayah mode) or passes
      left of the range (range mode); null when unbounded / off. */
  repeatRemaining: number | null;
  speed: number;
  setSpeed: (rate: number) => void;
  /** Phase 5: cycle to the next Tarteel speed (mini-player badge). */
  cycleSpeed: () => void;
  /** Phase 5: cycle the repeat mode (mini-player badge). */
  cycleRepeatMode: () => void;
  /** Playback position / total length in ms (surah total in segments
      mode, current ayah in interpolated mode). */
  progressMs: number;
  durationMs: number;
  seek: (ms: number) => void;
  /** Phase 5: the persisted position for this reciter+surah (null =
      never listened here, or finished the surah). */
  savedPosition: ListenPosition | null;
  hasSavedPosition: boolean;
  /** Phase 5: play from the saved position (explicit resume). */
  resumeSaved: () => void;
  /** Phase 5: true while the next ayah's audio is preloading
      (interpolated mode only; segments mode is one file). */
  preloadingNext: boolean;
}

function splitWords(text: string): string[] {
  return (text ?? '').split(/\s+/).filter(Boolean);
}

export function useQuranListen(config: ListenConfig): ListenControls {
  const { reciter, surah, ayahTexts, ayahAudioUrls, ayahCount, audioRef } = config;
  const onAyahChange = useRef(config.onAyahChange);
  const onWordChange = useRef(config.onWordChange);
  onAyahChange.current = config.onAyahChange;
  onWordChange.current = config.onWordChange;
  // Phase 7: latest reciter/surah for the stale-fetch guard in
  // play() — a timing fetch that resolves after a reciter/surah
  // change must not install the old reciter's audio + timings.
  const reciterRef = useRef(reciter);
  const surahRef = useRef(surah);
  reciterRef.current = reciter;
  surahRef.current = surah;
  // Phase 5 repeat inputs are read through refs (like the callbacks
  // above) so the rAF loop never chases a stale config object.
  const repeatAyahCountRef = useRef(config.repeatAyahCount ?? 1);
  repeatAyahCountRef.current = config.repeatAyahCount ?? 1;
  const repeatRangeRef = useRef<ListenRepeatRange | null>(config.repeatRange ?? null);
  repeatRangeRef.current = config.repeatRange ?? null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAyah, setCurrentAyah] = useState(1);
  const [currentWord, setCurrentWord] = useState<number | null>(null);
  const [timingSource, setTimingSource] = useState<TimingSource | null>(null);
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenErrorKind, setListenErrorKind] = useState<ListenErrorKind | null>(null);
  const [listenStatus, setListenStatus] = useState<ListenStatus>('idle');
  const [repeatMode, setRepeatMode] = useState<ListenRepeatMode>('off');
  const [repeatRemaining, setRepeatRemaining] = useState<number | null>(null);
  const [speed, setSpeedState] = useState(() => normalizeListenSpeed(config.initialSpeed ?? 1));
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [preloadingNext, setPreloadingNext] = useState(false);
  const [savedPosition, setSavedPosition] = useState<ListenPosition | null>(() =>
    typeof window === 'undefined'
      ? null
      : loadListenPosition(window.localStorage, reciter, surah, ayahCount),
  );
  const repeatModeRef = useRef<ListenRepeatMode>('off');
  const speedRef = useRef(normalizeListenSpeed(config.initialSpeed ?? 1));
  const statusRef = useRef<ListenStatus>('idle');
  // Latest playAyah for the ended handler (avoids a stale closure).
  const playAyahRef = useRef<(ayah: number) => void>(() => {});
  // Last reported progress (throttle: state updates at most ~4x/s).
  const lastProgressRef = useRef(-1);
  // Last persisted position (throttle: save at most every 5s + on pause/stop).
  const lastSavedRef = useRef(-1);
  // Repeat counters for the current pass (1-based).
  const ayahPlaysRef = useRef(1);
  const rangePlaysRef = useRef(1);
  // The ayah whose end-of-ayah advance already ran (so the rAF tick
  // and the 'ended' event cannot advance twice for one ayah).
  const boundaryHandledRef = useRef(0);
  // Seek to apply once the audio metadata loads (resume-from-saved).
  const pendingSeekRef = useRef<number | null>(null);
  // Resume target for the first-play path (timings not loaded yet):
  // play() applies it when the surah file's metadata lands.
  const resumeTargetRef = useRef<ListenPosition | null>(null);
  // Preload element for the next ayah (interpolated mode only).
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);

  const setStatus = useCallback((s: ListenStatus) => {
    statusRef.current = s;
    setListenStatus(s);
  }, []);

  const persistPosition = useCallback(
    (ayah: number, tMs: number) => {
      if (typeof window === 'undefined') return;
      const pos: ListenPosition = {
        surah,
        reciter,
        ayah,
        progressMs: Math.max(0, Math.round(tMs)),
        savedAt: Date.now(),
      };
      saveListenPosition(window.localStorage, pos);
      setSavedPosition(pos);
    },
    [reciter, surah],
  );

  const refreshRemaining = useCallback(() => {
    setRepeatRemaining(
      listenRepeatRemaining({
        currentAyah: currentAyahRef.current,
        ayahCount,
        mode: repeatModeRef.current,
        ayahRepeatCount: repeatAyahCountRef.current,
        range: repeatRangeRef.current,
        ayahPlays: ayahPlaysRef.current,
        rangePlays: rangePlaysRef.current,
      }),
    );
  }, [ayahCount]);

  // The fetched real timings (segments mode) or null.
  const timingRef = useRef<RecitationTiming | null>(null);
  // Interpolated word timings per ayah (fallback mode), computed when
  // that ayah's audio loads (duration known only then).
  const interpRef = useRef<Map<number, RecitationWordTiming[]>>(new Map());
  const modeRef = useRef<TimingSource | null>(null);
  const currentAyahRef = useRef(1);
  const currentWordRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  // True while the hook is loading a new audio source; the rAF loop
  // must not chase a stale currentTime during the seek.
  const loadingRef = useRef(false);

  const setAyahAndWord = useCallback((ayah: number, word: number | null) => {
    if (ayah !== currentAyahRef.current) {
      currentAyahRef.current = ayah;
      setCurrentAyah(ayah);
      // A new ayah means a new end-of-ayah boundary to handle.
      boundaryHandledRef.current = 0;
      onAyahChange.current(ayah);
    }
    if (word !== currentWordRef.current) {
      currentWordRef.current = word;
      setCurrentWord(word);
      onWordChange.current(ayah, word);
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  /** Apply the stored playback speed to the audio element. */
  const applySpeed = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speedRef.current;
  }, [audioRef]);

  const setSpeed = useCallback(
    (rate: number) => {
      const clamped = normalizeListenSpeed(rate);
      speedRef.current = clamped;
      setSpeedState(clamped);
      if (typeof window !== 'undefined') saveListenSpeed(window.localStorage, clamped);
      applySpeed();
    },
    [applySpeed],
  );

  /** Cycle to the next Tarteel speed (mini-player badge). */
  const cycleSpeed = useCallback(() => {
    setSpeed(nextListenSpeed(speedRef.current));
  }, [setSpeed]);

  const setRepeat = useCallback(
    (mode: ListenRepeatMode) => {
      repeatModeRef.current = mode;
      setRepeatMode(mode);
      ayahPlaysRef.current = 1;
      rangePlaysRef.current = 1;
      refreshRemaining();
    },
    [refreshRemaining],
  );

  /** Cycle the repeat mode (mini-player badge). */
  const cycleRepeatMode = useCallback(() => {
    const order: ListenRepeatMode[] = ['off', 'ayah', 'range', 'surah'];
    setRepeat(order[(order.indexOf(repeatModeRef.current) + 1) % order.length]);
  }, [setRepeat]);

  /**
   * Phase 5: what happens when an ayah finishes playing — one place
   * for both modes (the rAF tick calls it at the ayah boundary in
   * segments mode; the 'ended' event calls it in interpolated mode).
   * The pure decision lives in lib/hifz-player.ts; this only applies
   * the outcome. Returns false when playback stops (surah/range
   * finished) — and then the saved position is cleared, so a later
   * visit starts at ayah 1 instead of offering a stale resume.
   */
  const advanceAfterAyah = useCallback(
    (finishedAyah: number): boolean => {
      const outcome = listenRepeatNext({
        currentAyah: finishedAyah,
        ayahCount,
        mode: repeatModeRef.current,
        ayahRepeatCount: repeatAyahCountRef.current,
        range: repeatRangeRef.current,
        ayahPlays: ayahPlaysRef.current,
        rangePlays: rangePlaysRef.current,
      });
      ayahPlaysRef.current = outcome.ayahPlays;
      rangePlaysRef.current = outcome.rangePlays;
      refreshRemaining();
      if (outcome.action === 'stop') {
        setIsPlaying(false);
        setStatus('idle');
        setAyahAndWord(finishedAyah, null);
        if (typeof window !== 'undefined') {
          clearListenPosition(window.localStorage);
          setSavedPosition(null);
        }
        return false;
      }
      playAyahRef.current(outcome.ayah);
      return true;
    },
    [ayahCount, refreshRemaining, setAyahAndWord, setStatus],
  );

  /** Seek within the surah (segments mode) or the ayah (interpolated). */
  const seek = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (modeRef.current === 'segments' && timingRef.current) {
        const total = timingRef.current.ayahs[timingRef.current.ayahs.length - 1]?.toMs ?? 0;
        audio.currentTime = Math.min(Math.max(ms, 0), total) / 1000;
      } else {
        audio.currentTime = Math.max(ms, 0) / 1000;
      }
      lastProgressRef.current = -1;
    },
    [audioRef],
  );

  // The tracking loop: poll the audio clock (~60fps) and map it to
  // the current ayah + word. timeupdate fires only ~4x/s, too coarse
  // for sub-second words.
  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && !loadingRef.current) {
        const tMs = audio.currentTime * 1000;
        if (modeRef.current === 'segments' && timingRef.current) {
          const timing = timingRef.current;
          const entry = timing.ayahs.find((a) => tMs >= a.fromMs && tMs < a.toMs);
          if (entry) {
            if (entry.ayah > currentAyahRef.current) {
              // The clock already moved past the current ayah's end:
              // the 120ms boundary window below was missed (main-thread
              // jank — a screenshot, a slow frame, a weak phone).
              // Recover the counted advance for the finished ayah
              // instead of silently skipping it — but only for a small
              // overshoot (one ayah, <3s past its end). A larger jump
              // is a deliberate seek, which just re-syncs (fresh
              // counters for the new ayah's first play).
              const finished = timing.ayahs.find((a) => a.ayah === currentAyahRef.current);
              const overshoot = finished ? tMs - finished.toMs : Number.POSITIVE_INFINITY;
              if (
                finished &&
                entry.ayah === currentAyahRef.current + 1 &&
                overshoot >= 0 &&
                overshoot < 3000 &&
                boundaryHandledRef.current !== currentAyahRef.current
              ) {
                boundaryHandledRef.current = currentAyahRef.current;
                advanceAfterAyah(currentAyahRef.current);
              } else {
                ayahPlaysRef.current = 1;
                const word = wordIndexAtTimeMs(entry.words, tMs - entry.fromMs);
                setAyahAndWord(entry.ayah, word);
              }
            } else if (
              // Phase 5: at the ayah boundary, one counted advance
              // (replay / next / range restart / surah restart / stop)
              // — the same decision the 'ended' event makes in
              // interpolated mode. Guarded so one boundary advances once.
              tMs >= entry.toMs - 120 &&
              boundaryHandledRef.current !== entry.ayah
            ) {
              boundaryHandledRef.current = entry.ayah;
              advanceAfterAyah(entry.ayah);
            } else {
              const word = wordIndexAtTimeMs(entry.words, tMs - entry.fromMs);
              setAyahAndWord(entry.ayah, word);
            }
          } else if (tMs >= (timing.ayahs[timing.ayahs.length - 1]?.toMs ?? 0)) {
            // Past the last ayah's end: the ended handler stops us.
            setAyahAndWord(currentAyahRef.current, null);
          }
        } else if (modeRef.current === 'interpolated') {
          const words = interpRef.current.get(currentAyahRef.current) ?? [];
          setAyahAndWord(currentAyahRef.current, wordIndexAtTimeMs(words, tMs));
        }
        // Progress (throttled to ~4 updates/s to avoid re-render storms).
        if (Math.abs(tMs - lastProgressRef.current) >= 250) {
          lastProgressRef.current = tMs;
          setProgressMs(Math.round(tMs));
        }
        // Phase 5: persist the playback position (throttled to one
        // save per 5s; pause/stop save immediately, see below).
        if (Math.abs(tMs - lastSavedRef.current) >= 5000) {
          lastSavedRef.current = tMs;
          persistPosition(currentAyahRef.current, tMs);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return stopRaf;
  }, [isPlaying, audioRef, setAyahAndWord, stopRaf, advanceAfterAyah, persistPosition]);

  // Audio ended: one counted advance (both modes). In segments mode
  // the rAF tick usually handles the boundary first; the guard in
  // advanceAfterAyah's caller (boundaryHandledRef) keeps this from
  // advancing twice for the same ayah.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (boundaryHandledRef.current === currentAyahRef.current && modeRef.current === 'segments') {
        return;
      }
      boundaryHandledRef.current = currentAyahRef.current;
      advanceAfterAyah(currentAyahRef.current);
    };
    const onLoadedMetadata = () => {
      // Duration is known now (both modes): the progress bar's total.
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        if (modeRef.current === 'segments' && timingRef.current) {
          const last = timingRef.current.ayahs[timingRef.current.ayahs.length - 1];
          setDurationMs(last ? last.toMs : Math.round(audio.duration * 1000));
        } else {
          setDurationMs(Math.round(audio.duration * 1000));
        }
      }
      // Phase 5: a pending resume seek (resumeSaved) applies once
      // the metadata is in; afterwards the rAF loop tracks the clock.
      if (pendingSeekRef.current !== null) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        try {
          audio.currentTime = Math.max(0, target) / 1000;
        } catch {
          /* seek after metadata is best-effort */
        }
        lastProgressRef.current = -1;
      }
      // Interpolated mode: the ayah duration is known now; spread it
      // across the ayah's words by length.
      if (modeRef.current !== 'interpolated') return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const words = splitWords(ayahTexts[currentAyahRef.current] ?? '');
      interpRef.current.set(
        currentAyahRef.current,
        interpolateWordTimings(words, Math.round(audio.duration * 1000)),
      );
      loadingRef.current = false;
    };
    const onError = () => {
      // Honest error state: offline is its own kind (the retry only
      // helps once the network is back); anything else is an audio
      // failure. No silent fallback, no infinite spinner.
      const kind: ListenErrorKind =
        typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'audio';
      setListenErrorKind(kind);
      setListenError('listenAudioFailed');
      setIsPlaying(false);
      setStatus('error');
    };
    const onWaiting = () => {
      // Buffering is a real state: the audio stalled mid-stream.
      if (statusRef.current === 'playing' || statusRef.current === 'loading') {
        setStatus('buffering');
      }
    };
    const onPlaying = () => {
      setStatus('playing');
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
    };
  }, [audioRef, advanceAfterAyah, ayahTexts, setStatus]);

  /**
   * Phase 5: preload the next ayah's audio (interpolated mode only —
   * segments mode is a single surah file, so there is nothing to
   * preload). A detached Audio element warms the browser cache; a
   * failed preload just means the next ayah loads on demand.
   */
  const preloadNext = useCallback(
    (ayah: number) => {
      const next = ayah + 1;
      if (next > ayahCount) {
        stopPreload();
        return;
      }
      const url = ayahAudioUrls[next];
      if (!url || typeof Audio === 'undefined') {
        stopPreload();
        return;
      }
      // Phase 7: stop the previous preload element first — replacing
      // the ref without stopping it left a detached <audio> loading
      // (network + memory) with nothing able to stop it.
      stopPreload();
      const pre = new Audio();
      preloadAudioRef.current = pre;
      setPreloadingNext(true);
      const done = () => setPreloadingNext(false);
      pre.addEventListener('canplaythrough', done, { once: true });
      pre.addEventListener('error', done, { once: true });
      pre.preload = 'auto';
      pre.src = url;
    },
    [ayahAudioUrls, ayahCount],
  );

  /** Phase 7: stop and drop the preload element (if any). */
  const stopPreload = useCallback(() => {
    const pre = preloadAudioRef.current;
    if (!pre) return;
    preloadAudioRef.current = null;
    try {
      pre.pause();
    } catch {
      /* already stopped */
    }
    pre.removeAttribute('src');
    pre.load();
    setPreloadingNext(false);
  }, []);

  // Phase 7: unmount must not leave a detached preload element
  // loading, and must stop the rAF loop (its effect cleanup does
  // that) — the <audio> element itself is owned by the component.
  useEffect(() => stopPreload, [stopPreload]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Phase 5: offline is an honest state up front — fetching timings
    // or audio cannot succeed, so say so instead of spinning.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setListenErrorKind('offline');
      setListenError('listenAudioFailed');
      setStatus('error');
      return;
    }
    setListenError(null);
    setListenErrorKind(null);
    setStatus('loading');
    void (async () => {
      // First play for this reciter+surah: fetch real timings.
      if (timingRef.current === null && modeRef.current === null) {
        const timing = await fetchRecitationTiming(reciter, surah);
        // Phase 7: the reciter/surah changed while the fetch was in
        // flight — the reset effect already cleared the old timings
        // and paused the audio. Do NOT install this stale timing set
        // (it would play the old reciter's audio under the new one).
        if (reciterRef.current !== reciter || surahRef.current !== surah) return;
        if (timing) {
          timingRef.current = timing;
          modeRef.current = 'segments';
          setTimingSource('segments');
          loadingRef.current = true;
          audio.src = timing.audioUrl;
          audio.load();
          const entry = timing.ayahs.find((a) => a.ayah === currentAyahRef.current)
            ?? timing.ayahs[0];
          if (entry) {
            // Seek once the file can play; the rAF loop picks the
            // ayah/word up from the clock. A resume target (from
            // resumeSaved) seeks inside this ayah instead of its start.
            // Phase 7: { once: true } — the listener removes itself
            // after firing, so a second play() before metadata lands
            // cannot stack a stale seek listener on the element.
            const seek = () => {
              const target = resumeTargetRef.current;
              resumeTargetRef.current = null;
              if (target) {
                audio.currentTime =
                  Math.min(Math.max(target.progressMs, entry.fromMs), entry.toMs) / 1000;
              } else {
                audio.currentTime = entry.fromMs / 1000;
              }
              loadingRef.current = false;
              setAyahAndWord(entry.ayah, null);
              audio.removeEventListener('loadedmetadata', seek);
            };
            audio.addEventListener('loadedmetadata', seek, { once: true });
          }
        } else {
          // No real timings: interpolated fallback on per-ayah audio.
          modeRef.current = 'interpolated';
          setTimingSource('interpolated');
          const url = ayahAudioUrls[currentAyahRef.current];
          if (!url) {
            setListenErrorKind('audio');
            setListenError('listenAudioFailed');
            setStatus('error');
            return;
          }
          loadingRef.current = true;
          audio.src = url;
          audio.load();
        }
      }
      setIsPlaying(true);
      applySpeed();
      try {
        await audio.play();
        setStatus('playing');
        if (modeRef.current === 'interpolated') preloadNext(currentAyahRef.current);
      } catch {
        const kind: ListenErrorKind =
          typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'audio';
        setListenErrorKind(kind);
        setListenError('listenAudioFailed');
        setIsPlaying(false);
        setStatus('error');
      }
    })();
  }, [audioRef, reciter, surah, ayahAudioUrls, setAyahAndWord, applySpeed, preloadNext, setStatus]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // Phase 5: pause saves the position immediately, so leaving
      // the page right after pausing still offers an exact resume.
      persistPosition(currentAyahRef.current, audio.currentTime * 1000);
      lastSavedRef.current = audio.currentTime * 1000;
      audio.pause();
    }
    setIsPlaying(false);
    setStatus('paused');
  }, [audioRef, persistPosition, setStatus]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // Phase 5: stop also saves the position (switching to practice
      // mode calls stop — the resume chip must survive the switch).
      persistPosition(currentAyahRef.current, audio.currentTime * 1000);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setIsPlaying(false);
    setStatus('idle');
    setProgressMs(0);
    setAyahAndWord(currentAyahRef.current, null);
  }, [audioRef, setAyahAndWord, persistPosition, setStatus]);

  const playAyah = useCallback(
    (ayah: number) => {
      if (ayah < 1 || ayah > ayahCount) return;
      const audio = audioRef.current;
      if (!audio) return;
      // A fresh play of an ayah means a fresh boundary to handle.
      // Without this, a replay keeps the guard set from the first
      // play, so the second play's end never advances (and the play
      // counters go stale for the next ayah). The seek below updates
      // currentTime synchronously, so the next tick cannot re-fire
      // the old ayah's boundary.
      boundaryHandledRef.current = 0;
      setListenError(null);
      setListenErrorKind(null);
      if (modeRef.current === 'segments' && timingRef.current) {
        const entry = timingRef.current.ayahs.find((a) => a.ayah === ayah);
        if (!entry) return;
        // Phase 5: a pending resume seek (resumeSaved) lands inside
        // this ayah instead of its start.
        const pending = pendingSeekRef.current;
        pendingSeekRef.current = null;
        const target =
          pending !== null
            ? Math.min(Math.max(pending, entry.fromMs), entry.toMs)
            : entry.fromMs;
        loadingRef.current = true;
        audio.currentTime = target / 1000;
        loadingRef.current = false;
        setAyahAndWord(ayah, null);
        setIsPlaying(true);
        setStatus('playing');
        applySpeed();
        void audio.play().catch(() => {
          const kind: ListenErrorKind =
            typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'audio';
          setListenErrorKind(kind);
          setListenError('listenAudioFailed');
          setIsPlaying(false);
          setStatus('error');
        });
      } else if (modeRef.current === 'interpolated') {
        const url = ayahAudioUrls[ayah];
        if (!url) return;
        setStatus('loading');
        loadingRef.current = true;
        audio.src = url;
        audio.load();
        setAyahAndWord(ayah, null);
        setIsPlaying(true);
        applySpeed();
        void audio
          .play()
          .then(() => {
            setStatus('playing');
            preloadNext(ayah);
          })
          .catch(() => {
            const kind: ListenErrorKind =
              typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'audio';
            setListenErrorKind(kind);
            setListenError('listenAudioFailed');
            setIsPlaying(false);
            setStatus('error');
          });
      } else {
        // Timings not loaded yet: start from this ayah.
        setAyahAndWord(ayah, null);
        play();
      }
    },
    [audioRef, ayahAudioUrls, ayahCount, play, setAyahAndWord, applySpeed, preloadNext, setStatus],
  );

  // Keep the ended handler's ref in sync.
  playAyahRef.current = playAyah;

  /** Phase 5: clear the error, drop the cached timings (the failure
      may have been a stale URL or a dead CDN edge), and try the
      current ayah again from scratch. */
  const retry = useCallback(() => {
    timingRef.current = null;
    modeRef.current = null;
    interpRef.current.clear();
    setTimingSource(null);
    setListenError(null);
    setListenErrorKind(null);
    setStatus('idle');
    play();
  }, [play, setStatus]);

  /** Phase 5: play from the persisted position (explicit resume —
      play() itself always starts at the selected ayah, never
      silently jumps). The seek lands inside the saved ayah. */
  const resumeSaved = useCallback(() => {
    if (typeof window === 'undefined') return;
    const saved = loadListenPosition(window.localStorage, reciter, surah, ayahCount);
    if (!saved) return;
    setListenError(null);
    setListenErrorKind(null);
    if (modeRef.current === 'segments' && timingRef.current) {
      pendingSeekRef.current = saved.progressMs;
      playAyahRef.current(saved.ayah);
    } else if (modeRef.current === 'interpolated') {
      pendingSeekRef.current = saved.progressMs;
      playAyahRef.current(saved.ayah);
    } else {
      // Timings not loaded yet: play() applies the target when the
      // surah file's metadata lands.
      resumeTargetRef.current = saved;
      setAyahAndWord(saved.ayah, null);
      play();
    }
  }, [reciter, surah, ayahCount, play, setAyahAndWord]);

  const prevAyah = useCallback(() => {
    playAyah(Math.max(1, currentAyahRef.current - 1));
  }, [playAyah]);

  const nextAyah = useCallback(() => {
    playAyah(Math.min(ayahCount, currentAyahRef.current + 1));
  }, [playAyah, ayahCount]);

  // Resume after pause: the audio element keeps its source, so play()
  // just continues from the same position.
  const resume = play;

  // Reciter or surah change: reset the timing cache so the next play
  // fetches the right timings; stop any playing audio.
  useEffect(() => {
    timingRef.current = null;
    modeRef.current = null;
    interpRef.current.clear();
    stopPreload();
    setTimingSource(null);
    setListenError(null);
    setListenErrorKind(null);
    setStatus('idle');
    ayahPlaysRef.current = 1;
    rangePlaysRef.current = 1;
    boundaryHandledRef.current = 0;
    pendingSeekRef.current = null;
    resumeTargetRef.current = null;
    setRepeatRemaining(null);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setIsPlaying(false);
    setProgressMs(0);
    setDurationMs(0);
    setAyahAndWord(1, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reciter, surah]);

  // Phase 5: reload the saved position once the surah's ayah count
  // is known (it arrives with the texts, after the reset above).
  useEffect(() => {
    if (ayahCount <= 0 || typeof window === 'undefined') return;
    setSavedPosition(loadListenPosition(window.localStorage, reciter, surah, ayahCount));
  }, [reciter, surah, ayahCount]);

  return {
    isPlaying,
    currentAyah,
    currentWord,
    timingSource,
    listenError,
    listenErrorKind,
    listenStatus,
    isBuffering: listenStatus === 'buffering',
    play,
    pause,
    resume,
    stop,
    retry,
    playAyah,
    prevAyah,
    nextAyah,
    repeatMode,
    setRepeatMode: setRepeat,
    repeatRemaining,
    speed,
    setSpeed,
    cycleSpeed,
    cycleRepeatMode,
    progressMs,
    durationMs,
    seek,
    savedPosition,
    hasSavedPosition: savedPosition !== null,
    resumeSaved,
    preloadingNext,
  };
}
