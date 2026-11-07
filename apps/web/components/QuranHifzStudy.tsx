'use client';

/**
 * QuranHifzStudy: Phase 3 (hifz) study screen, rebuilt to match the
 * Tarteel app (premium behavior).
 *
 * The study screen is a WHITE blank page in true mushaf LINE layout:
 * the 15-line Madinah page breaks come from the bundled line data
 * (lib/quran-mushaf-lines.json, QPC1 Hafs), faint ayah-end markers
 * are visible from the start at their line positions, and as the
 * memorizer recites, text is WRITTEN word-by-word in UthmanicHafs
 * font into its line slots. A word appears in black ink with its
 * tajweed letters colored (green ghunnah/ikhfaa, blue heavy raa,
 * pink madd, gray waslah — lib/quran-tajweed, only the rules
 * verified against the Tarteel reference clip); the newest word
 * just heard is GREEN when correct and RED when wrong (a tashkeel
 * error counts as wrong) until the next word arrives. A wrong word
 * is red text with a red dashed underline. Graded words use TEXT
 * colors (correct = plain ink, close = amber text, wrong = red
 * text + dashed underline, skipped = gray text) — never background
 * pills. Unwritten words occupy hidden slots (visibility:hidden) so
 * marker positions never jump as words are revealed; the page looks
 * blank until written. Ayah-end markers are ornate rosettes (own
 * SVG, like the printed mushaf), visible from the start.
 *
 * PREMIUM behavior (no freeze): on a misread, the word is marked
 * red and the flow continues — the page never freezes, and ayahs
 * the user did not recite are never written (the live matcher
 * marks a word wrong + consumes its phonemes instead of marching
 * through the surah gray). Extra words the user says are NEVER
 * written on the page; they are recorded in the error sheet.
 *
 * The page is blank on load: a previous attempt's words are NOT
 * resumed into the wall. The practice result, stats and practice
 * history are REMOVED from this page (user order). There is NO
 * end-of-session results page: tapping stop returns the mic to its
 * green circle, the timer pill disappears, and the page stays on
 * the mushaf. Errors are opened DURING the session by hand (the
 * bottom sheet): wrong words (expected vs recited) and extra words.
 *
 * Live pills above the page (during a session): error count (red),
 * accuracy % (Phase 4: green >=99 / lime >=98 / amber >=95 / red
 * <95, from the Phase 2 video evidence — the old >=95/80 guess is
 * refuted), session timer (gray, MM:SS, counts up). The header shows
 * the surah name + printed page / juz / hizb + the current
 * surah:ayah while live. The footer of the mushaf area shows the
 * printed page number (Eastern Arabic digits). The page follows the
 * heard ayah and turns automatically.
 *
 * Display modes (bottom menu, persisted): page-flip (one page),
 * scrolling (all pages of the surah, current page scrolled into
 * view), card (the page inside a framed mushaf card).
 *
 * Listen mode: the reciter's audio plays (per-surah file with real
 * word timings from the timing endpoint, or per-ayah audio with
 * interpolated timings as an honest fallback) and the current word
 * is highlighted green (#188653 + white text, like the QUL Segment
 * builder) in sync with the audio; the page's words are all visible
 * for following along and the page turns automatically.
 *
 * HONEST GAP (never present as exact glyph positions): the line
 * breaks are exact (the dataset's), but intra-line spacing is the
 * browser's justification, not the printed glyph metrics. Written
 * words sit in their true line, in order, with the true ayah-end
 * marker after them. Ayahs whose study words do not match the
 * printed segment totals, and ayahs not on the selected page,
 * render in the fallback wall below; the page never jumps
 * mid-recitation. If the line data cannot be loaded, or no page
 * covers the selected ayah, the whole wall layout returns plus
 * svgFailedNote (its text is generic: printed page unavailable).
 *
 * The reader's juz/hizb/page SVG modes are untouched. The line data
 * is always Hafs (the study text is Hafs Tanzil; other mushafs
 * number ayahs differently), so initialMushaf is intentionally
 * ignored here.
 *
 * Two grading paths:
 * - LIVE (zipformer only): browser streams 16 kHz mono PCM frames over
 *   a WebSocket (one-time ticket from POST /api/v1/auth/ws-ticket, never
 *   a JWT in the query string); the server streams back word events and
 *   the page fills LIVE. Audio is transient, never stored. Capture is
 *   AudioWorklet (lib/quran-audio.ts Resampler resamples the real
 *   hardware rate to 16 kHz mono with an anti-alias filter); the legacy
 *   ScriptProcessor path is used only when the browser has no
 *   AudioWorklet, and the UI says so explicitly. The server sends
 *   engine_ready/audio_ready/listening before any frame is sent, and
 *   every event carries the v2 envelope (session_id/event_id/
 *   sequence_no/event_type) — see lib/quran-audio.ts LiveEventStore.
 * - RECORD-THEN-GRADE (whisper_quran only): the browser records
 *   (MediaRecorder), resamples to 16 kHz mono, encodes a small WAV and
 *   POSTs it. Grading is server-side; NO Web Speech API is used.
 *   Grading audio is transient — it is never stored.
 *
 * Continue-after-skip: grading never stops at a skipped ayah; every
 * skipped word/ayah is marked gray and later ayahs still grade.
 * Peek (revealing a word) counts as a recorded mistake; Peek reveals
 * the NEXT unwritten word.
 *
 * Unauthenticated visitors see the blank page and local Peek only;
 * grading needs sign-in (honest hint, never fake saved state).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api-base';
import { authFetch, authJson, getAccessToken } from '@/lib/auth-client';
import { getSurah, type SurahSummary } from '@/lib/quran';
import {
  AudioFrameAssembler,
  LiveEventStore,
  Resampler,
  buildStartMessage,
  isFatalLiveError,
  type HifzLiveEvent,
  type LiveClientState,
  type LiveWordEvent,
} from '@/lib/quran-audio';
import { useQuranListen } from '@/lib/quran-listen';
import {
  HIFZ_SETTINGS_DEFAULTS,
  HIFZ_SETTINGS_STORAGE_KEY,
  accuracyPillClass,
  accuracyPillTone,
  clampRepeatCount,
  parseStoredHifzSettings,
  validatePracticeRange,
  type HifzUserSettings,
} from '@/lib/hifz-phase4';
import {
  HIFZ_LISTEN_LONG_PRESS_MS,
  LISTEN_SPEED_STORAGE_KEY,
  listenReciterPhotoUrl,
  parseStoredListenSpeed,
  type ListenRepeatMode,
  type ListenRepeatRange,
} from '@/lib/hifz-player';
import { HifzListenPlayer } from './HifzListenPlayer';
import { HifzRosette, MicIcon } from './hifz-study/HifzRosette';
import { HifzSettingsSheet } from './hifz-study/HifzSettingsSheet';
import { HifzNumericInput } from './HifzNumericInput';
import { HifzMutashabihat, type HifzMutashabihatLabels } from './HifzMutashabihat';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import { loadMushafLines, type MushafExactLine } from '@/lib/quran-mushaf-lines';
import {
  loadMushafV2,
  v2FirstAyahOfSurahOnPage,
  v2PageAyahs,
  v2PageIndexFor,
  type V2MushafData,
  type V2Page,
} from '@/lib/quran-mushaf-v2';
import {
  ARABIC_INDIC,
  formatArabicIndicDecimal,
  formatArabicIndicDuration,
  toArabicIndic,
} from '@/lib/quran-print-lines';
import { colorizeTajweedWord } from '@/lib/quran-tajweed';
import { rangeContaining } from '@/lib/quran-view-modes';
import { buildPageRender, buildV2PageRender, pageIndexFor } from '@/lib/hifz-page-render';
import { encodeWav } from '@/lib/hifz-wav';
import type {
  LineWordSlot,
  LineMarkerSlot,
  LineOrnamentSlot,
  LineSlot,
  RenderLine,
  HifzLabels,
  HifzWordScore,
  HifzMistake,
  HifzCounts,
  HifzAttempt,
  HifzMistakeGroupItem,
  HifzMistakeGroup,
  HifzGrade,
  HifzStatus,
  WallWord,
} from '@/lib/hifz-study-types';
// Re-exported so the single consumer (QuranReader) keeps importing it from here.
export type { HifzLabels } from '@/lib/hifz-study-types';

/** The three page display modes (bottom menu): page-flip, scrolling, card. */
type DisplayMode = 'page' | 'scroll' | 'card';
const DISPLAY_MODE_KEY = 'hifz-display-mode';
function readDisplayMode(): DisplayMode {
  try {
    const v = window.localStorage.getItem(DISPLAY_MODE_KEY);
    if (v === 'scroll' || v === 'card' || v === 'page') return v;
  } catch {
    /* storage unavailable */
  }
  return 'page';
}


/** Render one Uthmani word with its tajweed letters colored
    (lib/quran-tajweed). Uncolored letters render as plain text. */
function renderTajweedText(text: string) {
  return colorizeTajweedWord(text).map((seg, i) =>
    seg.color ? (
      <span key={i} className={`hifz-tj-${seg.color}`}>
        {seg.text}
      </span>
    ) : (
      seg.text
    ),
  );
}


const HIFZ_API = '/api/v1/quran/hifz';

