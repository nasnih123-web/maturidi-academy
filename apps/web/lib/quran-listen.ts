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
 * The hook owns the playback state and the rAF tracking loop; the
 * component owns the <audio> element (passed by ref) and renders the
 * highlight from the onAyahChange/onWordChange callbacks.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
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
}

export type ListenRepeatMode = 'off' | 'ayah' | 'surah';

export interface ListenControls {
  isPlaying: boolean;
  currentAyah: number;
  currentWord: number | null;
  /** Which timing source is in use (null = not loaded yet). */
  timingSource: TimingSource | null;
  listenError: string | null;
  play: () => void;
  pause: () => void;
  /** Resume after pause (same as play once audio is loaded). */
  resume: () => void;
  stop: () => void;
  playAyah: (ayah: number) => void;
  prevAyah: () => void;
  nextAyah: () => void;
  repeatMode: ListenRepeatMode;
  setRepeatMode: (mode: ListenRepeatMode) => void;
  speed: number;
  setSpeed: (rate: number) => void;
  /** Playback position / total length in ms (surah total in segments
      mode, current ayah in interpolated mode). */
  progressMs: number;
  durationMs: number;
  seek: (ms: number) => void;
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

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAyah, setCurrentAyah] = useState(1);
  const [currentWord, setCurrentWord] = useState<number | null>(null);
  const [timingSource, setTimingSource] = useState<TimingSource | null>(null);
  const [listenError, setListenError] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<ListenRepeatMode>('off');
  const [speed, setSpeedState] = useState(1);
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const repeatModeRef = useRef<ListenRepeatMode>('off');
  const speedRef = useRef(1);
  // Latest playAyah for the ended handler (avoids a stale closure).
  const playAyahRef = useRef<(ayah: number) => void>(() => {});
  // Last reported progress (throttle: state updates at most ~4x/s).
  const lastProgressRef = useRef(-1);

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
      const clamped = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1;
      speedRef.current = clamped;
      setSpeedState(clamped);
      applySpeed();
    },
    [applySpeed],
  );

  const setRepeat = useCallback((mode: ListenRepeatMode) => {
    repeatModeRef.current = mode;
    setRepeatMode(mode);
  }, []);

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

  /** Advance to the next ayah in segments mode (seek) or stop at the
      end of the surah. Returns false when the surah is finished. */
  const advanceSegments = useCallback((): boolean => {
    const audio = audioRef.current;
    const timing = timingRef.current;
    if (!audio || !timing) return false;
    const next = currentAyahRef.current + 1;
    const entry = timing.ayahs.find((a) => a.ayah === next);
    if (!entry) return false;
    loadingRef.current = true;
    audio.currentTime = entry.fromMs / 1000;
    loadingRef.current = false;
    setAyahAndWord(next, null);
    return true;
  }, [audioRef, setAyahAndWord]);

  /** Advance to the next ayah in interpolated mode (load its audio)
      or stop at the end of the surah. */
  const advanceInterpolated = useCallback((): boolean => {
    const audio = audioRef.current;
    if (!audio) return false;
    const next = currentAyahRef.current + 1;
    if (next > ayahCount) return false;
    const url = ayahAudioUrls[next];
    if (!url) return false;
    loadingRef.current = true;
    audio.src = url;
    audio.load();
    setAyahAndWord(next, null);
    void audio.play().catch(() => {
      setListenError('listenAudioFailed');
      setIsPlaying(false);
    });
    return true;
  }, [audioRef, ayahAudioUrls, ayahCount, setAyahAndWord]);

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
            // Repeat-ayah: loop the current ayah instead of moving on.
            if (repeatModeRef.current === 'ayah' && tMs >= entry.toMs - 120) {
              audio.currentTime = entry.fromMs / 1000;
            }
            const word = wordIndexAtTimeMs(entry.words, tMs - entry.fromMs);
            setAyahAndWord(entry.ayah, word);
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
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return stopRaf;
  }, [isPlaying, audioRef, setAyahAndWord, stopRaf]);

  // Audio ended: advance to the next ayah, or stop at the surah end.
  // Repeat modes: 'ayah' replays the same ayah (interpolated mode;
  // segments mode loops in the rAF tick), 'surah' restarts the surah.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (modeRef.current === 'segments') {
        if (repeatModeRef.current === 'surah') {
          playAyahRef.current(1);
          return;
        }
        if (!advanceSegments()) {
          setIsPlaying(false);
          setAyahAndWord(currentAyahRef.current, null);
        }
      } else {
        if (repeatModeRef.current === 'ayah') {
          playAyahRef.current(currentAyahRef.current);
          return;
        }
        if (repeatModeRef.current === 'surah' && currentAyahRef.current >= ayahCount) {
          playAyahRef.current(1);
          return;
        }
        if (!advanceInterpolated()) {
          setIsPlaying(false);
          setAyahAndWord(currentAyahRef.current, null);
        }
      }
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
      setListenError('listenAudioFailed');
      setIsPlaying(false);
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('error', onError);
    };
  }, [audioRef, advanceSegments, advanceInterpolated, ayahCount, ayahTexts, setAyahAndWord]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setListenError(null);
    void (async () => {
      // First play for this reciter+surah: fetch real timings.
      if (timingRef.current === null && modeRef.current === null) {
        const timing = await fetchRecitationTiming(reciter, surah);
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
            // ayah/word up from the clock.
            const seek = () => {
              audio.currentTime = entry.fromMs / 1000;
              loadingRef.current = false;
              setAyahAndWord(entry.ayah, null);
              audio.removeEventListener('loadedmetadata', seek);
            };
            audio.addEventListener('loadedmetadata', seek);
          }
        } else {
          // No real timings: interpolated fallback on per-ayah audio.
          modeRef.current = 'interpolated';
          setTimingSource('interpolated');
          const url = ayahAudioUrls[currentAyahRef.current];
          if (!url) {
            setListenError('listenAudioFailed');
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
      } catch {
        setListenError('listenAudioFailed');
        setIsPlaying(false);
      }
    })();
  }, [audioRef, reciter, surah, ayahAudioUrls, setAyahAndWord, applySpeed]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, [audioRef]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setIsPlaying(false);
    setProgressMs(0);
    setAyahAndWord(currentAyahRef.current, null);
  }, [audioRef, setAyahAndWord]);

  const playAyah = useCallback(
    (ayah: number) => {
      if (ayah < 1 || ayah > ayahCount) return;
      const audio = audioRef.current;
      if (!audio) return;
      setListenError(null);
      if (modeRef.current === 'segments' && timingRef.current) {
        const entry = timingRef.current.ayahs.find((a) => a.ayah === ayah);
        if (!entry) return;
        loadingRef.current = true;
        audio.currentTime = entry.fromMs / 1000;
        loadingRef.current = false;
        setAyahAndWord(ayah, null);
        setIsPlaying(true);
        applySpeed();
        void audio.play().catch(() => {
          setListenError('listenAudioFailed');
          setIsPlaying(false);
        });
      } else if (modeRef.current === 'interpolated') {
        const url = ayahAudioUrls[ayah];
        if (!url) return;
        loadingRef.current = true;
        audio.src = url;
        audio.load();
        setAyahAndWord(ayah, null);
        setIsPlaying(true);
        applySpeed();
        void audio.play().catch(() => {
          setListenError('listenAudioFailed');
          setIsPlaying(false);
        });
      } else {
        // Timings not loaded yet: start from this ayah.
        setAyahAndWord(ayah, null);
        play();
      }
    },
    [audioRef, ayahAudioUrls, ayahCount, play, setAyahAndWord, applySpeed],
  );

  // Keep the ended handler's ref in sync.
  playAyahRef.current = playAyah;

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
    setTimingSource(null);
    setListenError(null);
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

  return {
    isPlaying,
    currentAyah,
    currentWord,
    timingSource,
    listenError,
    play,
    pause,
    resume,
    stop,
    playAyah,
    prevAyah,
    nextAyah,
    repeatMode,
    setRepeatMode: setRepeat,
    speed,
    setSpeed,
    progressMs,
    durationMs,
    seek,
  };
}
