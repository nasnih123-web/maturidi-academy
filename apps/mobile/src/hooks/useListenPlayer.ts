/**
 * apps/mobile — src/hooks/useListenPlayer.ts
 *
 * The listen/follow-mode player for the mobile Hifz listen screen
 * (completion mission §5). Mirrors the web hook
 * (`apps/web/lib/quran-listen.ts`) with the same two strategies:
 *
 * - SEGMENTS (real): the backend timing endpoint returns the per-surah
 *   audio URL + per-ayah ranges + per-word segments (Quran.com v4).
 *   One audio file; the hook seeks to the ayah's range and highlights
 *   by the real segments.
 * - INTERPOLATED (fallback): the timing endpoint is unavailable. The
 *   per-ayah audio (site's active reciter, from getSurah) is played
 *   ayah by ayah and the ayah duration is spread across its words by
 *   length. The UI labels this as estimated.
 *
 * The player itself is the module singleton in services/listenAudio.ts
 * (expo-audio), so this hook's state survives navigation: the hook
 * instance lives in `ListenPlayerProvider`, never in a screen.
 *
 * Position: saved locally (kv) throttled to 5s while playing and
 * immediately on pause/stop; pushed to the server best-effort on
 * pause/stop and at login (`syncListenPositionOnLogin`). Guests keep
 * local only; a server disconnect never clears the local position.
 * Speeds are the six Tarteel speeds (0.5×–1.75×); repeat follows
 * `listenRepeatNext` (off / ayah / range / surah).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadSurahAudio,
  getListenPlayer,
  getListenStatus,
  isAudioDownloaded,
  loadListenSource,
  localAudioUri,
  onListenStatus,
  pauseListen,
  playListenSource,
  resumeListen,
  seekListen,
  setListenLockScreen,
  setListenRate,
  stopListen,
  type ListenAudioStatus,
} from "../services/listenAudio";
import {
  clearLocalPosition,
  clearServerPositionBestEffort,
  fetchReciters,
  fetchRecitationTiming,
  loadLocalPosition,
  pushLocalPositionBestEffort,
  saveLocalPosition,
  syncListenPositionOnLogin,
} from "../services/listenSync";
import {
  clampListenRepeatCount,
  defaultListenPosition,
  interpolateWordTimings,
  listenRepeatNext,
  listenRepeatRemaining,
  nextListenRepeatMode,
  nextListenSpeed,
  normalizeListenSpeed,
  wordIndexAtTimeMs,
  type ListenErrorKind,
  type ListenPosition,
  type ListenRepeatMode,
  type ListenRepeatRange,
  type ListenStatus,
  type RecitationTiming,
  type RecitationWordTiming,
  type TimingSource,
} from "../lib/listenPlayer";

export interface ListenOpenSurah {
  surah: number;
  nameAr: string;
  ayahCount: number;
  ayahTexts: Record<number, string>;
  ayahAudioUrls: Record<number, string | null>;
  /** Start at this ayah (deep link / hub resume); default 1. */
  startAyah?: number;
}

export interface ListenControls {
  status: ListenStatus;
  isPlaying: boolean;
  isBuffering: boolean;
  reciter: string;
  reciters: { id: string; label: string }[];
  setReciter: (id: string) => void;
  surah: number;
  surahName: string;
  currentAyah: number;
  currentWord: number | null;
  ayahCount: number;
  timingSource: TimingSource | null;
  error: ListenErrorKind | null;
  errorMessage: string | null;
  progressMs: number;
  durationMs: number;
  speed: number;
  setSpeed: (rate: number) => void;
  cycleSpeed: () => void;
  repeatMode: ListenRepeatMode;
  setRepeatMode: (mode: ListenRepeatMode) => void;
  cycleRepeatMode: () => void;
  repeatRange: ListenRepeatRange | null;
  setRepeatRange: (range: ListenRepeatRange | null) => void;
  repeatAyahCount: number;
  setRepeatAyahCount: (n: number) => void;
  repeatRemaining: number | null;
  savedPosition: ListenPosition | null;
  hasSavedPosition: boolean;
  downloaded: boolean;
  downloading: boolean;
  downloadError: string | null;
  downloadForOffline: () => Promise<void>;
  offline: boolean;
  openSurah: (opts: ListenOpenSurah) => void;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  retry: () => void;
  playAyah: (ayah: number) => void;
  prevAyah: () => void;
  nextAyah: () => void;
  seek: (ms: number) => void;
  resumeSaved: () => void;
}