export function QuranHifzStudy({
  locale,
  surahList,
  initialSurah,
  initialAyah,
  initialTexts,
  labels,
  reciterPhotos,
}: {
  locale: string;
  surahList: SurahSummary[];
  initialSurah: number;
  /** Deep-link hint (?ayah=): the ayah the session starts from.
    It is only a hint — the live session locates the recited ayah
    from the audio and the page follows it. */
  initialAyah: number | null;
  /** Ignored: the line data is always Hafs (see header). */
  initialMushaf: string;
  /** Ayah texts of the initial surah, from the server render. */
  initialTexts: Record<number, string>;
  labels: HifzLabels;
  /** Phase 5: reciter photos by AlQuran Cloud edition id (from the
      CRM providers payload, threaded through the reader) — the
      listen mini player maps its Quran.com reciter ids onto these. */
  reciterPhotos?: Record<string, string | null>;
}) {
  const [surah, setSurah] = useState(initialSurah);
  const [ayah, setAyah] = useState(initialAyah ?? 1);
  // The live-socket handler closes over the ayah from when the socket
  // was opened; the ref always holds the current selection so the page
  // can follow the heard ayah without a stale closure.
  const ayahRef = useRef(ayah);
  useEffect(() => {
    ayahRef.current = ayah;
  }, [ayah]);
  const [ayahCount, setAyahCount] = useState(0);
  const [textsBySurah, setTextsBySurah] = useState<Record<number, Record<number, string>>>(
    () =>
      initialTexts && Object.keys(initialTexts).length > 0
        ? { [initialSurah]: initialTexts }
        : {},
  );
  const [authed, setAuthed] = useState(false);
  const [attempt, setAttempt] = useState<HifzAttempt | null>(null);
  const [attemptWords, setAttemptWords] = useState<HifzWordScore[]>([]);
  const [mistakes, setMistakes] = useState<HifzMistake[]>([]);
  const [practiceWord, setPracticeWord] = useState<{
    ayah: number;
    index: number;
    text: string;
  } | null>(null);
  const [revealedLocal, setRevealedLocal] = useState<Set<string>>(new Set());
  const [recState, setRecState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [liveState, setLiveState] = useState<LiveClientState>('idle');
  /** Mirror of liveState for audio callbacks registered once. */
  const liveStateRef = useRef<LiveClientState>('idle');
  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);
  const [liveWords, setLiveWords] = useState<LiveWordEvent[]>([]);
  const [liveExtraCount, setLiveExtraCount] = useState(0);
  /** Extra words the user said (live path), for the error sheet. */
  const [liveExtraWords, setLiveExtraWords] = useState<string[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  /** Non-fatal server warning shown in the diagnostics line. */
  const [liveWarning, setLiveWarning] = useState<string | null>(null);
  /** The word the user is mid-way through (server `partial` event). */
  const [livePartial, setLivePartial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<HifzStatus | null>(null);
  /** Offline: the browser's online state (navigator.onLine + events).
      A live session cannot start or survive without a connection, so
      the page says so plainly instead of failing with a generic
      error. The ref mirrors it for the socket callbacks, which close
      over the state at start time. */
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  );
  const offlineRef = useRef(isOffline);
  useEffect(() => {
    const onOnline = () => {
      offlineRef.current = false;
      setIsOffline(false);
    };
    const onOffline = () => {
      offlineRef.current = true;
      setIsOffline(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveWsRef = useRef<WebSocket | null>(null);
  /** The v2 event store: dedup + ordering + correction for live events. */
  const liveEventStoreRef = useRef<LiveEventStore | null>(null);
  const getLiveEventStore = (): LiveEventStore => {
    if (!liveEventStoreRef.current) {
      liveEventStoreRef.current = new LiveEventStore();
    }
    return liveEventStoreRef.current;
  };
  const liveMicRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    node: AudioWorkletNode | ScriptProcessorNode;
    capture: 'worklet' | 'legacy';
    resampler: Resampler;
    assembler: AudioFrameAssembler;
    onDeviceChange: () => void;
    onVisibilityChange: () => void;
    backgroundPaused: boolean;
  } | null>(null);
  /** True while stopLive waits for the expected close after 'end'. */
  const liveStoppingRef = useRef(false);
  // A close is "expected" when the user pressed stop or the server ended
  // the session normally (final/error). Any other close means the
  // connection died mid-recitation and must surface, not hang in
  // "listening" forever (the 02:58 Railway restart did exactly that).
  const liveCloseExpectedRef = useRef(false);
  // Live diagnostics, shown while a live session runs: the ACTUAL audio
  // rate (browsers may ignore the requested 16 kHz — the Resampler
  // corrects it to 16 kHz), how many frames really left the phone, the
  // capture path (worklet/legacy), and frames dropped before readiness.
  // The visible count updates ~once a second, not per frame; the
  // counter itself is exact.
  const liveFramesRef = useRef(0);
  const liveDroppedRef = useRef(0);
  const [liveDiag, setLiveDiag] = useState<{
    sampleRate: number | null;
    frames: number;
    capture: 'worklet' | 'legacy' | null;
    dropped: number;
  }>({
    sampleRate: null,
    frames: 0,
    capture: null,
    dropped: 0,
  });
  // Generation counter for live runs: bumped at the start of every
  // startLive and on cancel. Async continuations check it after each
  // await and abort silently when a newer run superseded them, so a
  // stale run can never flip the page state or corrupt the shared
  // diagnostics (a second start once produced sampleRate '—' with
  // 300 frames from a first capture that was still alive).
  const liveRunIdRef = useRef(0);
  // True while a live run is starting or live. A second startLive
  // while this is true is a no-op — double-taps must not start two
  // captures that share liveWsRef/liveMicRef/liveDiag.
  const liveRunActiveRef = useRef(false);
  // Timeout for the 'connecting' phase: a handshake that never
  // completes (or a mic prompt that never resolves) must end on its
  // own instead of leaving the page unusable except by reload.
  const liveConnectTimeoutRef = useRef<number | null>(null);
  const clearLiveConnectTimeout = useCallback(() => {
    if (liveConnectTimeoutRef.current !== null) {
      window.clearTimeout(liveConnectTimeoutRef.current);
      liveConnectTimeoutRef.current = null;
    }
  }, []);
  // Line page: the bundled 15-line Madinah page of the SELECTED
  // ayah (undefined = loading, null = load failed). The page follows
  // the heard ayah while a live session runs: when the matcher
  // locates or advances to another ayah, the selection moves with it
  // (see the socket handler) so the heard words land on the page,
  // not in the wall below.
  const [mushafPages, setMushafPages] = useState<MushafExactLine[][] | null | undefined>(
    undefined,
  );

  // --- Tarteel rebuild state ---
  // Session timer (seconds): starts when a live session starts,
  // counts up, resets and hides when the session ends.
  const [sessionSeconds, setSessionSeconds] = useState(0);
  // Error sheet (bottom sheet with wrong + extra words).
  const [errorSheetOpen, setErrorSheetOpen] = useState(false);
  // Page display mode: page-flip (one page), scrolling (all pages
  // of the surah), or card (framed mushaf card). Persisted.
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => readDisplayMode());
  // Study mode: practice (recite, Tarteel hifz) or listen (follow
  // the reciter's audio with word-by-word highlight).
  const [studyMode, setStudyMode] = useState<'practice' | 'listen'>('practice');

  // --- Phase 4 (hifz redesign) state ---
  // Per-user settings (freeze/mistake detection/resume/markers).
  // Authed: the server is the source of truth; guest: localStorage.
  const [hifzSettings, setHifzSettings] = useState<HifzUserSettings>(() => {
    if (typeof window === 'undefined') return { ...HIFZ_SETTINGS_DEFAULTS };
    try {
      return parseStoredHifzSettings(window.localStorage.getItem(HIFZ_SETTINGS_STORAGE_KEY));
    } catch {
      return { ...HIFZ_SETTINGS_DEFAULTS };
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Phase-1 hifz fix: the session-setup form (surah/ayah picker,
  // range + repetition, listen controls) is a collapsible panel,
  // CLOSED by default, so the mushaf is the first visible element
  // on load and line 1 is in the viewport. The panel opens on
  // demand (and automatically when a range validation error must
  // be shown — see ensureAttempt).
  const [setupOpen, setSetupOpen] = useState(false);
  // Surah-header SVGs that failed to load (fall back to the
  // plain-text header for those surahs, like the reader's V2 page).
  const [failedStudyHeaders, setFailedStudyHeaders] = useState<ReadonlySet<number>>(new Set());
  // Freeze hold: freeze_on_error is ON and the newest live word was
  // wrong — capture is paused until the user corrects it and taps
  // «continue». Default OFF = premium behaviour (never freezes).
  const [freezeHold, setFreezeHold] = useState(false);
  // Hide the script (crossed-eye): written words become hidden
  // slots; tapping a hidden word reveals just that word (gradual
  // reveal); «show all» re-reveals. Unread ayahs are hidden by
  // default already; previously-read ayahs stay visible unless the
  // user hides them here on purpose.
  const [scriptHidden, setScriptHidden] = useState(false);
  const [revealedWords, setRevealedWords] = useState<Set<string>>(new Set());
  // Practice range + repetition (one surah; null end = surah end).
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [repeatAyah, setRepeatAyah] = useState(1);
  const [repeatRange, setRepeatRange] = useState(1);
  const [rangeError, setRangeError] = useState<'rangeStart' | 'rangeEnd' | 'rangeOrder' | null>(null);
  // Resume: the latest open server-side session, if any.
  const [resumeCandidate, setResumeCandidate] = useState<HifzAttempt | null>(null);
  // Resume target ayah: when the user continues an unfinished
  // session in another surah, the surah-change effect must land on
  // the stored ayah, not restart at ayah 1.
  const resumeAyahRef = useRef<number | null>(null);
  // Grouped mistake sheet (server-side, Phase 4 endpoint).
  const [groupedMistakes, setGroupedMistakes] = useState<HifzMistakeGroup[] | null>(null);
  const [listenReciter, setListenReciter] = useState('alafasy');
  // The ayah/word the reciter is currently on (listen mode).
  const [listenAyah, setListenAyah] = useState(1);
  const [listenWord, setListenWord] = useState<number | null>(null);
  // Per-ayah audio URLs (site's active reciter) for the interpolated
  // listen fallback.
  const [ayahAudioUrls, setAyahAudioUrls] = useState<Record<number, string | null>>({});
  // Juz/hizb/page boundaries for the header (loaded once).
  const [boundaries, setBoundaries] = useState<Awaited<
    ReturnType<typeof loadBoundaries>
  > | null>(null);
  const listenAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setAuthed(Boolean(getAccessToken()));
    fetch(`${apiBaseUrl()}${HIFZ_API}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: HifzStatus | null) => setEngineStatus(j))
      .catch(() => {});
  }, []);

  // Phase 4 — per-user settings: authed users load them from the
  // server (and keep a local copy for guests); a guest keeps only
  // the local copy. A failed server load keeps the local values —
  // settings must never block the page.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    void (async () => {
      try {
        const server = await authJson<{
          freeze_on_error: boolean;
          mistake_detection: boolean;
          tashkeel_detection: boolean;
          resumable_sessions: boolean;
          hide_ayah_markers: boolean;
        }>(`${HIFZ_API}/settings`);
        if (cancelled) return;
        const next: HifzUserSettings = {
          freezeOnError: server.freeze_on_error,
          mistakeDetection: server.mistake_detection,
          tashkeelDetection: server.tashkeel_detection,
          resumableSessions: server.resumable_sessions,
          hideAyahMarkers: server.hide_ayah_markers,
        };
        setHifzSettings(next);
        try {
          window.localStorage.setItem(HIFZ_SETTINGS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
      } catch {
        /* keep the local copy */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  // Phase 4 — resume: when resumable sessions are ON, offer the
  // latest open session instead of silently starting a new one.
  useEffect(() => {
    if (!authed || !hifzSettings.resumableSessions) {
      setResumeCandidate(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const found = await authJson<HifzAttempt | null>(`${HIFZ_API}/attempts/resume`);
        if (!cancelled) setResumeCandidate(found);
      } catch {
        if (!cancelled) setResumeCandidate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, hifzSettings.resumableSessions]);

  // Phase 4 — save settings (server when authed, always local).
  const saveHifzSettings = useCallback(
    async (next: HifzUserSettings) => {
      setHifzSettings(next);
      try {
        window.localStorage.setItem(HIFZ_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      if (!authed) return;
      try {
        await authJson(`${HIFZ_API}/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            freeze_on_error: next.freezeOnError,
            mistake_detection: next.mistakeDetection,
            tashkeel_detection: next.tashkeelDetection,
            resumable_sessions: next.resumableSessions,
            hide_ayah_markers: next.hideAyahMarkers,
          }),
        });
      } catch {
        setError(labels.errorGeneric);
      }
    },
    [authed, labels.errorGeneric],
  );

  // Phase 4 — persist the live position (throttled to one call per
  // 10s): the server keeps the last followed surah:ayah:word, so a
  // session resumes from the same place after leaving the app. A
  // failed save is silent — the local page state is unaffected.
  const lastPositionSentRef = useRef(0);
  useEffect(() => {
    if (!authed || !attempt || liveState !== 'listening') return;
    const now = Date.now();
    if (now - lastPositionSentRef.current < 10000) return;
    lastPositionSentRef.current = now;
    const wordIndex =
      liveWords.length > 0 ? liveWords[liveWords.length - 1].word_index : 0;
    void authJson(`${HIFZ_API}/attempts/${attempt.id}/position`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_surah: surah,
        current_ayah: ayah,
        current_word_index: wordIndex,
      }),
    }).catch(() => {});
  }, [ayah, liveWords, liveState, attempt, authed, surah]);

  // Phase 4 — grouped mistake sheet: when the sheet opens, load
  // the server-side groups (one card per ayah, wrong vs extra).
  // A failed load falls back to the local live/graded words below.
  useEffect(() => {
    if (!errorSheetOpen) {
      setGroupedMistakes(null);
      return;
    }
    if (!authed || !attempt) return;
    let cancelled = false;
    void (async () => {
      try {
        const groups = await authJson<HifzMistakeGroup[]>(
          `${HIFZ_API}/attempts/${attempt.id}/mistakes`,
        );
        if (!cancelled) setGroupedMistakes(groups);
      } catch {
        if (!cancelled) setGroupedMistakes(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [errorSheetOpen, authed, attempt]);

  // Surah change: load its ayah texts (public) and restart at ayah 1.
  // The line page cannot place words without these texts: while they
  // load, the page waits instead of silently dropping every ayah to
  // the wall below. A failed load shows a retry instead of the wall.
  // Texts for the initial surah arrive with the server render, so the
  // first page never depends on a client fetch. A fetch that fails is
  // retried twice: the phone is often on a flaky VPN and one dropped
  // request must not strand the page.
  // The initial ayah comes from the ?ayah= hint (state init above),
  // so the seeded branch must NOT reset it to 1; only a real surah
  // change restarts at ayah 1.
  const initialTextsRef = useRef(initialTexts);
  const [textsFailed, setTextsFailed] = useState(false);
  const [textsReload, setTextsReload] = useState(0);
  useEffect(() => {
    const seeded = initialTextsRef.current;
    if (surah === initialSurah && seeded && Object.keys(seeded).length > 0) {
      setAyahCount(Object.keys(seeded).length);
      setPracticeWord(null);
      // The texts are seeded, but the per-ayah audio URLs (listen
      // fallback) are not: fetch them in the background without
      // blocking the page.
      void (async () => {
        try {
          const view = await getSurah(surah);
          const audioUrls: Record<number, string | null> = {};
          for (const a of view.ayahs) audioUrls[a.number] = a.audioUrl ?? null;
          setAyahAudioUrls(audioUrls);
        } catch {
          /* listen fallback just stays unavailable */
        }
      })();
      return;
    }
    let cancelled = false;
    setTextsFailed(false);
    void (async () => {
      for (let attemptNo = 0; attemptNo < 3; attemptNo++) {
        if (cancelled) return;
        try {
          const view = await getSurah(surah);
          if (cancelled) return;
          const texts: Record<number, string> = {};
          const audioUrls: Record<number, string | null> = {};
          for (const a of view.ayahs) {
            texts[a.number] = a.text;
            audioUrls[a.number] = a.audioUrl ?? null;
          }
          setTextsBySurah((prev) => ({ ...prev, [surah]: texts }));
          setAyahAudioUrls(audioUrls);
          setAyahCount(view.ayahs.length);
          return;
        } catch {
          if (cancelled) return;
          if (attemptNo < 2) await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) setTextsFailed(true);
    })();
    setAyah(resumeAyahRef.current !== null ? resumeAyahRef.current : 1);
    resumeAyahRef.current = null;
    setPracticeWord(null);
    return () => {
      cancelled = true;
    };
  }, [surah, textsReload]);

  const refreshDetail = useCallback(async (attemptId: string) => {
    const detail = await authJson<{
      attempt: HifzAttempt;
      words: HifzWordScore[];
      mistakes: HifzMistake[];
    }>(`${HIFZ_API}/attempts/${attemptId}`);
    setAttempt(detail.attempt);
    setAttemptWords(detail.words);
    setMistakes(detail.mistakes);
  }, []);

  // The blank page: a returning student does NOT see a previous
  // attempt's words on mount (Tarteel: the page is blank until the
  // student recites). Grades from a finished session still arrive
  // through refreshDetail after grading, but nothing is resumed
  // into the wall on load.

  // Stop the live stream when leaving the screen.
  useEffect(
    () => () => {
      liveCloseExpectedRef.current = true;
      liveRunActiveRef.current = false;
      clearLiveConnectTimeout();
      liveWsRef.current?.close();
      const mic = liveMicRef.current;
      if (mic) {
        try {
          mic.node.disconnect();
        } catch {
          /* already disconnected */
        }
        navigator.mediaDevices.removeEventListener(
          'devicechange',
          mic.onDeviceChange,
        );
        document.removeEventListener(
          'visibilitychange',
          mic.onVisibilityChange,
        );
        mic.stream.getTracks().forEach((t) => t.stop());
        void mic.ctx.close();
      }
    },
    [clearLiveConnectTimeout],
  );

  // Phase 3 (hifz redesign): the real V2 mushaf data loads once
  // (fetch from public/, preloaded from the page head on the hifz
  // tab — lib/quran-mushaf-v2). While it loads the page waits; if it
  // fails (null) the old lines render (see the fallback-only loads
  // after surahPageIndices below).
  const [v2Data, setV2Data] = useState<V2MushafData | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadMushafV2().then((data) => {
      if (!cancelled) setV2Data(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Session timer: counts up once a second while a live session is
  // listening; resets when the session ends (the pill disappears).
  // A paused session holds its time: the interval only runs while
  // listening, so a pause neither counts nor resets the timer.
  useEffect(() => {
    if (liveState !== 'listening') {
      if (liveState === 'idle') setSessionSeconds(0);
      return;
    }
    const id = window.setInterval(() => setSessionSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [liveState]);

  // Start ayah (academy feature): the selected ayah is where a
  // session starts, and the address bar follows it (?ayah=), so a
  // shared link opens the same start ayah. replaceState keeps the
  // back button clean — moving the ayah is not navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('ayah', String(ayah));
    const next = `${window.location.pathname}?${params.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [ayah, surah]);

  // Listen/follow mode: the reciter's audio + word-by-word highlight.
  // The callbacks move the page to the reciter's ayah and mark the
  // current word; the hook owns the audio clock and the timing fetch.
  // Phase 5: the persisted speed starts the session (Tarteel range
  // 0.5×–1.75×); the ayah/range repeat counts come from the Phase 4
  // inputs above (no duplicate repeat UI); the range bounds come
  // from the same Phase 4 range inputs.
  const [listenSpeedInit] = useState(() =>
    typeof window === 'undefined'
      ? 1
      : parseStoredListenSpeed(window.localStorage.getItem(LISTEN_SPEED_STORAGE_KEY)),
  );
  const listenRepeatRange: ListenRepeatRange | null = useMemo(() => {
    if (ayahCount <= 0) return null;
    const start = rangeStart ?? 1;
    const end = rangeEnd ?? ayahCount;
    if (start < 1 || end > ayahCount || start > end) return null;
    return { start, end, count: clampRepeatCount(repeatRange) };
  }, [rangeStart, rangeEnd, repeatRange, ayahCount]);
  const listen = useQuranListen({
    reciter: listenReciter,
    surah,
    ayahTexts: textsBySurah[surah] ?? {},
    ayahAudioUrls,
    ayahCount,
    audioRef: listenAudioRef,
    repeatAyahCount: repeatAyah,
    repeatRange: listenRepeatRange,
    initialSpeed: listenSpeedInit,
    onAyahChange: useCallback((a: number) => {
      setListenAyah(a);
      if (a !== ayahRef.current) setAyah(a);
    }, []),
    onWordChange: useCallback((_a: number, w: number | null) => {
      setListenWord(w);
    }, []),
  });

  // ---- The wall: every written word, grouped by ayah, in order. ----
  // Server scores first; live words overlay them (they are the newest
  // grades until finish() + refreshDetail merge them into the attempt);
  // peeked words (server mistakes or local reveals) show as peeked.
  // Unwritten words are NEVER shown — that is the blank page.
  const wallAyahs = useMemo(() => {
    const byKey = new Map<string, WallWord>();
    for (const w of attemptWords) {
      if (w.surah !== surah) continue;
      byKey.set(`${w.ayah}:${w.word_index}`, {
        ayah: w.ayah,
        index: w.word_index,
        text: w.expected_text,
        status: w.status,
        prob: w.prob,
        heard: w.heard,
        scoreId: w.id,
        disputed: w.disputed,
        live: false,
      });
    }
    for (const w of liveWords) {
      if (w.surah !== surah) continue;
      byKey.set(`${w.ayah}:${w.word_index}`, {
        ayah: w.ayah,
        index: w.word_index,
        text: w.expected,
        status: w.status,
        prob: w.prob,
        heard: w.heard,
        scoreId: byKey.get(`${w.ayah}:${w.word_index}`)?.scoreId ?? null,
        disputed: false,
        live: true,
      });
    }
    const peekedKeys = new Set<string>();
    for (const m of mistakes) {
      if (m.surah !== surah || m.mistake_type !== 'peek' || m.word_index === null) continue;
      const key = `${m.ayah}:${m.word_index}`;
      peekedKeys.add(key);
      if (!byKey.has(key)) {
        const text = textsBySurah[surah]?.[m.ayah]?.split(/\s+/).filter(Boolean)[m.word_index];
        if (text) {
          byKey.set(key, {
            ayah: m.ayah,
            index: m.word_index,
            text,
            status: 'peeked',
            prob: 0,
            heard: null,
            scoreId: null,
            disputed: false,
            live: false,
          });
        }
      }
    }
    for (const key of revealedLocal) {
      const [s, a, i] = key.split(':').map(Number);
      if (s !== surah) continue;
      if (!byKey.has(`${a}:${i}`)) {
        const text = textsBySurah[surah]?.[a]?.split(/\s+/).filter(Boolean)[i];
        if (text) {
          byKey.set(`${a}:${i}`, {
            ayah: a,
            index: i,
            text,
            status: 'peeked',
            prob: 0,
            heard: null,
            scoreId: null,
            disputed: false,
            live: false,
          });
        }
      }
    }
    const grouped = new Map<number, WallWord[]>();
    for (const w of byKey.values()) {
      const list = grouped.get(w.ayah) ?? [];
      list.push(w);
      grouped.set(w.ayah, list);
    }
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ayahNum, words]) => ({
        ayah: ayahNum,
        words: words.sort((a, b) => a.index - b.index),
      }));
  }, [attemptWords, liveWords, mistakes, revealedLocal, surah, textsBySurah]);

  const wallKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of wallAyahs) {
      for (const w of group.words) keys.add(`${group.ayah}:${w.index}`);
    }
    return keys;
  }, [wallAyahs]);

  // The line page of the SELECTED ayah, and whether it is ready.
  // pageFailed covers both a failed line-data load and a selected
  // ayah no page covers: either way the wall below shows everything.
  const pageIndex = useMemo(
    () => (mushafPages ? pageIndexFor(mushafPages, surah, ayah) : null),
    [mushafPages, surah, ayah],
  );
  const pageLines = pageIndex === null ? null : (mushafPages?.[pageIndex] ?? null);
  // Phase 3 (hifz redesign): the V2 page index. The V2 layout and
  // the old lines disagree on 25 page starts, so the study page
  // navigates by the V2 index while V2 data is loaded; the old index
  // stays for the fallback when the V2 load fails.
  const useV2 = v2Data !== undefined && v2Data !== null;
  const v2PageIndex = useMemo(
    () => (v2Data ? v2PageIndexFor(v2Data.pages, surah, ayah) : null),
    [v2Data, surah, ayah],
  );
  const activePageIndex = useV2 ? v2PageIndex : pageIndex;
  const activeV2Page =
    useV2 && v2PageIndex !== null ? (v2Data?.pages[v2PageIndex] ?? null) : null;
  const pageReady = useV2 ? activeV2Page !== null : pageLines !== null;
  const pageFailed = mushafPages !== undefined && v2Data !== undefined && !pageReady;
  // Surah texts settled (loaded, or failed): only then may the wall
  // claim an ayah is unplaced. While they still load, placedAyahs is
  // empty by construction and the wall would wrongly swallow the
  // whole surah, so both the page and the wall wait.
  const textsReady = textsBySurah[surah] !== undefined;
  const textsSettled = textsReady || textsFailed;

  // The current page's render lines (placed ayahs + line slots),
  // built by the pure buildPageRender helper. Scroll mode calls the
  // same helper for every page of the surah. Phase 3: the V2 page
  // renders first (buildV2PageRender); a null result falls back to
  // the old lines for the same page, never a half-mixed page.
  const pageRender = useMemo(() => {
    if (useV2 && activeV2Page && v2Data) {
      const v2 = buildV2PageRender(v2Data, activeV2Page, surah, textsBySurah, wallAyahs);
      // usedV2 drives the fallback-only old-lines load below: when
      // the V2 expansion of the current page fails, the old lines
      // are needed after all (neighbor texts missing, or a genuine
      // layout mismatch) — never a half-mixed page.
      if (v2) return { ...v2, usedV2: true };
    }
    const fallback = pageLines
      ? buildPageRender(pageLines, surah, textsBySurah[surah], wallAyahs)
      : {
          placedAyahs: new Set<number>(),
          basmalaSplit: false,
          renderLines: [] as RenderLine[],
        };
    return { ...fallback, usedV2: false };
  }, [useV2, activeV2Page, v2Data, pageLines, textsBySurah, surah, wallAyahs]);
  const { placedAyahs, renderLines, usedV2 } = pageRender;

  // Phase 3: a V2 page spanning a surah boundary needs the neighbor
  // surah's texts too (the study surah alone is not enough). Load
  // them into the same cache; until they arrive the page renders
  // from the old lines, then switches to V2. In scroll mode the
  // first/last pages can also span into the adjacent surahs, so
  // those load too. A failed neighbor load just keeps the old-lines
  // rendering — never a broken page.
  useEffect(() => {
    if (!v2Data || !activeV2Page) return;
    const needed = new Set(v2PageAyahs(activeV2Page).map((r) => Number(r.split(':')[0])));
    if (displayMode === 'scroll') {
      if (surah > 1) needed.add(surah - 1);
      if (surah < 114) needed.add(surah + 1);
    }
    const missing = [...needed].filter((s) => s !== surah && textsBySurah[s] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const s of missing) {
        if (cancelled) return;
        try {
          const view = await getSurah(s);
          if (cancelled) return;
          const texts: Record<number, string> = {};
          for (const a of view.ayahs) texts[a.number] = a.text;
          setTextsBySurah((prev) => ({ ...prev, [s]: texts }));
        } catch {
          /* neighbor stays missing: the old-lines fallback renders */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [v2Data, activeV2Page, displayMode, surah, textsBySurah]);

  // Written ayahs not placed on this page render in the wall below.
  const unplacedGroups = useMemo(
    () => wallAyahs.filter((g) => !placedAyahs.has(g.ayah)),
    [wallAyahs, placedAyahs],
  );

  // Next unwritten word, scanning from the selected ayah onward.
  const peekTarget = useMemo(() => {
    const texts = textsBySurah[surah];
    if (!texts) return null;
    for (let a = ayah; a <= ayahCount; a += 1) {
      const words = (texts[a] ?? '').split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += 1) {
        if (!wallKeys.has(`${a}:${i}`)) return { ayah: a, index: i, text: words[i] };
      }
    }
    return null;
  }, [textsBySurah, surah, ayah, ayahCount, wallKeys]);

  const ensureAttempt = useCallback(async (): Promise<string | null> => {
    // An attempt belongs to one surah: a stale attempt from another
    // surah must not receive this surah's grades (that is how one
    // Fatiha attempt accumulated skipped=1149 from long surahs).
    if (attempt && attempt.surah === surah) return attempt.id;
    // Phase 4 — practice range: the attempt carries the range and
    // the repeat counts; an invalid range stops the start, loudly.
    const rangeProblem =
      ayahCount > 0 ? validatePracticeRange(rangeStart, rangeEnd, ayahCount) : null;
    if (rangeProblem) {
      setRangeError(rangeProblem);
      // The range inputs live inside the (closed-by-default) setup
      // panel: open it so the error is visible instead of hidden.
      setSetupOpen(true);
      return null;
    }
    setRangeError(null);
    try {
      const created = await authJson<HifzAttempt>(`${HIFZ_API}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surah,
          page: null,
          start_ayah: rangeStart ?? ayah,
          end_ayah: rangeEnd,
          repeat_ayah: clampRepeatCount(repeatAyah),
          repeat_range: clampRepeatCount(repeatRange),
        }),
      });
      setAttempt(created);
      return created.id;
    } catch {
      setError(labels.noAttemptHint);
      return null;
    }
  }, [attempt, labels.noAttemptHint, surah, ayah, ayahCount, rangeStart, rangeEnd, repeatAyah, repeatRange]);

  const startRecording = useCallback(async () => {
    if (!authed) {
      setError(labels.signInHint);
      return;
    }
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? labels.micDenied
          : labels.errorGeneric,
      );
      return;
    }
    try {
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void (async () => {
          setRecState('processing');
          try {
            const blob = new Blob(chunksRef.current, { type: rec.mimeType });
            const ctx = new AudioContext();
            const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
            await ctx.close();
            const offline = new OfflineAudioContext(
              1,
              Math.ceil((decoded.duration * 16000) / 1),
              16000,
            );
            const src = offline.createBufferSource();
            src.buffer = decoded;
            src.connect(offline.destination);
            src.start();
            const rendered = await offline.startRendering();
            const wav = encodeWav(rendered.getChannelData(0), 16000);
            const attemptId = await ensureAttempt();
            if (!attemptId) {
              setRecState('idle');
              return;
            }
            const gradeAyah = practiceWord?.ayah ?? ayah;
            const form = new FormData();
            form.append('surah', String(surah));
            form.append('ayah', String(gradeAyah));
            form.append('audio', wav, 'rec.wav');
            const endpoint =
              practiceWord !== null
                ? `${HIFZ_API}/attempts/${attemptId}/grade-word`
                : `${HIFZ_API}/attempts/${attemptId}/grade`;
            if (practiceWord !== null) {
              form.append('word_index', String(practiceWord.index));
            }
            const res = await authFetch(endpoint, { method: 'POST', body: form });
            if (!res.ok) {
              let message = labels.errorGeneric;
              try {
                const j = (await res.clone().json()) as {
                  error?: { message?: string };
                };
                if (j?.error?.message) message = j.error.message;
              } catch {
                /* keep generic */
              }
              setError(res.status === 503 ? labels.engineUnavailable : message);
              setRecState('idle');
              return;
            }
            const grade = (await res.json()) as HifzGrade;
            if (grade.extra_words.length > 0) {
              setLiveExtraWords((prev) => [...prev, ...grade.extra_words]);
            }
            await refreshDetail(attemptId);
            setPracticeWord(null);
            setRecState('idle');
          } catch {
            setError(labels.errorGeneric);
            setRecState('idle');
          }
        })();
      };
      mediaRef.current = rec;
      rec.start();
      setRecState('recording');
    } catch {
      setError(labels.errorGeneric);
    }
  }, [
    authed,
    labels,
    ensureAttempt,
    practiceWord,
    refreshDetail,
    ayah,
    surah,
  ]);

  const stopRecording = useCallback(() => {
    mediaRef.current?.stop();
  }, []);

  const cleanupLiveMic = useCallback(() => {
    const mic = liveMicRef.current;
    if (mic) {
      try {
        mic.node.disconnect();
      } catch {
        /* already disconnected */
      }
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        mic.onDeviceChange,
      );
      document.removeEventListener('visibilitychange', mic.onVisibilityChange);
      mic.stream.getTracks().forEach((t) => t.stop());
      void mic.ctx.close().catch(() => {
        /* already closed */
      });
      liveMicRef.current = null;
    }
  }, []);

  /**
   * One captured mono chunk (any hardware rate) → resampled 16 kHz
   * frames → socket. Frames are sent ONLY while listening: the
   * AudioContext stays suspended until the server's `listening`
   * event, so no frame can arrive before readiness. Anything that
   * arrives early is counted (not silently sent).
   */
  const handleLiveAudioChunk = useCallback(
    (samples: Float32Array, ws: WebSocket) => {
      const mic = liveMicRef.current;
      if (!mic) return;
      if (ws.readyState !== WebSocket.OPEN || liveStateRef.current !== 'listening') {
        liveDroppedRef.current += 1;
        return;
      }
      const resampled = mic.resampler.push(samples, 1);
      const frames = mic.assembler.push(resampled);
      for (const frame of frames) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
        liveFramesRef.current += 1;
        // Throttle the visible counter to ~once a second (4096-sample
        // frames arrive ~4x/s at 16 kHz); the counter itself is exact.
        if (liveFramesRef.current % 4 === 0) {
          setLiveDiag((prev) => ({ ...prev, frames: liveFramesRef.current }));
        }
      }
    },
    [],
  );

  const cancelLive = useCallback(
    (showMessage: boolean) => {
      // Abandon a live run that never reached 'listening' (stuck
      // handshake, hung mic prompt, timed out). Unlike stopLive,
      // nothing is saved: the server stores nothing for a close
      // without 'end', so there is no 'end' to send — just close.
      // Bumping the run id makes any in-flight startLive continuation
      // abort silently instead of reviving the dead run.
      liveRunIdRef.current += 1;
      liveRunActiveRef.current = false;
      liveStoppingRef.current = false;
      clearLiveConnectTimeout();
      liveCloseExpectedRef.current = true;
      const ws = liveWsRef.current;
      liveWsRef.current = null;
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      cleanupLiveMic();
      setLiveWarning(null);
      setLivePartial(null);
      if (showMessage) setLiveError(labels.liveDisconnected);
      setLiveState('idle');
    },
    [clearLiveConnectTimeout, cleanupLiveMic, labels],
  );

  const startLive = useCallback(async () => {
    if (!authed) {
      setError(labels.signInHint);
      return;
    }
    // A run is already starting or live — ignore the second call.
    if (liveRunActiveRef.current) return;
    liveRunActiveRef.current = true;
    const runId = (liveRunIdRef.current += 1);
    const isCurrent = () => liveRunIdRef.current === runId;
    const attemptId = await ensureAttempt();
    // A cancel superseded this run while it waited: abort silently.
    // The newer run (or the idle page) owns the shared refs now.
    if (!isCurrent()) return;
    if (!attemptId) {
      liveRunActiveRef.current = false;
      return;
    }
    setLiveError(null);
    setLiveWarning(null);
    setLivePartial(null);
    // A new session starts blank: the previous session's words,
    // errors and timer are cleared (Tarteel resets the stats to 0
    // when the mic is tapped).
    setLiveWords([]);
    setLiveExtraCount(0);
    setLiveExtraWords([]);
    setSessionSeconds(0);
    getLiveEventStore().reset(null);
    liveCloseExpectedRef.current = false;
    liveFramesRef.current = 0;
    liveDroppedRef.current = 0;
    setLiveDiag({ sampleRate: null, frames: 0, capture: null, dropped: 0 });
    // 15s from the start: on expiry, abort exactly like a manual
    // cancel and say the connection was lost. The timer is cleared
    // only on the server's `listening` event — not on socket open —
    // because the engine (73 MB model) may still be loading then.
    liveConnectTimeoutRef.current = window.setTimeout(() => cancelLive(true), 15000);
    try {
      // 1. Microphone first: the permission prompt belongs to
      // `requesting_permission`, and a denied mic must not waste a
      // ticket or a socket. A denied mic gets its own message —
      // the generic error hides the fix (allow the mic in the
      // browser settings).
      setLiveState('requesting_permission');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1 },
        });
      } catch (err) {
        if (!isCurrent()) return;
        liveCloseExpectedRef.current = true;
        liveRunActiveRef.current = false;
        clearLiveConnectTimeout();
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? labels.micDenied
            : labels.errorGeneric,
        );
        setLiveState('idle');
        return;
      }
      if (!isCurrent()) {
        // Cancelled while the mic prompt was open: stop the tracks we
        // just acquired, then leave quietly — the mic must not stay on.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      // The model's native rate is 16 kHz mono. The requested rate
      // is only a hint — the ACTUAL rate is read from the context and
      // the Resampler really resamples to 16 kHz (windowed-sinc +
      // anti-alias), so a 48 kHz phone no longer feeds 3x-speed audio
      // to the model. Frames go out as Int16LE over the socket and
      // are never stored anywhere.
      const ctx = new AudioContext({ sampleRate: 16000 });
      // Record the ACTUAL rate: browsers may ignore the requested
      // 16 kHz (phones often run 48 kHz). The Resampler corrects it;
      // the diagnostic line shows the real hardware rate.
      const resampler = new Resampler(ctx.sampleRate);
      const assembler = new AudioFrameAssembler();
      setLiveDiag((prev) => ({
        ...prev,
        sampleRate: ctx.sampleRate,
        frames: 0,
      }));
      // The context starts SUSPENDED: no frame is captured before
      // the server's `listening` event resumes it (R-02).
      await ctx.suspend();
      const src = ctx.createMediaStreamSource(stream);
      // Device change / permission revoke / unplug: the run stops
      // cleanly with a clear message — it never keeps a dead mic.
      const onDeviceChange = () => {
        if (!isCurrent()) return;
        liveCloseExpectedRef.current = true;
        liveRunActiveRef.current = false;
        clearLiveConnectTimeout();
        try {
          liveWsRef.current?.close();
        } catch {
          /* already closed */
        }
        liveWsRef.current = null;
        cleanupLiveMic();
        setLiveError(labels.liveDeviceChanged);
        setLiveState('idle');
      };
      // Background transition: pause capture while hidden (the
      // browser would throttle it anyway); resume on return.
      const micState: { backgroundPaused: boolean } = { backgroundPaused: false };
      const onVisibilityChange = () => {
        const mic = liveMicRef.current;
        if (!mic) return;
        if (document.hidden) {
          if (liveStateRef.current === 'listening') {
            micState.backgroundPaused = true;
            void mic.ctx.suspend();
          }
        } else if (micState.backgroundPaused) {
          micState.backgroundPaused = false;
          if (liveStateRef.current === 'listening') {
            void mic.ctx.resume();
          }
        }
      };
      for (const track of stream.getAudioTracks()) {
        track.onended = onDeviceChange;
      }
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      document.addEventListener('visibilitychange', onVisibilityChange);
      // The socket is looked up live (not closed over): a newer run
      // owns liveWsRef by the time any frame arrives.
      const sendChunk = (samples: Float32Array) => {
        const sock = liveWsRef.current;
        if (sock) handleLiveAudioChunk(samples, sock);
      };
      let node: AudioWorkletNode | ScriptProcessorNode;
      let capture: 'worklet' | 'legacy';
      try {
        await ctx.audioWorklet.addModule(
          '/worklets/quran-capture-processor.js',
        );
        const worklet = new AudioWorkletNode(ctx, 'quran-capture-processor');
        worklet.port.onmessage = (e: MessageEvent) => {
          const data = e.data as { type?: string; samples?: Float32Array };
          if (data?.type === 'chunk' && data.samples) {
            sendChunk(data.samples);
          }
        };
        node = worklet;
        capture = 'worklet';
      } catch {
        // EXPLICIT legacy fallback (not hidden): old browsers without
        // AudioWorklet still capture — through the SAME Resampler, so
        // the rate is still corrected — and the UI says so.
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (e: AudioProcessingEvent) => {
          const input = e.inputBuffer;
          const channels = input.numberOfChannels;
          const frames = input.length;
          const mono = new Float32Array(frames);
          for (let i = 0; i < frames; i += 1) {
            let s = 0;
            for (let c = 0; c < channels; c += 1) {
              s += input.getChannelData(c)[i];
            }
            mono[i] = s / channels;
          }
          sendChunk(mono);
        };
        node = proc;
        capture = 'legacy';
      }
      src.connect(node);
      if (capture === 'legacy') {
        // ScriptProcessor needs the destination connection to run.
        node.connect(ctx.destination);
      }
      setLiveDiag((prev) => ({ ...prev, capture }));
      liveMicRef.current = {
        stream,
        ctx,
        node,
        capture,
        resampler,
        assembler,
        onDeviceChange,
        onVisibilityChange,
        backgroundPaused: false,
      };
      // 2. Socket + start. Readiness is NOT socket open: the server
      // still has to build the recognizer. Listening starts only on
      // the server's `listening` event.
      setLiveState('connecting');
      const ticketRes = await authFetch('/api/v1/auth/ws-ticket', { method: 'POST' });
      if (!isCurrent()) return;
      if (!ticketRes.ok) throw new Error('ticket');
      const { ticket } = (await ticketRes.json()) as { ticket: string };
      const base = apiBaseUrl();
      const wsBase = /^https?:/i.test(base)
        ? base.replace(/^http/i, 'ws')
        : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${base}`;
      const ws = new WebSocket(
        `${wsBase}${HIFZ_API}/attempts/${attemptId}/stream?ticket=${encodeURIComponent(ticket)}`,
      );
      liveWsRef.current = ws;
      ws.onopen = () => {
        if (!isCurrent()) return;
        ws.send(JSON.stringify(buildStartMessage(surah, ayah)));
      };
      ws.onmessage = (ev: MessageEvent) => {
        let msg: HifzLiveEvent;
        try {
          msg = JSON.parse(ev.data as string) as HifzLiveEvent;
        } catch {
          return;
        }
        if (!isCurrent()) return;
        const store = getLiveEventStore();
        const eventType = msg.event_type ?? msg.type ?? '';
        if (eventType === 'session_started') {
          store.reset(
            typeof msg.session_id === 'string' ? msg.session_id : null,
          );
          setLiveState('engine_loading');
          return;
        }
        if (eventType === 'engine_ready' || eventType === 'audio_ready') {
          // The engine is built and warmed up; the audio path is
          // ready. Listening still waits for `listening`.
          setLiveState('engine_loading');
          return;
        }
        if (eventType === 'listening') {
          clearLiveConnectTimeout();
          // Set the ref synchronously: the resumed context starts
          // posting chunks immediately, before the re-render syncs it.
          liveStateRef.current = 'listening';
          setLiveState('listening');
          // Capture starts now — not before: the context was
          // suspended since it was built, so no frame could arrive
          // before readiness.
          const mic = liveMicRef.current;
          if (mic) {
            void mic.ctx.resume().catch(() => {
              /* resume needs a gesture; startLive came from a tap */
            });
          }
          return;
        }
        if (eventType === 'partial') {
          store.apply(msg);
          setLivePartial(store.latestPartial?.expected ?? null);
          return;
        }
        if (
          eventType === 'stable_word' ||
          eventType === 'final_word' ||
          eventType === 'wrong' ||
          eventType === 'skipped' ||
          eventType === 'word'
        ) {
          store.apply(msg);
          setLiveWords(store.snapshot());
          setLivePartial(null);
          // The page follows the heard ayah: a word from another ayah
          // moves the selection (and its line page) there, so the
          // heard words land on the page, not in the wall below.
          if (
            typeof msg.ayah === 'number' &&
            msg.ayah !== ayahRef.current
          ) {
            setAyah(msg.ayah);
          }
          return;
        }
        if (eventType === 'correction') {
          // The same slot, re-decided: the store replaces it in
          // place — no duplicate word, no double count.
          store.apply(msg);
          setLiveWords(store.snapshot());
          return;
        }
        if (eventType === 'located') {
          store.apply(msg);
          // The server located the recited ayah (session start from
          // another ayah, or a re-locate after a >5-ayah jump): move
          // the page there before the first word of it arrives.
          if (typeof msg.ayah === 'number' && msg.ayah !== ayahRef.current) {
            setAyah(msg.ayah);
          }
          return;
        }
        if (eventType === 'extra') {
          store.apply(msg);
          setLiveExtraCount(store.extras.length);
          setLiveExtraWords([...store.extras]);
          return;
        }
        if (eventType === 'progress' || eventType === 'warning') {
          store.apply(msg);
          if (eventType === 'warning') {
            if (msg.code === 'hifz_frames_before_ready') {
              const n =
                typeof msg.dropped === 'number' ? msg.dropped : 0;
              setLiveWarning(
                labels.liveFramesBeforeReady.replace('{n}', String(n)),
              );
              setLiveDiag((prev) => ({ ...prev, dropped: n }));
            } else if (typeof msg.message === 'string') {
              setLiveWarning(msg.message);
            }
          }
          return;
        }
        if (eventType === 'final') {
          liveCloseExpectedRef.current = true;
          liveRunActiveRef.current = false;
          clearLiveConnectTimeout();
          cleanupLiveMic();
          setLiveState('ended');
          // The graded detail replaces the live overlay: once the
          // server grades arrive, live words (ink) give way to the
          // graded colors. Clearing only here (never in
          // refreshDetail) keeps peek/dispute refreshes from wiping
          // a live run, and the isCurrent guard keeps a newer run's
          // words safe if it started while the detail was in flight.
          // If the detail fails (network), the live ink words stay:
          // they are the true record of this session, and the grades
          // arrive on the next load.
          void (async () => {
            try {
              await refreshDetail(attemptId);
            } catch {
              return;
            }
            if (isCurrent()) setLiveWords([]);
          })();
          return;
        }
        if (eventType === 'session_ended') {
          // The server closed the session (end / max duration /
          // error / disconnect). If `final` already ended the run,
          // this is a no-op; otherwise the run ends here.
          if (liveStateRef.current === 'ended') return;
          liveCloseExpectedRef.current = true;
          liveRunActiveRef.current = false;
          clearLiveConnectTimeout();
          cleanupLiveMic();
          setLiveState(msg.reason === 'end' || msg.reason === 'max_duration' ? 'ended' : 'idle');
          if (msg.reason !== 'end' && msg.reason !== 'max_duration') {
            setLiveError(labels.liveDisconnected);
          }
          return;
        }
        if (eventType === 'error') {
          if (!isFatalLiveError(msg)) {
            // Non-fatal server error (e.g. a rejected frame): the
            // session continues; the message is shown, not fatal.
            if (typeof msg.message === 'string') setLiveWarning(msg.message);
            return;
          }
          liveCloseExpectedRef.current = true;
          liveRunActiveRef.current = false;
          clearLiveConnectTimeout();
          cleanupLiveMic();
          setLiveError(msg.message ?? labels.errorGeneric);
          setLiveState('idle');
          return;
        }
      };
      ws.onerror = () => {
        if (!isCurrent()) return;
        liveCloseExpectedRef.current = true;
        liveRunActiveRef.current = false;
        clearLiveConnectTimeout();
        cleanupLiveMic();
        setLiveError(offlineRef.current ? labels.offlineDisconnected : labels.errorGeneric);
        setLiveState('idle');
      };
      ws.onclose = () => {
        if (!isCurrent()) return;
        liveRunActiveRef.current = false;
        clearLiveConnectTimeout();
        cleanupLiveMic();
        if (liveStoppingRef.current) {
          // stopLive sent 'end' and closed: the run is done.
          liveStoppingRef.current = false;
          setLiveState('idle');
          return;
        }
        // An unexpected close (server restart, network drop) ends
        // the session visibly as 'interrupted' — the user taps the
        // mic to start a NEW session (the server never resumes one;
        // unsaved words of the old session are lost). When the
        // browser is offline the message says so instead.
        if (!liveCloseExpectedRef.current) {
          setLiveError(offlineRef.current ? labels.offlineDisconnected : labels.liveDisconnected);
          setLiveState('interrupted');
        }
      };
    } catch {
      // A failed start must not leave a dangling socket that could flip
      // the page to "listening" later: close it as expected, then clean.
      // A superseded run owns nothing here — the newer run (or the
      // cancel) already tore its own resources down.
      if (!isCurrent()) return;
      liveCloseExpectedRef.current = true;
      liveRunActiveRef.current = false;
      clearLiveConnectTimeout();
      try {
        liveWsRef.current?.close();
      } catch {
        /* already closed */
      }
      liveWsRef.current = null;
      cleanupLiveMic();
      setLiveError(labels.errorGeneric);
      setLiveState('idle');
    }
  }, [
    authed,
    ensureAttempt,
    labels,
    surah,
    ayah,
    refreshDetail,
    cleanupLiveMic,
    cancelLive,
    clearLiveConnectTimeout,
    handleLiveAudioChunk,
  ]);

  const stopLive = useCallback(() => {
    // Stop is immediate. The old code waited for the server's final
    // message or a 10s timer, and every re-press restarted that timer,
    // so repeated pressing never stopped anything. Frames are ordered
    // on one connection, so 'end' reaches the server before the close
    // frame and the session is still saved server-side. The state
    // goes to 'stopping' until the expected close lands, then idle.
    liveCloseExpectedRef.current = true;
    liveRunActiveRef.current = false;
    liveStoppingRef.current = true;
    clearLiveConnectTimeout();
    const ws = liveWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'end' }));
      } catch {
        /* socket closing; the server treats a bare close as no-save */
      }
    }
    liveWsRef.current = null;
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    cleanupLiveMic();
    setLiveState('stopping');
  }, [cleanupLiveMic, clearLiveConnectTimeout]);

  const pauseLive = useCallback(() => {
    // Pause holds the capture: the context is suspended, so no
    // frames leave the page and the timer stops; the socket stays
    // open and the session resumes exactly where it left off. A
    // long pause may still be cut by the server (then it surfaces
    // as interrupted). Phase 4: the pause is also server-side now
    // (G-05) — the attempt is marked paused, see below.
    if (liveState !== 'listening') return;
    const mic = liveMicRef.current;
    if (mic) void mic.ctx.suspend().catch(() => { /* already suspended */ });
    setLiveState('paused');
    // Phase 4 — the pause is also server-side now (G-05): the
    // attempt is marked paused and its last position is stored, so
    // a long pause or leaving the app resumes from the same word.
    if (attempt) {
      const wordIndex =
        liveWords.length > 0 ? liveWords[liveWords.length - 1].word_index : 0;
      void authJson(`${HIFZ_API}/attempts/${attempt.id}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_surah: surah,
          current_ayah: ayah,
          current_word_index: wordIndex,
        }),
      }).catch(() => {});
      void authJson(`${HIFZ_API}/attempts/${attempt.id}/pause`, {
        method: 'POST',
      }).catch(() => {});
    }
  }, [liveState, attempt, liveWords, surah, ayah]);

  const resumeLive = useCallback(() => {
    if (liveState !== 'paused') return;
    const mic = liveMicRef.current;
    if (mic) {
      void mic.ctx.resume().catch(() => {
        /* resume needs a gesture; the tap that called this is one */
      });
    }
    setLiveState('listening');
    // Phase 4 — a freeze hold is cleared by the same tap (the user
    // corrected the word first); the server-side pause is lifted.
    setFreezeHold(false);
    if (attempt) {
      void authJson(`${HIFZ_API}/attempts/${attempt.id}/resume`, {
        method: 'POST',
      }).catch(() => {});
    }
  }, [liveState, attempt]);

  // Phase 4 — freeze: when freeze_on_error is ON and the newest live
  // word was wrong/close, pause the capture until the user corrects
  // the word and taps continue. The server never freezes (premium
  // behaviour); this hold is purely the user's own setting. (Placed
  // after pauseLive: the effect closes over it.)
  useEffect(() => {
    if (!hifzSettings.freezeOnError) return;
    if (liveState !== 'listening' || freezeHold) return;
    const newest = liveWords.length > 0 ? liveWords[liveWords.length - 1] : null;
    if (newest && (newest.status === 'wrong' || newest.status === 'close')) {
      pauseLive();
      setFreezeHold(true);
    }
  }, [liveWords, liveState, freezeHold, hifzSettings.freezeOnError, pauseLive]);

  // Reveal words by Peek: one shared path for the next word and
  // for the rest of the ayah. The words are always the NEXT
  // unwritten words of the CURRENT ayah (peekTarget's ayah) —
  // never random and never past the ayah. Authenticated: one POST
  // with the index list (the server inserts one peek mistake per
  // word, each with status `peeked`); guest: the same words go to
  // revealedLocal with the same status.
  const revealWords = useCallback(async (ayahNum: number, indices: number[], kind: 'word' | 'ayah') => {
    if (indices.length === 0) return;
    if (!authed) {
      setRevealedLocal((prev) => {
        const next = new Set(prev);
        for (const i of indices) next.add(`${surah}:${ayahNum}:${i}`);
        return next;
      });
      return;
    }
    const attemptId = await ensureAttempt();
    if (!attemptId) return;
    try {
      await authJson(`${HIFZ_API}/attempts/${attemptId}/peek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surah,
          ayah: ayahNum,
          word_indices: indices,
          // Phase 4 — the button meaning, from the video evidence:
          // '<' = preview the NEXT WORD, '<<' = preview the rest of
          // the AYAH (strong iconic inference from the Bayan window
          // at 53s; the buttons were never pressed in the videos).
          kind,
        }),
      });
      await refreshDetail(attemptId);
    } catch {
      setError(labels.errorGeneric);
    }
  }, [authed, ensureAttempt, refreshDetail, surah, labels.errorGeneric]);

  const peekNext = useCallback(async () => {
    if (!peekTarget) return;
    await revealWords(peekTarget.ayah, [peekTarget.index], 'word');
  }, [peekTarget, revealWords]);

  // Reveal the rest of the CURRENT ayah: from the next unwritten
  // word to the end of that same ayah — never into the next ayah.
  const peekAyah = useCallback(async () => {
    if (!peekTarget) return;
    const words = (textsBySurah[surah]?.[peekTarget.ayah] ?? '').split(/\s+/).filter(Boolean);
    const indices: number[] = [];
    for (let i = peekTarget.index; i < words.length; i += 1) {
      if (!wallKeys.has(`${peekTarget.ayah}:${i}`)) indices.push(i);
    }
    await revealWords(peekTarget.ayah, indices, 'ayah');
  }, [peekTarget, textsBySurah, surah, wallKeys, revealWords]);

  const disputeWord = useCallback(
    async (scoreId: string) => {
      if (!attempt) return;
      try {
        await authJson(`${HIFZ_API}/attempts/${attempt.id}/dispute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word_score_id: scoreId }),
        });
        await refreshDetail(attempt.id);
      } catch {
        setError(labels.errorGeneric);
      }
    },
    [attempt, labels.errorGeneric, refreshDetail],
  );

  // Phase 4 — delete one mistake from the sheet (per-item delete;
  // there is deliberately no bulk delete — that needs a user
  // decision, see the Phase 4 notes).
  const deleteMistake = useCallback(
    async (mistakeId: string) => {
      if (!attempt) return;
      try {
        await authJson(`${HIFZ_API}/mistakes/${mistakeId}`, { method: 'DELETE' });
        const groups = await authJson<HifzMistakeGroup[]>(
          `${HIFZ_API}/attempts/${attempt.id}/mistakes`,
        );
        setGroupedMistakes(groups);
        await refreshDetail(attempt.id);
      } catch {
        setError(labels.errorGeneric);
      }
    },
    [attempt, refreshDetail, labels.errorGeneric],
  );

  const surahName =
    surahList.find((s) => s.number === surah)?.nameAr ?? String(surah);

  // Header range: juz / hizb / printed page of the selected ayah.
  const headerRange = useMemo(() => {
    if (!boundaries) return null;
    try {
      return rangeContaining(boundaries, surah, ayah);
    } catch {
      return null;
    }
  }, [boundaries, surah, ayah]);

  // Phase 6 — V2 unification: the page on screen IS a V2 page, so
  // its page/juz/hizb come from that V2 page (activeV2Page, the page
  // of the current ayah). The boundaries fallback (headerRange) is
  // V2 too since the completion migration (loadBoundaries returns
  // V2 page starts; the QPC1 JSON is only the loader-level fallback
  // while V2 data is loading or has failed). Before phase 6, the
  // header said QPC1 page 121 for 5:77 while the V2 page on screen
  // was 120 (verified live); juz/hizb agree between the two
  // editions, so only the page number changes, on the 56 differing
  // ayahs. The academy's hizb stays the 120-scale (half-hizb)
  // convention of the reader — Tarteel shows the 60-scale hizb
  // (19 for page 182, where the academy shows 37); changing that
  // scale in the header alone would break the reader-wide
  // convention, so it is documented, not changed (phase 6 notes).
  const headerMeta = useMemo(() => {
    if (activeV2Page) {
      return { page: activeV2Page.n, juz: activeV2Page.juz, hizb: activeV2Page.hizb };
    }
    return headerRange;
  }, [activeV2Page, headerRange]);

  // Live pills (Tarteel): error count and accuracy, from the words
  // written so far in this session (live + graded). A close word is
  // a tashkeel error and counts as an error, like Tarteel.
  const pillStats = useMemo(() => {
    let correct = 0;
    let close = 0;
    let wrong = 0;
    let peeked = 0;
    for (const w of liveWords) {
      if (w.status === 'correct') correct += 1;
      else if (w.status === 'close') close += 1;
      else if (w.status === 'wrong') wrong += 1;
    }
    for (const w of attemptWords) {
      if (w.surah !== surah) continue;
      if (w.status === 'correct') correct += 1;
      else if (w.status === 'close') close += 1;
      else if (w.status === 'wrong') wrong += 1;
    }
    // Peeked words (status `peeked` in the wall) count as errors
    // until they are graded: they were shown, not recited. Once a
    // peeked word is graded, the wall carries its grade instead of
    // `peeked`, so it is never counted twice.
    for (const g of wallAyahs) {
      for (const w of g.words) if (w.status === 'peeked') peeked += 1;
    }
    const extra = liveExtraCount;
    const errors = close + wrong + extra + peeked;
    const total = correct + close + wrong + extra + peeked;
    const accuracy = total > 0 ? Math.round((correct / total) * 1000) / 10 : 100;
    return { errors, accuracy, total, correct, peeked };
  }, [liveWords, attemptWords, liveExtraCount, surah, wallAyahs]);

  // Session timer as MM:SS (Eastern Arabic digits, like Tarteel).
  // Phase 7: shared helper — the same format lived in the listen
  // mini-player too (see formatArabicIndicDuration).
  const timerText = useMemo(
    () => formatArabicIndicDuration(sessionSeconds),
    [sessionSeconds],
  );

  // Wrong + close words for the error sheet (expected vs heard).
  const errorWords = useMemo(() => {
    const byKey = new Map<string, { ayah: number; index: number; expected: string; heard: string | null; status: string }>();
    for (const w of liveWords) {
      if (w.status !== 'wrong' && w.status !== 'close') continue;
      byKey.set(`${w.ayah}:${w.word_index}`, {
        ayah: w.ayah,
        index: w.word_index,
        expected: w.expected,
        heard: w.heard,
        status: w.status,
      });
    }
    for (const w of attemptWords) {
      if (w.surah !== surah) continue;
      if (w.status !== 'wrong' && w.status !== 'close') continue;
      byKey.set(`${w.ayah}:${w.word_index}`, {
        ayah: w.ayah,
        index: w.word_index,
        expected: w.expected_text,
        heard: w.heard,
        status: w.status,
      });
    }
    return [...byKey.values()].sort((a, b) => a.ayah - b.ayah || a.index - b.index);
  }, [liveWords, attemptWords, surah]);

  // Pages of the current surah, for scroll mode (all pages stacked).
  const surahPageIndices = useMemo(() => {
    // Phase 3: scroll mode pages by the V2 index while V2 data is
    // loaded (the V2 and old page spans differ on 25 pages).
    if (useV2 && v2Data) {
      const first = v2PageIndexFor(v2Data.pages, surah, 1);
      if (first === null) return [];
      const last = v2PageIndexFor(v2Data.pages, surah, ayahCount || 1) ?? first;
      const out: number[] = [];
      for (let p = first; p <= last; p += 1) out.push(p);
      return out;
    }
    if (!mushafPages) return [];
    const first = pageIndexFor(mushafPages, surah, 1);
    if (first === null) return [];
    const last = pageIndexFor(mushafPages, surah, ayahCount || 1) ?? first;
    const out: number[] = [];
    for (let p = first; p <= last; p += 1) out.push(p);
    return out;
  }, [useV2, v2Data, mushafPages, surah, ayahCount]);

  // ---- Performance (§8): fallback-only data loads. ----
  // The old QPC1 line data (1.78MB raw / 354KB gzip) and the
  // juz/hizb/page boundaries (265KB raw / 55KB gzip) used to download
  // unconditionally on mount, in parallel with the V2 data — on slow
  // 3G they shared the pipe for the whole first minute and the QPC1
  // chunk ending gated the load event. Both are fallback-only now:
  // the mushaf renders from V2 (pageReady never waits for them) and
  // the header reads page/juz/hizb from the V2 page (headerMeta).
  // They download only when the V2 path cannot render the view:
  //   - V2 failed outright (v2Data === null): at once, both.
  //   - the current page's V2 expansion failed (usedV2 false), or a
  //     scroll-mode edge page (first/last of the surah — the only
  //     pages that can span into a neighbor surah) failed: after a
  //     3s grace period. The usual transient cause — a neighbor
  //     surah's texts not fetched yet — resolves in ~1s, and the
  //     grace avoids a wasted 354KB download on slow 3G; the effect
  //     cleanup cancels the timer if the render recovers. A genuine
  //     mismatch still falls back, just 3s later.
  // Interior scroll pages need only this surah's texts (already
  // loaded once textsReady), so they cannot fail for missing tokens;
  // a genuine mismatch there surfaces when its ayah becomes active.
  const needsOldLines = useMemo(() => {
    if (v2Data === null) return true;
    if (v2Data === undefined || !useV2) return false;
    if (!usedV2) return true;
    if (displayMode === 'scroll' && surahPageIndices.length > 0) {
      const first = surahPageIndices[0];
      const last = surahPageIndices[surahPageIndices.length - 1];
      for (const p of [first, last]) {
        if (p === activePageIndex) continue;
        const v2p = v2Data.pages[p];
        if (
          v2p &&
          buildV2PageRender(v2Data, v2p, surah, textsBySurah, wallAyahs) === null
        ) {
          return true;
        }
      }
    }
    return false;
  }, [v2Data, useV2, usedV2, displayMode, surahPageIndices, activePageIndex, textsBySurah, wallAyahs, surah]);

  useEffect(() => {
    if (!needsOldLines || mushafPages !== undefined) return;
    if (v2Data === null) {
      let cancelled = false;
      loadMushafLines().then((pages) => {
        if (!cancelled) setMushafPages(pages);
      });
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      loadMushafLines().then((pages) => {
        if (!cancelled) setMushafPages(pages);
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [needsOldLines, v2Data, mushafPages]);

  // Boundaries are header-fallback-only (headerMeta prefers the V2
  // page): they download only when V2 failed outright. The loader
  // itself still prefers V2 page starts and falls back to the QPC1
  // boundaries JSON — that fallback only runs while V2 is
  // unavailable, never on a healthy load.
  useEffect(() => {
    if (v2Data !== null) return;
    let cancelled = false;
    loadBoundaries().then((b) => {
      if (!cancelled) setBoundaries(b);
    });
    return () => {
      cancelled = true;
    };
  }, [v2Data]);

  const isZipformer = engineStatus?.engine === 'zipformer';
  const isWhisper = engineStatus?.engine === 'whisper_quran';

  // One line-page word slot: a hidden slot (unwritten, or a printed
  // spacer) renders invisible but keeps its place; a live-heard slot
  // is written in plain mushaf ink as recited (no live color, no
  // heard label: hearing stays in the background); a graded slot
  // renders its status color, practice selection, and dispute.
  // One line-page word slot. A hidden slot (unwritten, or a printed
  // spacer) renders invisible but keeps its place — EXCEPT in listen
  // mode, where the page's words are all visible for following along
  // (Segment builder: words visible, current word highlighted).
  // A live-heard slot is written in plain mushaf ink as recited; a
  // graded slot renders its status color, practice selection, and
  // dispute. In listen mode the current word gets the green
  // highlight (solid #188653 + white text, like the Segment builder).
  const renderLineWord = (slot: LineWordSlot, key: string) => {
    // Listen mode: the word the reciter is currently on.
    const isListenNow =
      studyMode === 'listen' &&
      listen.isPlaying &&
      slot.ayah === listenAyah &&
      listenWord !== null &&
      slot.index === listenWord - 1;
    if (slot.hidden || slot.written === null) {
      if (studyMode === 'listen') {
        // Phase 4 — Hide the script in listen mode too: the whole
        // text is visible here by design (following the reciter), so
        // the crossed-eye conceals every word except the one the
        // reciter is currently on; tapping a placeholder reveals
        // just that word.
        const listenKey =
          slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : null;
        if (
          scriptHidden &&
          !isListenNow &&
          listenKey !== null &&
          !revealedWords.has(listenKey)
        ) {
          return (
            <button
              type="button"
              key={key}
              className="hifz-line-word hifz-line-word-concealed"
              onClick={() =>
                setRevealedWords((prev) => new Set(prev).add(listenKey))
              }
              aria-label={labels.showScript}
              data-word-key={listenKey}
              data-qul-id={slot.qulId}
            >
              <span aria-hidden="true">{renderTajweedText(slot.text)}</span>
            </button>
          );
        }
        return (
          <span
            key={key}
            className={[
              'hifz-line-word',
              'hifz-word-listen',
              isListenNow ? 'hifz-word-listen-now' : '',
            ].join(' ')}
            data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
            data-qul-id={slot.qulId}
          >
            {renderTajweedText(slot.text)}
            {slot.pauseAfter ? (
              <span className="hifz-word-pause" aria-hidden="true">
                {slot.pauseAfter}
              </span>
            ) : null}
          </span>
        );
      }
      return (
        <span
          key={key}
          className="hifz-line-word-hidden"
          aria-hidden="true"
          data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
          data-qul-id={slot.qulId}
        >
          {slot.text}
          {slot.pauseAfter ? (
            <span className="hifz-word-pause" aria-hidden="true">
              {slot.pauseAfter}
            </span>
          ) : null}
        </span>
      );
    }
    const w = slot.written;
    // Phase 4 — Hide the script (crossed-eye): a written word
    // becomes a dotted, clickable placeholder; tapping it reveals
    // just that word (gradual reveal). Unwritten words are hidden
    // already (the branch above); this only conceals words the user
    // has already read. It applies in both modes: in listen mode the
    // words become written as the reciter reads them, and hiding
    // them is the same «hide the script» gesture.
    const wordKey =
      slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : null;
    if (scriptHidden && wordKey !== null && !revealedWords.has(wordKey)) {
      return (
        <button
          type="button"
          key={key}
          className="hifz-line-word hifz-line-word-concealed"
          onClick={() =>
            setRevealedWords((prev) => new Set(prev).add(wordKey))
          }
          aria-label={labels.showScript}
          data-word-key={wordKey}
          data-qul-id={slot.qulId}
        >
          <span aria-hidden="true">{renderTajweedText(slot.text)}</span>
        </button>
      );
    }
    const isPractice = practiceWord?.ayah === slot.ayah && practiceWord?.index === slot.index;
    // The newest word just heard is GREEN when correct, RED when
    // wrong and YELLOW-highlighted when it is a tashkeel error
    // (close) until the next word arrives; older live words settle
    // to black ink with their tajweed colors. Grades never color
    // live words.
    const newestLive = liveWords.length > 0 ? liveWords[liveWords.length - 1] : null;
    const isNewestLive =
      w.live &&
      newestLive !== null &&
      newestLive.ayah === slot.ayah &&
      newestLive.word_index === slot.index;
    // Newest word, by its own status: correct is green, a recitation
    // error is red (dashed underline), a tashkeel error is the yellow
    // highlight (dotted underline) — three distinct tones, not two.
    const newestTone =
      isNewestLive && w.status === 'wrong'
        ? 'hifz-word-live-new-wrong'
        : isNewestLive && w.status === 'close'
          ? 'hifz-word-live-new-close'
          : 'hifz-word-live-new';
    const tone =
      w.status === 'peeked'
        ? 'hifz-word-peeked'
        : w.live
          ? isNewestLive
            ? `hifz-word-live ${newestTone}`
            : 'hifz-word-live'
          : `hifz-word-${w.status}`;
    return (
      <span
        key={key}
        className={[
          'hifz-line-word',
          tone,
          isPractice ? 'hifz-word-practice' : '',
          isListenNow ? 'hifz-word-listen-now' : '',
        ].join(' ')}
        data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
        data-qul-id={slot.qulId}
      >
        <button
          type="button"
          className="hifz-word-text"
          onClick={() =>
            setPracticeWord({ ayah: slot.ayah, index: slot.index, text: slot.text })
          }
          title={labels.practiceWordHint}
        >
          {renderTajweedText(slot.text)}
        </button>
        {slot.pauseAfter ? (
          <span className="hifz-word-pause" aria-hidden="true">
            {slot.pauseAfter}
          </span>
        ) : null}
        {!w.live &&
          w.status !== 'peeked' &&
          (w.status === 'wrong' || w.status === 'close') &&
          w.scoreId &&
          !w.disputed && (
            <button
              type="button"
              className="hifz-word-dispute"
              onClick={() => void disputeWord(w.scoreId as string)}
            >
              {labels.dispute}
            </button>
          )}
        {w.disputed && <span className="hifz-word-disputed">{labels.disputed}</span>}
      </span>
    );
  };

  // The floating mic is the PRIMARY record control: one button whose
  // action follows the selected engine (live stream for zipformer,
  // record-then-grade for whisper). It replaces the old record
  // buttons below; it never duplicates them.
  // The mic shows the stop square (and pulses) while live OR while a
  // run is still starting — in both states tapping it stops the run.
  const liveStarting =
    liveState === 'requesting_permission' ||
    liveState === 'connecting' ||
    liveState === 'engine_loading' ||
    liveState === 'stopping';
  const micActive =
    (isZipformer &&
      (liveState === 'listening' || liveState === 'paused' || liveStarting)) ||
    (isWhisper && recState === 'recording');
  // While a live run is starting, the mic is NOT busy: tapping it
  // cancels the run. Before this fix it was disabled with no timeout
  // and no cancel, so a stuck handshake left the page usable only
  // after a reload. Only the Whisper record path still disables the
  // mic while its recording is being graded.
  const micBusy = !isZipformer && recState === 'processing';
  const micLabel = isZipformer
    ? liveState === 'listening' || liveState === 'paused'
      ? labels.liveStop
      : liveStarting
        ? labels.liveCancel
        : labels.liveStart
    : micActive
      ? labels.stopRecording
      : labels.recordGrade;
  // Phase 5 — audio focus handoff + mode switch. The player and the
  // mic never hold audio at once: starting a recording pauses
  // listening; switching to listen stops any live run; stopping
  // listening never starts a recording.
  const switchToListen = useCallback(() => {
    if (isZipformer) {
      if (liveState === 'listening' || liveState === 'paused') stopLive();
      else if (liveStarting) cancelLive(false);
    } else if (isWhisper && recState === 'recording') {
      stopRecording();
    }
    setStudyMode('listen');
  }, [isZipformer, liveState, liveStarting, stopLive, cancelLive, isWhisper, recState, stopRecording]);

  const switchToPractice = useCallback(() => {
    listen.stop();
    setStudyMode('practice');
  }, [listen]);

  // Long-press on the green mic button switches practice → listen
  // (spec §6 — the gesture was only seen as banner text, never
  // performed in the videos; 600ms is the academy's own threshold).
  // A short tap still starts/stops the mic. The button is disabled
  // for guests (sign-in is required to record), so guests switch
  // with the mode-toggle buttons instead.
  const micLongPressTimerRef = useRef<number | null>(null);
  const micLongPressFiredRef = useRef(false);
  const clearMicLongPress = useCallback(() => {
    if (micLongPressTimerRef.current !== null) {
      window.clearTimeout(micLongPressTimerRef.current);
      micLongPressTimerRef.current = null;
    }
  }, []);
  // Phase 7: unmount must not let a pending long-press timer fire
  // switchToListen() after the page is gone.
  useEffect(() => clearMicLongPress, [clearMicLongPress]);
  const onMicPointerDown = useCallback(() => {
    clearMicLongPress();
    micLongPressTimerRef.current = window.setTimeout(() => {
      micLongPressFiredRef.current = true;
      switchToListen();
    }, HIFZ_LISTEN_LONG_PRESS_MS);
  }, [clearMicLongPress, switchToListen]);

  const micOnClick = (): void => {
    if (micLongPressFiredRef.current) {
      micLongPressFiredRef.current = false;
      return;
    }
    // Phase 5: starting a recording pauses listening (audio focus).
    if (listen.isPlaying) listen.pause();
    if (isZipformer) {
      if (liveState === 'listening' || liveState === 'paused') stopLive();
      else if (liveStarting) cancelLive(false);
      else void startLive();
    } else if (isWhisper) {
      if (recState === 'recording') stopRecording();
      else void startRecording();
    }
  };

  // Scroll mode: keep the page of the current ayah in view. The
  // page sections are registered by ref; when the ayah moves to
  // another page, that page scrolls into view (smooth, nearest).
  const scrollPageRefs = useRef<Map<number, HTMLElement>>(new Map());
  useEffect(() => {
    if (displayMode !== 'scroll') return;
    if (activePageIndex === null) return;
    const el = scrollPageRefs.current.get(activePageIndex);
    if (el) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [displayMode, activePageIndex, ayah]);

  // Phase 7: Escape closes either open sheet (keyboard path to
  // match the backdrop tap + the close button; no focus trap yet —
  // see the phase 7 notes, deliberately not changed).
  useEffect(() => {
    if (!settingsOpen && !errorSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setErrorSheetOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, errorSheetOpen]);

  // One printed page as a section: header/basmala/text lines + the
  // printed page number at the bottom (Eastern Arabic digits).
  const renderPageSection = (pIdx: number, lines: RenderLine[], key: string) => (
    <section
      key={key}
      ref={(el) => {
        if (el) scrollPageRefs.current.set(pIdx, el);
        else scrollPageRefs.current.delete(pIdx);
      }}
      className="hifz-line-page"
      aria-label={labels.title}
    >
      <p className="hifz-line-caption">
        {surahName} · {labels.pageLabel} {toArabicIndic(pIdx + 1)}
      </p>
      {lines.map((line) => {
        if (line.kind === 'header') {
          // Phase-1 hifz fix: the floral black-white SVG frame (same
          // asset as the reader's V2 page), only on the first page
          // of a surah. Surah 1 has no SVG in that set, the old-lines
          // fallback carries no surah number, and a failed load all
          // fall back to the plain-text header.
          const headerSurah = line.surah;
          if (
            headerSurah !== undefined &&
            headerSurah !== 1 &&
            !failedStudyHeaders.has(headerSurah)
          ) {
            const padded = String(headerSurah).padStart(3, '0');
            return (
              <p key={line.key} className="hifz-line hifz-line-header hifz-line-header--svg">
                <img
                  src={`/quran/surah-headers/surah-${padded}.svg`}
                  alt={line.text}
                  onError={() =>
                    setFailedStudyHeaders((prev) => new Set(prev).add(headerSurah))
                  }
                />
              </p>
            );
          }
          return (
            <p key={line.key} className="hifz-line hifz-line-header">
              {line.text}
            </p>
          );
        }
        if (line.kind === 'basmala') {
          if (line.slots.length === 0) {
            return (
              <p key={line.key} className="hifz-line hifz-line-basmala" aria-hidden="true">
                {'\u00a0'}
              </p>
            );
          }
          return (
            <p key={line.key} className="hifz-line hifz-line-basmala" dir="rtl">
              {line.slots.map((slot) => renderLineWord(slot, `${line.key}-${slot.index}`))}
            </p>
          );
        }
        return (
          <p key={line.key} className="hifz-line" dir="rtl">
            {line.slots.map((slot, si) =>
              slot.kind === 'marker' ? (
                <HifzRosette key={`m${si}`} digit={slot.text} />
              ) : slot.kind === 'ornament' ? (
                <span key={`o${si}`} className="hifz-line-ornament" aria-hidden="true">
                  {slot.text}
                </span>
              ) : (
                renderLineWord(slot, `${line.key}-${si}`)
              ),
            )}
          </p>
        );
      })}
      <p className="hifz-page-footer" aria-label={`${labels.pageLabel} ${pIdx + 1}`}>
        {toArabicIndic(pIdx + 1)}
      </p>
    </section>
  );

  // Display-mode change: persist the choice.
  const setDisplayModePersist = useCallback((m: DisplayMode) => {
    setDisplayMode(m);
    try {
      window.localStorage.setItem(DISPLAY_MODE_KEY, m);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Accuracy pill color (Phase 4): the thresholds come from the
  // Phase 2 video evidence (§5.2) — green >=99, lime >=98, amber
  // >=95, red <95. The earlier guess (green >=95 / amber 80–95 /
  // red <80) is refuted by the videos (92.2% is red, not amber);
  // the exact cut points between the observed bands are unknown.
  const accuracyTone = accuracyPillTone(pillStats.accuracy);

  const liveActive =
    liveState === 'listening' ||
    liveState === 'paused' ||
    liveState === 'connecting' ||
    liveState === 'engine_loading' ||
    liveState === 'requesting_permission';
  const showPills = liveState === 'listening' || liveState === 'paused' || liveState === 'ended';

  /** The speech engine is known-unavailable (the status endpoint
      said so): the mic must not start a run that cannot be graded.
      While the status is still loading (null) the page stays
      fail-open — the server answers honestly with 503 instead. */
  const modelUnavailable = isZipformer && engineStatus !== null && !engineStatus.available;

  return (
    <div
      className={`quran-hifz-study${hifzSettings.hideAyahMarkers ? ' hifz-hide-markers' : ''}`}
      dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Header (Tarteel title box): surah name on its own line,
          then page | juz | hizb + the current surah:ayah while a
          live session runs. Page/juz/hizb come from the V2 page on
          screen (headerMeta), not the QPC1 boundaries. */}
      <header className="hifz-header">
        <h2 className="hifz-title">{labels.title}</h2>
        <p className="hifz-header-sub">
          <span className="hifz-header-surah">{surahName}</span>
          {headerMeta &&
            headerMeta.page !== null &&
            headerMeta.juz !== null &&
            headerMeta.hizb !== null && (
              <span className="hifz-header-meta">
                {labels.headerPage} {toArabicIndic(headerMeta.page)} {' | '}
                {labels.headerJuz} {toArabicIndic(headerMeta.juz)} {' | '}
                {labels.headerHizb} {toArabicIndic(headerMeta.hizb)}
                {liveActive && (
                  <>
                    {' | '}
                    <span className="hifz-header-pos">
                      {toArabicIndic(surah)}:{toArabicIndic(ayah)}
                    </span>
                  </>
                )}
              </span>
            )}
        </p>
      </header>

      {/* Phase 4 — resume banner: an open session exists and the
          user asked for resumable sessions. Continuing jumps to the
          stored position; «fresh» starts a new session instead. */}
      {resumeCandidate !== null && (
        <div className="hifz-resume-banner" role="status">
          <span>
            {labels.resumeTitle}: {surahList.find((s) => s.number === resumeCandidate.surah)?.nameAr ?? resumeCandidate.surah}
            {' — '}
            {toArabicIndic(resumeCandidate.current_surah ?? resumeCandidate.surah)}:
            {toArabicIndic(resumeCandidate.current_ayah ?? resumeCandidate.start_ayah ?? 1)}
          </span>
          <button
            type="button"
            onClick={() => {
              const target = resumeCandidate;
              const targetAyah = target.current_ayah ?? target.start_ayah ?? 1;
              resumeAyahRef.current = targetAyah;
              setSurah(target.surah);
              setAyah(targetAyah);
              setAttempt(target);
              setResumeCandidate(null);
            }}
          >
            {labels.resumeContinue}
          </button>
          <button type="button" onClick={() => setResumeCandidate(null)}>
            {labels.resumeDismiss}
          </button>
        </div>
      )}

      {/* Mode toggle: practice (recite) or listen (follow the reciter). */}
      <div className="hifz-mode-toggle" role="group" aria-label={labels.displayMode}>
        <button
          type="button"
          aria-pressed={studyMode === 'practice'}
          className={studyMode === 'practice' ? 'is-active' : ''}
          onClick={() => switchToPractice()}
        >
          {labels.modePractice}
        </button>
        <button
          type="button"
          aria-pressed={studyMode === 'listen'}
          className={studyMode === 'listen' ? 'is-active' : ''}
          onClick={() => switchToListen()}
        >
          {labels.modeListen}
        </button>
      </div>
      {/* Phase 5: the long-press switch (spec §6) is on the green
          button; this hint says so — the toggle above stays the
          keyboard/discoverable path. */}
      <p className="hifz-hint">{labels.listenLongPressSwitch}</p>

      {/* Phase-1 hifz fix: the session-setup form (picker, range,
          repetition, listen controls) is a collapsible panel, CLOSED
          by default — the mushaf below is the first visible element
          on load. The toggle shows the current selection (surah +
          start ayah), so the closed panel still says what session is
          configured. Nothing inside changed: the controls keep their
          state and behaviour. */}
      <div className="hifz-setup">
        <button
          type="button"
          className="hifz-setup-toggle"
          aria-expanded={setupOpen}
          onClick={() => setSetupOpen((v) => !v)}
        >
          {surahName} · {labels.ayahLabel} {toArabicIndic(ayah)} {setupOpen ? '▾' : '▸'}
        </button>
        {setupOpen && (
          <>
      <div className="hifz-picker" role="group" aria-label={labels.surahLabel}>
        <label>
          {labels.surahLabel}
          <select
            value={surah}
            onChange={(e) => setSurah(Number(e.target.value))}
            aria-label={labels.surahLabel}
          >
            {surahList.map((s) => (
              <option key={s.number} value={s.number}>
                {toArabicIndic(s.number)} — {s.nameAr}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.ayahLabel}
          <span className="hifz-page-nav">
            <button
              type="button"
              disabled={ayah <= 1}
              onClick={() => setAyah((a) => Math.max(1, a - 1))}
            >
              {labels.prevAyah}
            </button>
            <select
              value={ayah}
              aria-label={labels.ayahLabel}
              onChange={(e) => setAyah(Number(e.target.value))}
            >
              {Array.from({ length: ayahCount || 1 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {toArabicIndic(n)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={ayahCount > 0 && ayah >= ayahCount}
              onClick={() => setAyah((a) => (ayahCount > 0 ? Math.min(ayahCount, a + 1) : a + 1))}
            >
              {labels.nextAyah}
            </button>
          </span>
        </label>
      </div>

      {/* The picker IS the start-ayah selector: a session starts
          from the ayah chosen here (and ?ayah= follows it). */}
      <p className="hifz-hint">{labels.startAyahHint}</p>

      {/* Phase 4 — practice range + repetition: the session's ayah
          range (empty end = to the end of the surah) and how many
          times each ayah / the whole range repeats. Numeric inputs
          are Eastern-Arabic (HifzNumericInput): the range bounds
          pass through unclamped — validatePracticeRange still
          validates them on start, with the role="alert" error below. */}
      <div className="hifz-range" role="group" aria-label={labels.rangeStart}>
        <label>
          {labels.rangeStart}
          <HifzNumericInput
            value={rangeStart}
            onChange={(v) => {
              setRangeStart(v);
              setRangeError(null);
            }}
            ariaLabel={labels.rangeStart}
            placeholder={toArabicIndic(ayah)}
          />
        </label>
        <label>
          {labels.rangeEnd}
          <HifzNumericInput
            value={rangeEnd}
            onChange={(v) => {
              setRangeEnd(v);
              setRangeError(null);
            }}
            ariaLabel={labels.rangeEnd}
            placeholder={ayahCount > 0 ? toArabicIndic(ayahCount) : ''}
          />
        </label>
        <label>
          {labels.repeatAyah}
          <HifzNumericInput
            value={repeatAyah}
            onChange={(v) => setRepeatAyah(v ?? 1)}
            ariaLabel={labels.repeatAyah}
            min={1}
            max={20}
          />
        </label>
        <label>
          {labels.repeatRange}
          <HifzNumericInput
            value={repeatRange}
            onChange={(v) => setRepeatRange(v ?? 1)}
            ariaLabel={labels.repeatRange}
            min={1}
            max={20}
          />
        </label>
      </div>
      {rangeError !== null && (
        <p className="hifz-error" role="alert">
          {rangeError === 'rangeStart'
            ? labels.rangeErrorStart
            : rangeError === 'rangeEnd'
              ? labels.rangeErrorEnd
              : labels.rangeErrorOrder}
        </p>
      )}

      {/* Listen controls (Phase 5): configuration only — reciter
          picker, repeat mode (counts + range come from the Phase 4
          inputs above), stop, saved-position resume, and the
          timing-source note (real vs estimated). Transport lives on
          the glass mini player below (play/pause, prev/next, speed,
          repeat badge, position) — no control is duplicated. */}
      {studyMode === 'listen' && (
        <div className="hifz-listen-controls">
          <label>
            {labels.listenReciter}
            <select
              value={listenReciter}
              onChange={(e) => setListenReciter(e.target.value)}
              aria-label={labels.listenReciter}
            >
              {labels.listenReciters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.listenRepeat}
            <select
              value={listen.repeatMode}
              onChange={(e) =>
                listen.setRepeatMode(
                  e.target.value as ListenRepeatMode,
                )
              }
              aria-label={labels.listenRepeat}
            >
              <option value="off">{labels.listenRepeatOff}</option>
              <option value="ayah">{labels.listenRepeatAyah}</option>
              <option value="range">{labels.listenRepeatRange}</option>
              <option value="surah">{labels.listenRepeatSurah}</option>
            </select>
          </label>
          <button type="button" onClick={() => listen.stop()}>
            {labels.listenStop}
          </button>
          {/* Phase 5: resume after leaving/returning — the persisted
              position for this reciter+surah. Explicit: play() never
              jumps on its own. */}
          {listen.hasSavedPosition && listen.savedPosition !== null && (
            <button
              type="button"
              className="hifz-listen-resume"
              onClick={() => listen.resumeSaved()}
            >
              {labels.listenResumeFrom} {toArabicIndic(listen.savedPosition.ayah)}
            </button>
          )}
          <p className="hifz-hint" aria-live="polite">
            {labels.listenCurrentAyah}: {toArabicIndic(listen.currentAyah)}
            {ayahCount > 0 ? ` / ${toArabicIndic(ayahCount)}` : ''}
          </p>
          {listen.timingSource === 'segments' && (
            <p className="hifz-hint">{labels.listenSegmentsNote}</p>
          )}
          {listen.timingSource === 'interpolated' && (
            <p className="hifz-hint">{labels.listenInterpolatedNote}</p>
          )}
          {listen.listenError && (
            <p className="hifz-error" role="alert">
              {listen.listenErrorKind === 'offline'
                ? labels.listenOffline
                : labels.listenAudioFailed}{' '}
              <button type="button" onClick={() => listen.retry()}>
                {labels.listenRetry}
              </button>
            </p>
          )}
        </div>
      )}
          </>
        )}
      </div>

      {/* Phase 5: the listen audio element is ALWAYS rendered (hidden),
          not only in listen mode. The hook attaches its event
          listeners (loadedmetadata/ended/error/waiting/playing) to
          this element on mount; when it was conditional, switching
          to listen mode mounted it without re-running the effect, so
          durationMs stayed 0 (progress bar stuck, position text fell
          back) and 'ended' never advanced interpolated playback. */}
      <audio ref={listenAudioRef} preload="metadata" aria-hidden="true" />

      {/* Phase 5: the glass mini player (reader visual language) is
          the listen transport surface. It is fixed, so it never
          shifts the layout when it appears or when playback starts
          or stops; the spacer below reserves its space while listen
          mode is on, so it never covers the mushaf text. */}
      {studyMode === 'listen' && (
        <>
          <div className="hifz-listen-spacer" aria-hidden="true" />
          <HifzListenPlayer
            locale={locale}
            reciterName={
              labels.listenReciters.find((r) => r.id === listenReciter)?.label ?? listenReciter
            }
            reciterPhotoUrl={listenReciterPhotoUrl(listenReciter, reciterPhotos ?? {})}
            title={surahName}
            currentAyah={listen.currentAyah}
            ayahCount={ayahCount}
            progressMs={listen.progressMs}
            durationMs={listen.durationMs}
            speed={listen.speed}
            repeatMode={listen.repeatMode}
            repeatRemaining={listen.repeatRemaining}
            status={listen.listenStatus}
            errorKind={listen.listenErrorKind}
            labels={{
              play: labels.listenPlay,
              pause: labels.listenPause,
              resume: labels.listenResume,
              prevAyah: labels.listenPrevAyah,
              nextAyah: labels.listenNextAyah,
              repeat: labels.listenRepeat,
              repeatOff: labels.listenRepeatOff,
              repeatAyah: labels.listenRepeatAyah,
              repeatRange: labels.listenRepeatRange,
              repeatSurah: labels.listenRepeatSurah,
              speed: labels.listenSpeed,
              progress: labels.listenProgress,
              retry: labels.listenRetry,
              loading: labels.listenLoading,
              buffering: labels.listenBuffering,
              offline: labels.listenOffline,
              audioFailed: labels.listenAudioFailed,
              longPressSwitch: labels.listenLongPressSwitch,
            }}
            onPlayPause={() => {
              if (listen.isPlaying) listen.pause();
              else listen.resume();
            }}
            onPrevAyah={() => listen.prevAyah()}
            onNextAyah={() => listen.nextAyah()}
            onSeek={(ms) => listen.seek(ms)}
            onSpeedCycle={() => listen.cycleSpeed()}
            onRepeatCycle={() => listen.cycleRepeatMode()}
            onRetry={() => listen.retry()}
            onLongPressSwitch={() => switchToPractice()}
          />
        </>
      )}

      {/* Live pills (Tarteel): error count (red), accuracy % (color
          by range), session timer (gray, counts up). Shown while a
          live session runs; the timer disappears after stop.
          Phase 6: the row is dir=ltr so the visual order matches
          the frames (error left, accuracy middle, timer right);
          the pills themselves are solid Tarteel colors. */}
      {showPills && studyMode === 'practice' && (
        <div className="hifz-pills" dir="ltr" aria-live="polite">
          <span className="hifz-pill hifz-pill-red">
            <svg className="hifz-pill-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="17" r="1.4" fill="currentColor" />
            </svg>
            <span className="hifz-pill-label">{labels.pillErrors}: </span>{toArabicIndic(pillStats.errors)}
          </span>
          {/* Provisional (live words present, stored grade not yet
              arrived): show a count, not a percent — the uncalibrated
              live score is not a final percentage. When no live words
              are present the stored grade's final percent stands. */}
          {liveWords.length > 0 ? (
            <span className="hifz-pill hifz-pill-gray">
              <span className="hifz-pill-label">{labels.pillAccuracy}: </span>{toArabicIndic(pillStats.correct)} از{' '}
              {toArabicIndic(pillStats.total)}
            </span>
          ) : (
            <span className={`hifz-pill ${accuracyPillClass(accuracyTone)}`}>
              <span className="hifz-pill-label">{labels.pillAccuracy}: </span>{formatArabicIndicDecimal(pillStats.accuracy)}٪
            </span>
          )}
          {liveState === 'listening' && (
            <span className="hifz-pill hifz-pill-gray hifz-pill-timer">
              <span className="hifz-pill-dot" aria-hidden="true" />
              <span className="hifz-pill-label">{labels.pillTimer}: </span>{timerText}
            </span>
          )}
        </div>
      )}

      {/* The blank line page: faint markers from the start, words
          written in Uthmanic font as recited. While the line data
          loads, a loading note; on page failure, the wall below
          takes over entirely (see svgFailedNote). Performance (§8):
          the note waits for V2 — or, when V2 failed, for the
          fallback old lines — but NOT for the old lines on a healthy
          V2 load: they are fallback-only now and stay unloaded. */}
      {(v2Data === undefined || (v2Data === null && mushafPages === undefined)) && (
        <p className="hifz-line-loading">{labels.loadingPage}</p>
      )}
      {pageReady && textsReady && displayMode === 'page' && renderPageSection(activePageIndex ?? 0, renderLines, 'page')}
      {pageReady && textsReady && displayMode === 'card' && (
        <div className="hifz-card-frame">{renderPageSection(activePageIndex ?? 0, renderLines, 'card')}</div>
      )}
      {pageReady && textsReady && displayMode === 'scroll' && (
        <div className="hifz-scroll-pages">
          {surahPageIndices.map((pIdx) => {
            // Phase 3: each scroll page renders from V2 first; the
            // old page holding the same first ayah is the fallback
            // (page spans differ between editions, so the old page
            // is found by ayah, never by index).
            if (useV2 && v2Data) {
              const v2p = v2Data.pages[pIdx];
              if (v2p) {
                const v2pr = buildV2PageRender(v2Data, v2p, surah, textsBySurah, wallAyahs);
                if (v2pr) return renderPageSection(pIdx, v2pr.renderLines, `scroll-${pIdx}`);
                const first = v2FirstAyahOfSurahOnPage(v2p, surah);
                const oldIdx =
                  first !== null && mushafPages ? pageIndexFor(mushafPages, surah, first) : null;
                if (oldIdx !== null) {
                  const oldLines = mushafPages?.[oldIdx];
                  if (oldLines) {
                    const oldPr = buildPageRender(oldLines, surah, textsBySurah[surah], wallAyahs);
                    return renderPageSection(pIdx, oldPr.renderLines, `scroll-${pIdx}`);
                  }
                }
                return null;
              }
            }
            const lines = mushafPages?.[pIdx];
            if (!lines) return null;
            const pr = buildPageRender(lines, surah, textsBySurah[surah], wallAyahs);
            return renderPageSection(pIdx, pr.renderLines, `scroll-${pIdx}`);
          })}
        </div>
      )}
      {pageReady && !textsReady && (
        <div className="hifz-line-loading">
          {textsFailed ? (
            <>
              {labels.textsFailed}{' '}
              <button
                type="button"
                onClick={() => {
                  setTextsFailed(false);
                  setTextsReload((n) => n + 1);
                }}
              >
                {labels.textsRetry}
              </button>
            </>
          ) : (
            labels.loadingPage
          )}
        </div>
      )}

      {/* The wall: everything when the page failed, otherwise only the
          ayahs whose words are NOT placed on the line page. Nothing
          written yet on a ready page means no wall section at all (the
          blank page above is the whole state). While the surah texts
          still load, the wall stays hidden: placement is undecided
          until they arrive, and showing the whole surah below would
          repeat the silent fallback. */}
      {(pageFailed || (pageReady && textsSettled && unplacedGroups.length > 0)) && (
      <section className="hifz-wall" aria-label={labels.title}>
        {pageFailed && <p className="hifz-line-failed-note">{labels.svgFailedNote}</p>}
        {(pageFailed ? wallAyahs : unplacedGroups).length === 0 ? (
          <p className="hifz-wall-empty">{labels.wallHint}</p>
        ) : (
          (pageFailed ? wallAyahs : unplacedGroups).map((group) => (
            <div key={group.ayah} className="hifz-wall-ayah">
              <p className="hifz-wall-ref">
                {surahName} — {toArabicIndic(group.ayah)}
              </p>
              <div className="hifz-wall-words" dir="rtl">
                {group.words.map((word) => {
                  // Phase 4 — Hide the script: a written wall word
                  // becomes a dotted placeholder; tapping it reveals
                  // just that word (same gradual reveal as the page;
                  // applies in both modes, like the line page).
                  const wallKey = `${surah}:${group.ayah}:${word.index}`;
                  if (
                    scriptHidden &&
                    word.status !== 'peeked' &&
                    !revealedWords.has(wallKey)
                  ) {
                    return (
                      <button
                        type="button"
                        key={word.index}
                        className="hifz-word hifz-line-word-concealed"
                        onClick={() =>
                          setRevealedWords((prev) => new Set(prev).add(wallKey))
                        }
                        aria-label={labels.showScript}
                      >
                        <span aria-hidden="true">{renderTajweedText(word.text)}</span>
                      </button>
                    );
                  }
                  const isPractice =
                    practiceWord?.ayah === group.ayah && practiceWord?.index === word.index;
                  const newestLive =
                    liveWords.length > 0 ? liveWords[liveWords.length - 1] : null;
                  const isNewestLive =
                    word.live &&
                    newestLive !== null &&
                    newestLive.ayah === group.ayah &&
                    newestLive.word_index === word.index;
                  const newestTone =
                    isNewestLive && (word.status === 'wrong' || word.status === 'close')
                      ? 'hifz-word-live-new-wrong'
                      : 'hifz-word-live-new';
                  const tone =
                    word.status === 'peeked'
                      ? 'hifz-word-peeked'
                      : word.live
                        ? isNewestLive
                          ? `hifz-word-live ${newestTone}`
                          : 'hifz-word-live'
                        : `hifz-word-${word.status}`;
                  return (
                    <span
                      key={word.index}
                      className={['hifz-word', tone, isPractice ? 'hifz-word-practice' : ''].join(
                        ' ',
                      )}
                    >
                      <button
                        type="button"
                        className="hifz-word-text"
                        onClick={() =>
                          setPracticeWord({ ayah: group.ayah, index: word.index, text: word.text })
                        }
                        title={labels.practiceWordHint}
                      >
                        {renderTajweedText(word.text)}
                      </button>
                      {!word.live &&
                        word.status !== 'peeked' &&
                        (word.status === 'wrong' || word.status === 'close') &&
                        word.scoreId &&
                        !word.disputed && (
                          <button
                            type="button"
                            className="hifz-word-dispute"
                            onClick={() => void disputeWord(word.scoreId as string)}
                          >
                            {labels.dispute}
                          </button>
                        )}
                      {word.disputed && (
                        <span className="hifz-word-disputed">{labels.disputed}</span>
                      )}
                      {word.status === 'peeked' && (
                        <span className="hifz-word-peeked-tag">{labels.revealedByPeek}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>
      )}

      {practiceWord !== null && (
        <p className="hifz-practice-note">
          {labels.practiceWord}: {practiceWord.text}{' '}
          <button type="button" onClick={() => setPracticeWord(null)}>
            {labels.clearPractice}
          </button>
        </p>
      )}

      {/* Bottom bar (Tarteel): peek, error sheet, previous/next ayah,
          previous/next page. The error sheet opens by hand during
          the session (never as an end-of-session results page).
          Phase 6: hide + peek-word + peek-ayah share one white
          capsule (frames: eye, <, << in one capsule), and the book
          (errors) sits last in DOM so it renders at the far left
          of the RTL row, as in the frames. The settings / prev /
          next buttons are the academy's own controls (no Tarteel
          equivalent) and keep their relative order. */}
      <div className="hifz-bottom-bar">
        <span className="hifz-bottom-capsule">
          <button
            type="button"
            disabled={!peekTarget}
            onClick={() => void peekAyah()}
            title={labels.peekAyahHint}
          >
            {labels.peekAyah}
          </button>
          <button
            type="button"
            disabled={!peekTarget}
            onClick={() => void peekNext()}
            title={labels.peekWordHint}
          >
            {labels.peekWord}
          </button>
          {/* Phase 4 — Hide the script (crossed-eye): written words
              become dotted placeholders; tapping one reveals just that
              word. «Show» re-reveals everything at once. */}
          <button
            type="button"
            aria-pressed={scriptHidden}
            onClick={() => {
              setScriptHidden((v) => !v);
              setRevealedWords(new Set());
            }}
          >
            {scriptHidden ? labels.showScript : labels.hideScript}
          </button>
        </span>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          {labels.settingsOpen}
        </button>
        <button
          type="button"
          disabled={ayah <= 1}
          onClick={() => setAyah((a) => Math.max(1, a - 1))}
        >
          {labels.prevAyah}
        </button>
        <button
          type="button"
          disabled={ayahCount > 0 && ayah >= ayahCount}
          onClick={() => setAyah((a) => (ayahCount > 0 ? Math.min(ayahCount, a + 1) : a + 1))}
        >
          {labels.nextAyah}
        </button>
        <button
          type="button"
          disabled={activePageIndex === null || activePageIndex <= 0}
          onClick={() => {
            if (activePageIndex === null) return;
            const prev = activePageIndex - 1;
            // Phase 3: the V2 page's first ayah of this surah; the
            // old lines keep their own page index.
            if (useV2 && v2Data) {
              const first = v2FirstAyahOfSurahOnPage(v2Data.pages[prev], surah);
              if (first !== null) setAyah(first);
              return;
            }
            if (!mushafPages) return;
            const lines = mushafPages[prev];
            if (!lines) return;
            for (const line of lines) {
              if (line.t === 'text' && line.v) {
                const [s, a] = line.v.split(':').map(Number);
                if (s === surah) {
                  setAyah(a);
                  return;
                }
              }
            }
          }}
        >
          {labels.prevPage}
        </button>
        <button
          type="button"
          disabled={
            activePageIndex === null ||
            (useV2
              ? !v2Data || activePageIndex >= v2Data.pages.length - 1
              : !mushafPages || activePageIndex >= mushafPages.length - 1)
          }
          onClick={() => {
            if (activePageIndex === null) return;
            const next = activePageIndex + 1;
            if (useV2 && v2Data) {
              const first = v2FirstAyahOfSurahOnPage(v2Data.pages[next], surah);
              if (first !== null) setAyah(first);
              return;
            }
            if (!mushafPages) return;
            const lines = mushafPages[next];
            if (!lines) return;
            for (const line of lines) {
              if (line.t === 'text' && line.v) {
                const [s, a] = line.v.split(':').map(Number);
                if (s === surah) {
                  setAyah(a);
                  return;
                }
              }
            }
          }}
        >
          {labels.nextPage}
        </button>
        {/* Errors (the book): last in DOM = far left of the RTL row,
            as in the Tarteel frames. */}
        <button
          type="button"
          onClick={() => setErrorSheetOpen(true)}
          aria-label={labels.errorsOpen}
        >
          {labels.errorsTitle}
        </button>
      </div>

      {/* Display-mode menu (bottom): page-flip / scrolling / card. */}
      <div className="hifz-display-menu" role="group" aria-label={labels.displayMode}>
        <span className="hifz-display-label">{labels.displayMode}</span>
        <button
          type="button"
          aria-pressed={displayMode === 'page'}
          className={displayMode === 'page' ? 'is-active' : ''}
          onClick={() => setDisplayModePersist('page')}
        >
          {labels.displayPage}
        </button>
        <button
          type="button"
          aria-pressed={displayMode === 'scroll'}
          className={displayMode === 'scroll' ? 'is-active' : ''}
          onClick={() => setDisplayModePersist('scroll')}
        >
          {labels.displayScroll}
        </button>
        <button
          type="button"
          aria-pressed={displayMode === 'card'}
          className={displayMode === 'card' ? 'is-active' : ''}
          onClick={() => setDisplayModePersist('card')}
        >
          {labels.displayCard}
        </button>
      </div>

      <div className="hifz-controls">
        {/* Phase 4 — freeze hold: the capture paused on a wrong word
            because freeze_on_error is ON; the user corrects the word
            and taps continue. */}
        {freezeHold && (
          <p className="hifz-error" role="alert">
            {labels.freezeHold}{' '}
            <button type="button" onClick={() => resumeLive()}>
              {labels.freezeResume}
            </button>
          </p>
        )}
        {isZipformer && liveState === 'listening' && (
          <button type="button" onClick={pauseLive}>
            {labels.pauseLive}
          </button>
        )}
        {isZipformer && liveState === 'paused' && (
          <>
            <button type="button" onClick={resumeLive}>
              {labels.resumeLive}
            </button>
            <p className="hifz-hint">{labels.pausedHint}</p>
          </>
        )}
        {isZipformer && modelUnavailable && (
          <p className="hifz-hint">{labels.modelUnavailable}</p>
        )}
        {isOffline && (
          <p className="hifz-error" role="alert">
            {labels.offline}
          </p>
        )}
        {isZipformer && liveStarting && (
          <button type="button" onClick={() => cancelLive(false)}>
            {labels.liveCancel}
          </button>
        )}
        {isZipformer && liveState === 'requesting_permission' && (
          <p className="hifz-hint">{labels.liveRequestingPermission}</p>
        )}
        {isZipformer && liveState === 'engine_loading' && (
          <p className="hifz-hint">{labels.liveEngineLoading}</p>
        )}
        {isZipformer && liveState === 'listening' && (
          <p className="hifz-hint">
            {labels.liveListening}
            {livePartial !== null && (
              <>
                {' '}
                {labels.liveReadingNow} {livePartial}
              </>
            )}
          </p>
        )}
        {isZipformer && liveState === 'stopping' && (
          <p className="hifz-hint">{labels.liveStopping}</p>
        )}
        {isZipformer && liveState === 'interrupted' && (
          <p className="hifz-hint">{labels.liveInterrupted}</p>
        )}
        {isZipformer && liveState === 'ended' && <p className="hifz-hint">{labels.liveEnded}</p>}
        {isZipformer && liveDiag.capture === 'legacy' && liveState !== 'idle' && (
          <p className="hifz-hint">{labels.liveLegacyCapture}</p>
        )}
        {isZipformer && liveWarning !== null && (
          <p className="hifz-hint">{liveWarning}</p>
        )}
        {isZipformer && liveState !== 'idle' && (
          <p className="hifz-hint">
            {labels.liveDiagSampleRate}: {liveDiag.sampleRate ?? '—'} Hz · {labels.liveDiagFrames}:{' '}
            {liveDiag.frames} · {labels.liveDiagCapture}:{' '}
            {liveDiag.capture === 'worklet'
              ? 'AudioWorklet'
              : liveDiag.capture === 'legacy'
                ? 'ScriptProcessor'
                : '—'}
            {liveDiag.dropped > 0 && (
              <>
                {' '}· {labels.liveDiagDropped}: {liveDiag.dropped}
              </>
            )}
            {' '}· {labels.liveDiagSocket}:{' '}
            {liveState === 'listening'
              ? labels.liveListening
              : liveState === 'connecting'
                ? labels.liveConnecting
                : liveState === 'requesting_permission'
                  ? labels.liveRequestingPermission
                  : liveState === 'engine_loading'
                    ? labels.liveEngineLoading
                    : liveState === 'interrupted'
                      ? labels.liveInterrupted
                      : liveState === 'stopping'
                        ? labels.liveStopping
                        : labels.liveEnded}
          </p>
        )}
        {isWhisper && <p className="hifz-hint">{labels.liveOnlyZipformer}</p>}
        {isWhisper && recState === 'recording' && <p className="hifz-hint">{labels.recording}</p>}
        {!authed && <p className="hifz-hint">{labels.signInHint}</p>}
      </div>
      {/* Mutashabihat (shared phrases, computed from our Tanzil
          text) + link to the separate hifz hub. No results, stats
          or history are added to the study page itself. */}
      <HifzMutashabihat
        surah={surah}
        ayah={ayah}
        onNavigate={(s, a) => {
          setSurah(s);
          setAyah(a);
        }}
        labels={labels.mutashabihat}
      />
      <p className="hifz-hub-link">
        <a href={`/${locale}/quran/hifz`}>{labels.hubLink}</a>
      </p>
      {/* Floating mic (bottom-right, Tarteel): the only record
          control; its action follows the engine. Shown only in
          practice mode — listen mode has its own play control. */}
      {studyMode === 'practice' && (isZipformer || isWhisper) && (
        <div className="hifz-mic-layer">
          <button
            type="button"
            className={`hifz-mic-3d${micActive ? ' is-live' : ''}`}
            aria-label={micLabel}
            disabled={!authed || micBusy || modelUnavailable}
            onClick={micOnClick}
            onPointerDown={onMicPointerDown}
            onPointerUp={clearMicLongPress}
            onPointerLeave={clearMicLongPress}
            onPointerCancel={clearMicLongPress}
            onContextMenu={(e) => e.preventDefault()}
            title={labels.listenLongPressSwitch}
          >
            {micActive ? (
              <span className="hifz-mic-stop" aria-hidden="true" />
            ) : (
              <MicIcon />
            )}
          </button>
        </div>
      )}
      {liveError && (
        <p className="hifz-error" role="alert">
          {liveError}
        </p>
      )}
      {error && (
        <p className="hifz-error" role="alert">
          {error}
        </p>
      )}

      <HifzSettingsSheet
        open={settingsOpen}
        settings={hifzSettings}
        labels={labels}
        onChange={(next) => void saveHifzSettings(next)}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Error sheet (bottom sheet, opened by hand during the
          session): wrong words (expected vs recited) and extra words.
          No end-of-session results page exists. Phase 4: the
          server-side groups render as one card per ayah — expected
          (green) vs recited (red) with a «surah:ayah» label, plus a
          per-item delete. Without a server group (guest / load
          failed), the local live/graded words render as before. */}
      {/* Error sheet (bottom sheet, opened by hand during the
          session): wrong words (expected vs recited) and extra words.
          No end-of-session results page exists. Phase 4: the
          server-side groups render as one card per ayah — expected
          (green) vs recited (red) with a «surah:ayah» label, plus a
          per-item delete. Without a server group (guest / load
          failed), the local live/graded words render as before.
          Phase 6: Tarteel card layout — eye-slash icon + category +
          «surah:ayah» chip in the card head; expected (green) and
          heard (red) as two rows with side labels; the info pill at
          the bottom. The expected text is no longer printed twice
          (it used to appear both large and inside the meta line). */}
      {errorSheetOpen && (
        <>
          <div
            className="hifz-sheet-backdrop"
            aria-hidden="true"
            onClick={() => setErrorSheetOpen(false)}
          />
          <div className="hifz-error-sheet" role="dialog" aria-modal="true" aria-label={labels.errorsTitle}>
            <span className="hifz-sheet-handle" aria-hidden="true" />
            <div className="hifz-error-sheet-head">
              <h3>{labels.errorsTitle}</h3>
              <button type="button" onClick={() => setErrorSheetOpen(false)}>
                {labels.errorsClose}
              </button>
            </div>
            {groupedMistakes !== null ? (
              groupedMistakes.length === 0 ? (
                <p>{labels.errorsEmpty}</p>
              ) : (
                groupedMistakes.map((group) => (
                  <article
                    key={`${group.surah}:${group.ayah}:${group.category}`}
                    className="hifz-error-card"
                  >
                    <div className="hifz-error-card-head">
                      <svg className="hifz-error-card-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 10 7-.4.7-1 1.6-1.9 2.5M6.6 6.6C4.9 7.9 3.4 9.9 2 12c1.5 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      <span className="hifz-error-card-cat">
                        {group.category === 'wrong_words' ? labels.errorsWrong : labels.errorsExtra}
                      </span>
                      <span className="hifz-error-card-chip">
                        {toArabicIndic(group.surah)}:{toArabicIndic(group.ayah)}
                      </span>
                    </div>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.id} className="hifz-error-item">
                          {item.mistake_type === 'transposed' && (
                            <p className="hifz-error-meta">{labels.errorsTransposed}</p>
                          )}
                          {group.category === 'wrong_words' ? (
                            <>
                              <p className="hifz-error-row">
                                <span className="hifz-error-expected">{item.expected_text}</span>
                                <span className="hifz-error-row-label">{labels.errorsExpected}</span>
                              </p>
                              {item.heard && (
                                <p className="hifz-error-row">
                                  <span className="hifz-error-heard">{item.heard}</span>
                                  <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="hifz-error-row">
                              <span className="hifz-error-heard">{item.heard}</span>
                              <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                            </p>
                          )}
                          <button
                            type="button"
                            className="hifz-error-delete"
                            onClick={() => void deleteMistake(item.id)}
                          >
                            {labels.errorsDelete}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))
              )
            ) : (
              <>
                <article className="hifz-error-card">
                  <div className="hifz-error-card-head">
                    <span className="hifz-error-card-cat">{labels.errorsWrong}</span>
                  </div>
                  {errorWords.length === 0 ? (
                    <p>{labels.errorsEmpty}</p>
                  ) : (
                    <ul>
                      {errorWords.map((w) => (
                        <li key={`${w.ayah}:${w.index}`} className="hifz-error-item">
                          <p className="hifz-error-row">
                            <span className="hifz-error-expected">{w.expected}</span>
                            <span className="hifz-error-row-label">{labels.errorsExpected}</span>
                          </p>
                          {w.heard && (
                            <p className="hifz-error-row">
                              <span className="hifz-error-heard">{w.heard}</span>
                              <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                            </p>
                          )}
                          <span className="hifz-error-card-chip">
                            {toArabicIndic(surah)}:{toArabicIndic(w.ayah)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
                <article className="hifz-error-card">
                  <div className="hifz-error-card-head">
                    <span className="hifz-error-card-cat">{labels.errorsExtra}</span>
                  </div>
                  {liveExtraWords.length === 0 && liveExtraCount === 0 ? (
                    <p>{labels.errorsEmpty}</p>
                  ) : liveExtraWords.length > 0 ? (
                    <ul>
                      {liveExtraWords.map((t, i) => (
                        <li key={i} className="hifz-error-item">
                          <p className="hifz-error-row">
                            <span className="hifz-error-heard">{t}</span>
                            <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {labels.errorsExtra}: {toArabicIndic(liveExtraCount)}
                    </p>
                  )}
                </article>
              </>
            )}
            <p className="hifz-error-learn">
              <span className="hifz-error-learn-icon" aria-hidden="true">
                i
              </span>
              {labels.errorsLearn}
            </p>
          </div>
        </>
      )}

      <p className="hifz-disclaimer">{labels.disclaimer}</p>
    </div>
  );
}