function splitWords(text: string): string[] {
  return (text ?? "").split(/\s+/).filter(Boolean);
}

const LOAD_WATCHDOG_MS = 15000;

export function useListenPlayer(): ListenControls {
  const [reciter, setReciterState] = useState("alafasy");
  const [reciters, setReciters] = useState<{ id: string; label: string }[]>([]);
  const [surah, setSurah] = useState(1);
  const [surahName, setSurahName] = useState("");
  const [ayahCount, setAyahCount] = useState(0);
  const [status, setStatus] = useState<ListenStatus>("idle");
  const [currentAyah, setCurrentAyah] = useState(1);
  const [currentWord, setCurrentWord] = useState<number | null>(null);
  const [timingSource, setTimingSource] = useState<TimingSource | null>(null);
  const [error, setError] = useState<ListenErrorKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [repeatMode, setRepeatModeState] = useState<ListenRepeatMode>("off");
  const [repeatRange, setRepeatRangeState] = useState<ListenRepeatRange | null>(null);
  const [repeatAyahCount, setRepeatAyahCountState] = useState(1);
  const [repeatRemaining, setRepeatRemaining] = useState<number | null>(null);
  const [savedPosition, setSavedPosition] = useState<ListenPosition | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const reciterRef = useRef(reciter);
  const surahRef = useRef(surah);
  const ayahTextsRef = useRef<Record<number, string>>({});
  const ayahAudioUrlsRef = useRef<Record<number, string | null>>({});
  const ayahCountRef = useRef(0);
  const timingRef = useRef<RecitationTiming | null>(null);
  const modeRef = useRef<TimingSource | null>(null);
  const interpRef = useRef<Map<number, RecitationWordTiming[]>>(new Map());
  const currentAyahRef = useRef(1);
  const currentWordRef = useRef<number | null>(null);
  const statusRef = useRef<ListenStatus>("idle");
  const speedRef = useRef(1);
  const repeatModeRef = useRef<ListenRepeatMode>("off");
  const repeatRangeRef = useRef<ListenRepeatRange | null>(null);
  const repeatAyahCountRef = useRef(1);
  const ayahPlaysRef = useRef(1);
  const rangePlaysRef = useRef(1);
  const boundaryHandledRef = useRef(0);
  const lastProgressRef = useRef(-1);
  const lastSavedRef = useRef(-1);
  const pendingSeekRef = useRef<number | null>(null);
  const resumeTargetRef = useRef<ListenPosition | null>(null);
  const loadingRef = useRef(false);
  const sourceLoadedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedOnceRef = useRef(false);

  reciterRef.current = reciter;
  surahRef.current = surah;

  const setStatusBoth = useCallback((s: ListenStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const persistPosition = useCallback(async (ayah: number, tMs: number, rate?: number) => {
    const pos: ListenPosition = {
      reciter: reciterRef.current,
      surah: surahRef.current,
      ayah,
      progressMs: Math.max(0, Math.round(tMs)),
      speed: rate ?? speedRef.current,
      repeatMode: repeatModeRef.current,
      repeatAyah: repeatAyahCountRef.current,
      repeatRangeStart: repeatRangeRef.current?.start ?? null,
      repeatRangeEnd: repeatRangeRef.current?.end ?? null,
      repeatRangeCount: repeatRangeRef.current?.count ?? 1,
      updatedAt: Date.now(),
    };
    await saveLocalPosition(pos);
    setSavedPosition(pos);
  }, []);

  const pushBestEffort = useCallback(() => {
    void pushLocalPositionBestEffort();
  }, []);

  const refreshRemaining = useCallback(() => {
    setRepeatRemaining(
      listenRepeatRemaining({
        currentAyah: currentAyahRef.current,
        ayahCount: ayahCountRef.current,
        mode: repeatModeRef.current,
        ayahRepeatCount: repeatAyahCountRef.current,
        range: repeatRangeRef.current,
        ayahPlays: ayahPlaysRef.current,
        rangePlays: rangePlaysRef.current,
      }),
    );
  }, []);

  const setAyahAndWord = useCallback((ayah: number, word: number | null) => {
    if (ayah !== currentAyahRef.current) {
      currentAyahRef.current = ayah;
      setCurrentAyah(ayah);
      boundaryHandledRef.current = 0;
    }
    if (word !== currentWordRef.current) {
      currentWordRef.current = word;
      setCurrentWord(word);
    }
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      const s = getListenStatus();
      if (s && !s.playing && !s.isLoaded) {
        setError("audio");
        setErrorMessage("listenAudioFailed");
        setStatusBoth("error");
      }
    }, LOAD_WATCHDOG_MS);
  }, [clearWatchdog, setStatusBoth]);

  const applySpeed = useCallback(() => {
    setListenRate(speedRef.current);
  }, []);

  const setSpeed = useCallback(
    (rate: number) => {
      const clamped = normalizeListenSpeed(rate);
      speedRef.current = clamped;
      setSpeedState(clamped);
      const player = getListenPlayer();
      void persistPosition(
        currentAyahRef.current,
        player ? player.currentTime * 1000 : progressMs,
        clamped,
      );
      applySpeed();
    },
    [applySpeed, persistPosition, progressMs],
  );

  const cycleSpeed = useCallback(() => {
    setSpeed(nextListenSpeed(speedRef.current));
  }, [setSpeed]);

  const setRepeatMode = useCallback(
    (mode: ListenRepeatMode) => {
      repeatModeRef.current = mode;
      setRepeatModeState(mode);
      ayahPlaysRef.current = 1;
      rangePlaysRef.current = 1;
      refreshRemaining();
    },
    [refreshRemaining],
  );

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode(nextListenRepeatMode(repeatModeRef.current));
  }, [setRepeatMode]);

  const setRepeatRange = useCallback((range: ListenRepeatRange | null) => {
    repeatRangeRef.current = range;
    setRepeatRangeState(range);
    rangePlaysRef.current = 1;
    refreshRemaining();
  }, [refreshRemaining]);

  const setRepeatAyahCount = useCallback(
    (n: number) => {
      const clamped = clampListenRepeatCount(n);
      repeatAyahCountRef.current = clamped;
      setRepeatAyahCountState(clamped);
      refreshRemaining();
    },
    [refreshRemaining],
  );

  // ── Advance (shared by the status handler and didJustFinish) ─────────
  const playAyahRef = useRef<(ayah: number) => void>(() => {});

  const advanceAfterAyah = useCallback(
    (finishedAyah: number): boolean => {
      const outcome = listenRepeatNext({
        currentAyah: finishedAyah,
        ayahCount: ayahCountRef.current,
        mode: repeatModeRef.current,
        ayahRepeatCount: repeatAyahCountRef.current,
        range: repeatRangeRef.current,
        ayahPlays: ayahPlaysRef.current,
        rangePlays: rangePlaysRef.current,
      });
      ayahPlaysRef.current = outcome.ayahPlays;
      rangePlaysRef.current = outcome.rangePlays;
      refreshRemaining();
      if (outcome.action === "stop") {
        stopListen();
        sourceLoadedRef.current = false;
        setListenLockScreen(false, "", "");
        setStatusBoth("idle");
        setAyahAndWord(finishedAyah, null);
        // Surah finished: no stale resume — the next visit starts at ayah 1.
        // Clear the server row too: a push after a local clear would be
        // a no-op (nothing left to push), so without this the other
        // device would adopt the finished position at its next login.
        void (async () => {
          await clearLocalPosition();
          setSavedPosition(null);
          await clearServerPositionBestEffort();
        })();
        return false;
      }
      playAyahRef.current(outcome.ayah);
      return true;
    },
    [refreshRemaining, setAyahAndWord, setStatusBoth],
  );
  const advanceRef = useRef(advanceAfterAyah);
  advanceRef.current = advanceAfterAyah;

  // ── Status subscription: clock → ayah/word, progress, buffering ──────
  useEffect(() => {
    return onListenStatus((s: ListenAudioStatus) => {
      const tMs = s.currentTime * 1000;
      if (s.playing) {
        clearWatchdog();
        if (statusRef.current !== "playing") setStatusBoth("playing");
        setOffline(false);
      } else if (s.isBuffering && statusRef.current === "playing") {
        setStatusBoth("buffering");
      }
      if (s.duration > 0) setDurationMs(Math.round(s.duration * 1000));
      if (modeRef.current === "segments" && timingRef.current) {
        const timing = timingRef.current;
        const entry = timing.ayahs.find((a) => tMs >= a.fromMs && tMs < a.toMs);
        if (entry) {
          if (entry.ayah > currentAyahRef.current) {
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
              advanceRef.current(currentAyahRef.current);
            } else {
              ayahPlaysRef.current = 1;
              setAyahAndWord(entry.ayah, wordIndexAtTimeMs(entry.words, tMs - entry.fromMs));
            }
          } else if (tMs >= entry.toMs - 120 && boundaryHandledRef.current !== entry.ayah) {
            boundaryHandledRef.current = entry.ayah;
            advanceRef.current(entry.ayah);
          } else {
            setAyahAndWord(entry.ayah, wordIndexAtTimeMs(entry.words, tMs - entry.fromMs));
          }
        }
      } else if (modeRef.current === "interpolated") {
        if (!interpRef.current.has(currentAyahRef.current) && s.duration > 0) {
          const words = splitWords(ayahTextsRef.current[currentAyahRef.current] ?? "");
          interpRef.current.set(
            currentAyahRef.current,
            interpolateWordTimings(words, Math.round(s.duration * 1000)),
          );
        }
        const words = interpRef.current.get(currentAyahRef.current) ?? [];
        setAyahAndWord(currentAyahRef.current, wordIndexAtTimeMs(words, tMs));
      }
      if (Math.abs(tMs - lastProgressRef.current) >= 250) {
        lastProgressRef.current = tMs;
        setProgressMs(Math.round(tMs));
      }
      if (s.playing && Math.abs(tMs - lastSavedRef.current) >= 5000) {
        lastSavedRef.current = tMs;
        void persistPosition(currentAyahRef.current, tMs);
      }
      if (s.didJustFinish) {
        if (boundaryHandledRef.current === currentAyahRef.current && modeRef.current === "segments") return;
        boundaryHandledRef.current = currentAyahRef.current;
        advanceRef.current(currentAyahRef.current);
      }
    });
  }, [clearWatchdog, persistPosition, setAyahAndWord, setStatusBoth]);

  // ── Core actions ──────────────────────────────────────────────────────
  const playAyah = useCallback(
    (ayah: number) => {
      if (ayah < 1 || ayah > ayahCountRef.current) return;
      boundaryHandledRef.current = 0;
      setError(null);
      setErrorMessage(null);
      const player = getListenPlayer();
      if (modeRef.current === "segments" && timingRef.current) {
        const entry = timingRef.current.ayahs.find((a) => a.ayah === ayah);
        if (!entry || !player) return;
        const pending = pendingSeekRef.current;
        pendingSeekRef.current = null;
        const target = pending !== null ? Math.min(Math.max(pending, entry.fromMs), entry.toMs) : entry.fromMs;
        loadingRef.current = true;
        // Resume only once the seek has landed: resuming first would
        // briefly play from the old position instead of the target ayah.
        void seekListen(target / 1000)
          .catch(() => undefined)
          .finally(() => {
            loadingRef.current = false;
            // The user may have stopped while the seek was in flight.
            if (sourceLoadedRef.current) resumeListen();
          });
        sourceLoadedRef.current = true;
        setAyahAndWord(ayah, null);
        setStatusBoth("playing");
        applySpeed();
      } else if (modeRef.current === "interpolated") {
        const url = ayahAudioUrlsRef.current[ayah];
        if (!url) {
          setError("audio");
          setErrorMessage("listenAudioFailed");
          setStatusBoth("error");
          return;
        }
        setStatusBoth("loading");
        loadingRef.current = true;
        try {
          playListenSource(url);
          sourceLoadedRef.current = true;
          setAyahAndWord(ayah, null);
          setStatusBoth("playing");
          applySpeed();
          armWatchdog();
          // Resume inside this ayah (interpolated clock is within-ayah):
          // best-effort seek once the file is playing.
          const pending = pendingSeekRef.current;
          pendingSeekRef.current = null;
          if (pending !== null && pending > 0) {
            setTimeout(() => {
              void seekListen(pending / 1000).catch(() => undefined);
            }, 1000);
          }
        } catch {
          setError("audio");
          setErrorMessage("listenAudioFailed");
          setStatusBoth("error");
        } finally {
          loadingRef.current = false;
        }
      } else {
        // Timings not loaded yet: start from this ayah via play().
        setAyahAndWord(ayah, null);
        resumeTargetRef.current = null;
        // play() is defined below; call through the ref to avoid a cycle.
        playRef.current();
      }
    },
    [applySpeed, armWatchdog, setAyahAndWord, setStatusBoth],
  );
  playAyahRef.current = playAyah;

  const play = useCallback(() => {
    const rec = reciterRef.current;
    const sur = surahRef.current;
    if (ayahCountRef.current <= 0) return;
    setError(null);
    setErrorMessage(null);
    setStatusBoth("loading");
    armWatchdog();
    // Segments timings loaded and the surah file still in the player:
    // just resume from the current position.
    if (modeRef.current === "segments" && timingRef.current && sourceLoadedRef.current) {
      setStatusBoth("playing");
      applySpeed();
      resumeListen();
      return;
    }
    // Segments timings loaded but the source was dropped (stop):
    // reload the surah file and seek to the current ayah.
    if (modeRef.current === "segments" && timingRef.current && !sourceLoadedRef.current) {
      const timing = timingRef.current;
      const source = localAudioUri(rec, sur) ?? timing.audioUrl;
      loadListenSource(source);
      sourceLoadedRef.current = true;
      const target = resumeTargetRef.current;
      resumeTargetRef.current = null;
      const entry =
        timing.ayahs.find((a) => a.ayah === (target?.ayah ?? currentAyahRef.current)) ?? timing.ayahs[0];
      const seekMs = entry
        ? target
          ? Math.min(Math.max(target.progressMs, entry.fromMs), entry.toMs)
          : entry.fromMs
        : 0;
      if (entry) setAyahAndWord(entry.ayah, null);
      // Seek before playing: starting first would briefly play from
      // position 0 (the freshly loaded source) instead of the resume
      // target. The guard covers a stop issued while seeking.
      void seekListen(seekMs / 1000)
        .catch(() => undefined)
        .finally(() => {
          if (!sourceLoadedRef.current) return;
          setStatusBoth("playing");
          applySpeed();
          playListenSource(source);
          setListenLockScreen(true, surahName || `سورهٔ ${sur}`, rec);
        });
      return;
    }
    // Interpolated mode already loaded: resume the ayah file.
    if (modeRef.current === "interpolated") {
      setStatusBoth("playing");
      applySpeed();
      resumeListen();
      return;
    }
    void (async () => {
      const timing = await fetchRecitationTiming(rec, sur);
      if (reciterRef.current !== rec || surahRef.current !== sur) return; // stale fetch
      if (timing) {
        timingRef.current = timing;
        modeRef.current = "segments";
        setTimingSource("segments");
        setDownloaded(isAudioDownloaded(rec, sur));
        const source = localAudioUri(rec, sur) ?? timing.audioUrl;
        loadListenSource(source);
        sourceLoadedRef.current = true;
        const target = resumeTargetRef.current;
        resumeTargetRef.current = null;
        const entry =
          timing.ayahs.find((a) => a.ayah === (target?.ayah ?? currentAyahRef.current)) ?? timing.ayahs[0];
        if (entry) {
          const seekMs = target
            ? Math.min(Math.max(target.progressMs, entry.fromMs), entry.toMs)
            : entry.fromMs;
          loadingRef.current = true;
          await seekListen(seekMs / 1000).catch(() => undefined);
          loadingRef.current = false;
          setAyahAndWord(entry.ayah, null);
        }
        setStatusBoth("playing");
        applySpeed();
        playListenSource(source);
        setListenLockScreen(true, surahName || `سورهٔ ${sur}`, rec);
        return;
      }
      // No real timings: interpolated fallback on per-ayah audio.
      modeRef.current = "interpolated";
      setTimingSource("interpolated");
      const url = ayahAudioUrlsRef.current[currentAyahRef.current];
      if (!url) {
        setOffline(false);
        setError("audio");
        setErrorMessage("listenAudioFailed");
        setStatusBoth("error");
        return;
      }
      setStatusBoth("playing");
      applySpeed();
      playListenSource(url);
      sourceLoadedRef.current = true;
      setListenLockScreen(true, surahName || `سورهٔ ${sur}`, rec);
    })().catch(() => {
      setError("audio");
      setErrorMessage("listenAudioFailed");
      setStatusBoth("error");
    });
  }, [applySpeed, armWatchdog, setAyahAndWord, setStatusBoth, surahName]);
  const playRef = useRef(play);
  playRef.current = play;

  const pause = useCallback(() => {
    const player = getListenPlayer();
    if (player) {
      void persistPosition(currentAyahRef.current, player.currentTime * 1000);
      lastSavedRef.current = player.currentTime * 1000;
      pauseListen();
    }
    setStatusBoth("paused");
    pushBestEffort();
  }, [persistPosition, pushBestEffort, setStatusBoth]);

  const stop = useCallback(() => {
    const player = getListenPlayer();
    if (player) {
      void persistPosition(currentAyahRef.current, player.currentTime * 1000);
    }
    stopListen();
    sourceLoadedRef.current = false;
    setListenLockScreen(false, "", "");
    setStatusBoth("idle");
    setProgressMs(0);
    setAyahAndWord(currentAyahRef.current, null);
    pushBestEffort();
  }, [persistPosition, pushBestEffort, setAyahAndWord, setStatusBoth]);

  const retry = useCallback(() => {
    timingRef.current = null;
    modeRef.current = null;
    interpRef.current.clear();
    setTimingSource(null);
    setError(null);
    setErrorMessage(null);
    setStatusBoth("idle");
    playRef.current();
  }, [setStatusBoth]);

  const resumeSaved = useCallback(() => {
    void (async () => {
      const saved = await loadLocalPosition();
      if (!saved || saved.surah !== surahRef.current || saved.reciter !== reciterRef.current) return;
      setError(null);
      setErrorMessage(null);
      if (modeRef.current === "segments" && timingRef.current !== null) {
        pendingSeekRef.current = saved.progressMs;
        playAyahRef.current(saved.ayah);
      } else if (modeRef.current === "interpolated") {
        pendingSeekRef.current = saved.progressMs;
        playAyahRef.current(saved.ayah);
      } else {
        resumeTargetRef.current = saved;
        setAyahAndWord(saved.ayah, null);
        playRef.current();
      }
    })();
  }, [setAyahAndWord]);

  const prevAyah = useCallback(() => {
    playAyah(Math.max(1, currentAyahRef.current - 1));
  }, [playAyah]);

  const nextAyah = useCallback(() => {
    playAyah(Math.min(ayahCountRef.current, currentAyahRef.current + 1));
  }, [playAyah]);

  const seek = useCallback(
    (ms: number) => {
      const player = getListenPlayer();
      if (!player) return;
      if (modeRef.current === "segments" && timingRef.current) {
        const total = timingRef.current.ayahs[timingRef.current.ayahs.length - 1]?.toMs ?? 0;
        void seekListen(Math.min(Math.max(ms, 0), total) / 1000);
      } else {
        void seekListen(Math.max(ms, 0) / 1000);
      }
      lastProgressRef.current = -1;
    },
    [],
  );

  const downloadForOffline = useCallback(async () => {
    if (downloading) return;
    const timing = timingRef.current;
    // Without timings there is no surah file URL; fetch them first.
    let url = timing?.audioUrl ?? null;
    if (!url) {
      const fetched = await fetchRecitationTiming(reciterRef.current, surahRef.current);
      url = fetched?.audioUrl ?? null;
      if (fetched) {
        timingRef.current = fetched;
        modeRef.current = "segments";
        setTimingSource("segments");
      }
    }
    if (!url) {
      setDownloadError("listenAudioFailed");
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadSurahAudio(reciterRef.current, surahRef.current, url);
      setDownloaded(true);
    } catch {
      // A failed download never touches the playback state — the user
      // can keep streaming; the button just reports the failure.
      setDownloadError("listenOffline");
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  // ── Open a surah / change reciter ─────────────────────────────────────
  const openSurah = useCallback(
    (opts: ListenOpenSurah) => {
      // Same surah revisited (e.g. back from another tab while playing):
      // only refresh texts/urls — never stop the running playback.
      if (opts.surah === surahRef.current && ayahCountRef.current > 0) {
        ayahTextsRef.current = opts.ayahTexts;
        ayahAudioUrlsRef.current = opts.ayahAudioUrls;
        if (opts.startAyah !== undefined && statusRef.current === "idle") {
          const start = Math.max(1, Math.min(opts.startAyah, Math.max(1, opts.ayahCount)));
          setAyahAndWord(start, null);
        }
        return;
      }
      stopListen();
      sourceLoadedRef.current = false;
      setListenLockScreen(false, "", "");
      timingRef.current = null;
      modeRef.current = null;
      interpRef.current.clear();
      setTimingSource(null);
      setError(null);
      setErrorMessage(null);
      setStatusBoth("idle");
      ayahPlaysRef.current = 1;
      rangePlaysRef.current = 1;
      boundaryHandledRef.current = 0;
      pendingSeekRef.current = null;
      resumeTargetRef.current = null;
      ayahTextsRef.current = opts.ayahTexts;
      ayahAudioUrlsRef.current = opts.ayahAudioUrls;
      ayahCountRef.current = opts.ayahCount;
      setSurah(opts.surah);
      surahRef.current = opts.surah;
      setSurahName(opts.nameAr);
      setAyahCount(opts.ayahCount);
      setProgressMs(0);
      setDurationMs(0);
      setDownloaded(isAudioDownloaded(reciterRef.current, opts.surah));
      const start = Math.max(1, Math.min(opts.startAyah ?? 1, Math.max(1, opts.ayahCount)));
      setAyahAndWord(start, null);
      void (async () => {
        const saved = await loadLocalPosition();
        if (saved && saved.surah === opts.surah && saved.reciter === reciterRef.current) {
          setSavedPosition(saved);
          setSpeedState(saved.speed);
          speedRef.current = saved.speed;
        } else {
          setSavedPosition(null);
          const fresh = defaultListenPosition(reciterRef.current, opts.surah);
          setSpeedState(fresh.speed);
          speedRef.current = fresh.speed;
        }
      })();
    },
    [setAyahAndWord, setStatusBoth],
  );

  const setReciter = useCallback(
    (id: string) => {
      if (id === reciterRef.current) return;
      const currentSurah = surahRef.current;
      setReciterState(id);
      reciterRef.current = id;
      // A reciter change resets timings/audio (web parity: stale-fetch guard).
      timingRef.current = null;
      modeRef.current = null;
      interpRef.current.clear();
      stopListen();
      sourceLoadedRef.current = false;
      setListenLockScreen(false, "", "");
      setTimingSource(null);
      setStatusBoth("idle");
      setAyahAndWord(1, null);
      setDownloaded(isAudioDownloaded(id, currentSurah));
      void (async () => {
        const saved = await loadLocalPosition();
        if (saved && saved.surah === currentSurah && saved.reciter === id) {
          setSavedPosition(saved);
        } else {
          setSavedPosition(null);
        }
      })();
    },
    [setAyahAndWord, setStatusBoth],
  );

  // ── One-time setup: reciters + server sync on login ───────────────────
  useEffect(() => {
    void fetchReciters().then(setReciters);
    if (syncedOnceRef.current) return;
    syncedOnceRef.current = true;
    void syncListenPositionOnLogin()
      .then((res) => {
        setOffline(res.offline);
        if (res.position) {
          setSavedPosition(res.position);
          setSpeedState(res.position.speed);
          speedRef.current = res.position.speed;
          if (res.position.repeatMode) {
            repeatModeRef.current = res.position.repeatMode;
            setRepeatModeState(res.position.repeatMode);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      clearWatchdog();
    };
  }, [clearWatchdog]);

  return {
    status,
    isPlaying: status === "playing",
    isBuffering: status === "buffering",
    reciter,
    reciters,
    setReciter,
    surah,
    surahName,
    currentAyah,
    currentWord,
    ayahCount,
    timingSource,
    error,
    errorMessage,
    progressMs,
    durationMs,
    speed,
    setSpeed,
    cycleSpeed,
    repeatMode,
    setRepeatMode,
    cycleRepeatMode,
    repeatRange,
    setRepeatRange,
    repeatAyahCount,
    setRepeatAyahCount,
    repeatRemaining,
    savedPosition,
    hasSavedPosition: savedPosition !== null,
    downloaded,
    downloading,
    downloadError,
    downloadForOffline,
    offline,
    openSurah,
    play,
    pause,
    resume: play,
    stop,
    retry,
    playAyah,
    prevAyah,
    nextAyah,
    seek,
    resumeSaved,
  };
}
