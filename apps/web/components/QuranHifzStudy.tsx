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
 * tajweed letters colored per lib/quran-tajweed (green ghunnah only
 * for shaddad nun/mim, dark-blue tafkhim, light-blue qalqalah, madd
 * in dark-red / orange-red / light-orange / yellow, gray silent
 * letters; ikhfaa is NOT coloured and there is no pink in the
 * palette); the newest word
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
  parseStoredListenSpeed,
  type ListenRepeatMode,
  type ListenRepeatRange,
} from '@/lib/hifz-player';
import { HifzRosette } from './hifz-study/HifzRosette';
import { HifzSettingsSheet } from './hifz-study/HifzSettingsSheet';
import { HifzErrorSheet } from './hifz-study/HifzErrorSheet';
import { HifzDisplaySheet, type HifzDisplayMode } from './hifz-study/HifzDisplaySheet';
import { HifzStudyHeader } from './hifz-study/HifzStudyHeader';
import { HifzSearchSheet } from './hifz-study/HifzSearchSheet';
import { QuranPickerSheet } from './QuranPickerSheet';
import type { QuranSearchLabels } from './QuranSearchBox';
import { loadBookmarks, pageBookmarkId, saveBookmarks } from '@/lib/quran-bookmarks';
import { DEFAULT_SVG_MUSHAF } from '@/lib/quran-svg-page';
import { HifzLivePills } from './hifz-study/HifzLivePills';
import { HifzNumericInput } from './HifzNumericInput';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import { loadMushafLines, type MushafExactLine } from '@/lib/quran-mushaf-lines';
import {
  loadV2Index,
  loadV2Page,
  v2FirstAyahOfSurahOnPage,
  v2PageAyahs,
  v2PageIndexForAyah,
  type V2MushafIndex,
  type V2Page,
} from '@/lib/quran-mushaf-v2';
import {
  loadV4PageGlyphs,
  shouldUseV4Glyph,
  type V4PageGlyphs,
} from '@/lib/quran-mushaf-v4';
import {
  ensureMushafFontFor,
  qcfV4Provider,
  useMushafFontReadyFor,
} from '@/lib/quran-mushaf-font';
import {
  ARABIC_INDIC,
  formatArabicIndicDuration,
  toArabicIndic,
} from '@/lib/quran-print-lines';
import { colorizeTajweedWord } from '@/lib/quran-tajweed';
import { editionDisplayName } from '@/lib/quran-editions';
import { rangeContaining, type RangeKind } from '@/lib/quran-view-modes';
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

/** The three Tarteel display modes (bottom sheet, 2026-11-08):
    mushaf (printed Madinah page, swipe to turn), nass (scrolling
    Uthmani text) and translation (scrolling, read-only). Stored in
    the same 'hifz-display-mode' key as the old page/scroll/card
    modes; legacy values map: page/card -> mushaf, scroll -> nass. */
type DisplayMode = HifzDisplayMode;
const DISPLAY_MODE_KEY = 'hifz-display-mode';
function readDisplayMode(): DisplayMode {
  try {
    const v = window.localStorage.getItem(DISPLAY_MODE_KEY);
    if (v === 'mushaf' || v === 'nass' || v === 'translation') return v;
    // Legacy values (pre-Tarteel sheet): page/card were the printed
    // page, scroll was the scrolling view.
    if (v === 'page' || v === 'card') return 'mushaf';
    if (v === 'scroll') return 'nass';
  } catch {
    /* storage unavailable */
  }
  return 'mushaf';
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

/** Latin digits for the recitation-toolbar pill ONLY (user decision
    2026-11-10 ~11:12: the pill shows «100% | 0» in English
    digits). Same one-decimal precision as formatArabicIndicDecimal
    (whole numbers get no separator, 99.5 stays «99.5»), but
    Western digits with '.'. Everything else in the app keeps
    Eastern Arabic digits. */
function formatLatinDecimal(value: number, fractionDigits = 1): string {
  const fixed = value.toFixed(fractionDigits);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}


const HIFZ_API = '/api/v1/quran/hifz';

export function QuranHifzStudy({
  locale,
  surahList,
  initialSurah,
  initialAyah,
  initialPageTarget,
  initialTexts,
  labels,
  reciterPhotos,
  initialTranslations,
  translationEditions,
  defaultTranslation,
  searchLabels,
}: {
  locale: string;
  surahList: SurahSummary[];
  initialSurah: number;
  /** Deep-link hint (?ayah=): the ayah the session starts from.
    It is only a hint — the live session locates the recited ayah
    from the audio and the page follows it. */
  initialAyah: number | null;
  /** Hifz identity (2026-11-08): ?view=page&target=N deep-link
    page (from the reader shell; null when the hifz tab was opened
    without a page view). The study starts on that page's first
    ayah instead of the surah's first page. An explicit ?ayah=
    wins over the target. */
  initialPageTarget?: number | null;
  /** Ignored: the line data is always Hafs (see header). */
  initialMushaf: string;
  /** Ayah texts of the initial surah, from the server render. */
  initialTexts: Record<number, string>;
  labels: HifzLabels;
  /** Phase 5: reciter photos by AlQuran Cloud edition id (from the
      CRM providers payload, threaded through the reader). Unused
      since the listen mini player was removed (2026-11-08) — kept
      in the props so the player can return without re-threading. */
  reciterPhotos?: Record<string, string | null>;
  /** Translation mode (Tarteel sheet, 2026-11-08): the default
      edition's per-ayah translation of the initial surah, from the
      server render — same source as the reader's ayah view. Other
      active editions load on demand (see the translation effect). */
  initialTranslations?: Record<number, string>;
  /** Active translation editions (CRM quran.translations, e.g.
      ['en.sahih', 'fa.makarem']) shown in translation mode. */
  translationEditions?: string[];
  /** The default (server-loaded) translation edition id. */
  defaultTranslation?: string | null;
  /** Labels for the one Quran search (QuranSearchBox in the search
      sheet, opened from the top bar) — threaded through from the
      reader, same object the reader itself receives. */
  searchLabels: QuranSearchLabels;
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
  // Translation mode (Tarteel sheet): per-ayah translations keyed
  // `${surah}:${edition}`. The default edition of the initial surah
  // arrives with the server render; every other active edition (and
  // every other surah) loads on demand when translation mode is
  // open — same /api/v1/quran/surah fetch the neighbour texts use.
  const [translationsByKey, setTranslationsByKey] = useState<
    Record<string, Record<number, string>>
  >(() =>
    initialTranslations &&
    Object.keys(initialTranslations).length > 0 &&
    defaultTranslation
      ? { [`${initialSurah}:${defaultTranslation}`]: initialTranslations }
      : {},
  );
  const [trLoading, setTrLoading] = useState(false);
  const [trFailed, setTrFailed] = useState(false);
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
  // Tarteel display sheet (2026-11-08): the bottom sheet that
  // picks mushaf / nass / translation (replaces the old bottom
  // display menu). The eye + settings now live in the top bar.
  const [displaySheetOpen, setDisplaySheetOpen] = useState(false);
  // Tarteel top bar (2026-11-08): the Quran search sheet (opened
  // by the magnifier) and the page bookmark on the surah card.
  // The bookmark is localStorage, the same store the reader uses
  // (quran-bookmarks-v1); the study page is always Hafs, so the
  // bookmark id uses the default mushaf key. `null` = no page on
  // screen yet (the card renders without a bookmark icon).
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  /** Quran index sheet (user 2026-11-10): opened from the surah
      card in the top bar. Owned here — not the reader's instance —
      so picking stays in hifz. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState<boolean | null>(null);
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

  // Phase 3 (hifz redesign) + round 2 §8 (per-page chunks): the V2
  // index loads once (fetch from public/, preloaded from the page
  // head on the hifz tab — lib/quran-mushaf-v2) and each page's layout
  // loads as its own tiny chunk (see the v2Pages effect below). While
  // the index loads the page waits; if it fails (null) the old lines
  // render (see the fallback-only loads below).
  // Per-page V2 layout chunks loaded so far, keyed by 0-based page
  // index (round 2 §8): undefined = not loaded yet, null = the chunk
  // (and the full-data fallback) failed, V2Page = loaded. The loader
  // promise-caches per page, so re-renders never re-fetch.
  const [v2Index, setV2Index] = useState<V2MushafIndex | null | undefined>(undefined);
  const [v2Pages, setV2Pages] = useState<Record<number, V2Page | null>>({});
  // QPC V4 Tajweed glyphs (2026-11-08): this page's
  // "surah:ayah:word" → glyph-string map. Tri-state like the
  // reader's v2Glyphs: undefined = still loading, null = unavailable
  // (the whole page falls back to Tanzil text), map = ready. Cleared
  // on page change so a stale page's map can never render under the
  // new page (see the clear effect next to the v2Pages effect).
  const [v4Glyphs, setV4Glyphs] = useState<V4PageGlyphs | null | undefined>(undefined);
  // Whether the current page's V4 font REALLY loaded (tri-state:
  // undefined = load still pending, true = loaded, false = failed or
  // timed out). The useMushafFontReadyFor hook below settles true on
  // timeout too (it only gates the placeholder), so the glyph branch
  // in renderLineWord keys on this boolean, never on the hook —
  // otherwise a timed-out font would paint tofu PUA.
  const [v4FontLoaded, setV4FontLoaded] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadV2Index().then((index) => {
      if (!cancelled) setV2Index(index);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hifz identity (2026-11-08): a ?view=page&target=N deep link
  // starts the study on page N — its first ayah — not on the
  // surah's first page. An explicit ?ayah= wins over the target.
  // Applied once, when the V2 index arrives: pageFirstAyahs
  // carries the first ayah BEGINNING on each page (every one of
  // the 604 pages has an entry). If the index failed outright, the
  // boundaries' page starts are the fallback (they only load on
  // V2 failure). A target in another surah moves the surah too —
  // resumeAyahRef carries the ayah across the surah-change reset
  // in the texts effect, the same pattern the resume button uses.
  const targetPageAppliedRef = useRef(false);
  useEffect(() => {
    if (targetPageAppliedRef.current) return;
    if (initialPageTarget === null || initialPageTarget === undefined) return;
    if (initialAyah !== null) return;
    let first: { surah: number; ayah: number } | null = null;
    if (v2Index !== undefined && v2Index !== null) {
      const entry = v2Index.pageFirstAyahs.find(([, , p]) => p === initialPageTarget);
      if (entry) first = { surah: entry[0], ayah: entry[1] };
    } else if (v2Index === null && boundaries) {
      const entry = boundaries.page[initialPageTarget - 1];
      if (entry) first = { surah: entry.surah, ayah: entry.ayah };
    } else {
      return; // index still loading (or boundaries not yet loaded)
    }
    if (!first) return;
    targetPageAppliedRef.current = true;
    if (first.surah !== surah) {
      resumeAyahRef.current = first.ayah;
      setSurah(first.surah);
      setAyah(first.ayah);
    } else {
      setAyah(first.ayah);
    }
  }, [v2Index, boundaries, initialPageTarget, initialAyah, surah]);

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

  // Nass mode (Tarteel sheet): the same written-word map the page
  // render builds internally, so hide/reveal, peek and grades work
  // identically on the scrolling text. Keys are `${ayah}:${index}`.
  const nassWrittenByKey = useMemo(() => {
    const m = new Map<string, WallWord>();
    for (const group of wallAyahs) {
      for (const w of group.words) m.set(`${group.ayah}:${w.index}`, w);
    }
    return m;
  }, [wallAyahs]);

  // Ayah numbers of the current surah, for the nass / translation
  // scrolling views.
  const ayahNumbers = useMemo(
    () => Array.from({ length: ayahCount }, (_, i) => i + 1),
    [ayahCount],
  );

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
  const useV2 = v2Index !== undefined && v2Index !== null;
  const v2PageIndex = useMemo(
    () => (v2Index ? v2PageIndexForAyah(v2Index, surah, ayah) : null),
    [v2Index, surah, ayah],
  );
  const activePageIndex = useV2 ? v2PageIndex : pageIndex;
  // Tri-state: undefined = the chunk is still loading (the page
  // waits), null = the chunk failed (the old-lines fallback takes
  // over), V2Page = loaded. (A plain ?? would collapse failed into
  // loading, so the key presence is tested explicitly.)
  const activeV2Page =
    useV2 && v2PageIndex !== null
      ? v2PageIndex in v2Pages
        ? v2Pages[v2PageIndex]
        : undefined
      : null;
  const pageReady =
    useV2
      ? activeV2Page !== undefined && activeV2Page !== null
      : pageLines !== null;
  const pageFailed = mushafPages !== undefined && v2Index !== undefined && !pageReady;
  // Surah texts settled (loaded, or failed): only then may the wall
  // claim an ayah is unplaced. While they still load, placedAyahs is
  // empty by construction and the wall would wrongly swallow the
  // whole surah, so both the page and the wall wait.
  const textsReady = textsBySurah[surah] !== undefined;
  const textsSettled = textsReady || textsFailed;

  // The current printed page number (1-based), for the V4 font and
  // glyph map. The family is per-page (QCF4NNN_COLOR), so it comes
  // from the page here, never from static CSS. Null when there is no
  // active page (old-lines fallback path) — glyphs never apply there.
  const v4PageNumber = activePageIndex !== null ? activePageIndex + 1 : null;
  const v4FontFamily =
    v4PageNumber !== null
      ? (qcfV4Provider.familyForPage(v4PageNumber)?.family ?? null)
      : null;
  // Placeholder gate, mirroring the reader's useMushafFontReady:
  // while false the mushaf section shows blank placeholder lines of
  // the same count/line-height, never tofu or a wrong-font flash.
  // Settles true on timeout/failure too — the glyph branch
  // additionally requires v4FontLoaded === true (see above).
  const v4FontReady = useMushafFontReadyFor(qcfV4Provider, v4PageNumber ?? 1);

  // The current page's render lines (placed ayahs + line slots),
  // built by the pure buildPageRender helper. Scroll mode calls the
  // same helper for every page of the surah. Phase 3: the V2 page
  // renders first (buildV2PageRender); a null result falls back to
  // the old lines for the same page, never a half-mixed page.
  const pageRender = useMemo(() => {
    if (useV2 && activeV2Page && v2Index) {
      const v2 = buildV2PageRender(
        v2Index,
        activeV2Page,
        surah,
        textsBySurah,
        wallAyahs,
        undefined,
        v4Glyphs,
      );
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
  }, [useV2, activeV2Page, v2Index, pageLines, textsBySurah, surah, wallAyahs, v4Glyphs]);
  const { placedAyahs, renderLines, usedV2 } = pageRender;

  // Phase 3: a V2 page spanning a surah boundary needs the neighbor
  // surah's texts too (the study surah alone is not enough). Load
  // them into the same cache; until they arrive the page renders
  // from the old lines, then switches to V2. A failed neighbor load
  // just keeps the old-lines rendering — never a broken page.
  useEffect(() => {
    if (!v2Index || !activeV2Page) return;
    const needed = new Set(v2PageAyahs(activeV2Page).map((r) => Number(r.split(':')[0])));
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
  }, [v2Index, activeV2Page, surah, textsBySurah]);

  // Translation mode (Tarteel sheet): when it is open, every active
  // edition for the current surah must be loaded. The default
  // edition of the initial surah arrives with the server render;
  // the rest (and every other surah) fetch here, once per
  // surah+edition, and stay cached in translationsByKey. A failed
  // fetch leaves the mode showing the editions that did load plus
  // the honest unavailable note — never a broken page.
  const activeTranslationEditions = useMemo(() => {
    const list = (translationEditions ?? []).filter(Boolean);
    if (list.length > 0) return list;
    return defaultTranslation ? [defaultTranslation] : [];
  }, [translationEditions, defaultTranslation]);
  useEffect(() => {
    if (displayMode !== 'translation') return;
    if (activeTranslationEditions.length === 0) return;
    const missing = activeTranslationEditions.filter(
      (ed) => translationsByKey[`${surah}:${ed}`] === undefined,
    );
    if (missing.length === 0) return;
    let cancelled = false;
    setTrLoading(true);
    setTrFailed(false);
    void (async () => {
      let failed = false;
      for (const ed of missing) {
        if (cancelled) return;
        try {
          const view = await getSurah(surah, { translation: ed, translationEdition: ed });
          if (cancelled) return;
          const tr: Record<number, string> = {};
          for (const a of view.ayahs) if (a.translation) tr[a.number] = a.translation;
          setTranslationsByKey((prev) => ({ ...prev, [`${surah}:${ed}`]: tr }));
        } catch {
          failed = true;
        }
      }
      if (!cancelled) {
        setTrFailed(failed);
        setTrLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayMode, surah, activeTranslationEditions, translationsByKey]);

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
  // ayahs.
  // Hifz identity (2026-11-08): the displayed حزب is the 60-scale
  // hizb Tarteel shows (same display rule as the umum reader's
  // toDisplayHizb: ceil(n / 2) — 24→12, 59→30, 117→59). The stored
  // data stays 120-scale; only this header converts. The old note
  // that kept the 120-scale here is superseded by this decision.
  const headerMeta = useMemo(() => {
    const toDisplayHizb = (h: number | null): number | null =>
      h === null ? null : Math.ceil(h / 2);
    if (activeV2Page) {
      return {
        page: activeV2Page.n,
        juz: activeV2Page.juz,
        hizb: toDisplayHizb(activeV2Page.hizb),
      };
    }
    if (!headerRange) return null;
    return { ...headerRange, hizb: toDisplayHizb(headerRange.hizb) };
  }, [activeV2Page, headerRange]);

  // Tarteel top bar: the card bookmark follows the page on screen.
  // Read once per page change (the reader's store is the source of
  // truth; this page only toggles its own page's entry).
  useEffect(() => {
    const page = headerMeta?.page ?? null;
    if (page === null) {
      setBookmarked(null);
      return;
    }
    const id = pageBookmarkId(page, DEFAULT_SVG_MUSHAF);
    setBookmarked(loadBookmarks().some((b) => b.id === id));
  }, [headerMeta?.page]);

  const toggleBookmark = useCallback(() => {
    const page = headerMeta?.page ?? null;
    if (page === null) return;
    const id = pageBookmarkId(page, DEFAULT_SVG_MUSHAF);
    const items = loadBookmarks();
    if (items.some((b) => b.id === id)) {
      saveBookmarks(items.filter((b) => b.id !== id));
      setBookmarked(false);
    } else {
      saveBookmarks([
        ...items,
        {
          id,
          kind: 'page',
          surah,
          ayah: null,
          page,
          mushaf: DEFAULT_SVG_MUSHAF,
          label: `${surahName} — ${page}`,
          favorite: false,
          createdAt: Date.now(),
        },
      ]);
      setBookmarked(true);
    }
  }, [headerMeta?.page, surah, surahName]);

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

  // Round 2 §8 — per-page V2 chunks: only the active page is
  // fetched. Each chunk is ~0.7KB gzip instead of the whole 193KB
  // file. Failed pages land as null (never retried in this mount —
  // the loader's fallback already tried the full data), so the
  // effect terminates instead of refetch-looping.
  useEffect(() => {
    if (!useV2 || !v2Index) return;
    const needed = activePageIndex !== null ? [activePageIndex] : [];
    const missing = needed.filter((p) => v2Pages[p] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map((p) => loadV2Page(p + 1))).then((loaded) => {
      if (cancelled) return;
      setV2Pages((prev) => {
        const next = { ...prev };
        loaded.forEach((pg, i) => {
          next[missing[i]] = pg;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [useV2, v2Index, activePageIndex, v2Pages]);

  // QPC V4 glyphs + font for the active page (2026-11-08): the glyph
  // map and the font load together per page. A null map (file
  // missing) or a failed font load falls back to Tanzil text; the
  // font promise is shared with the useMushafFontReadyFor hook
  // above (same per-page cache), so no double load.
  useEffect(() => {
    if (!useV2 || activePageIndex === null) return;
    const page = activePageIndex + 1;
    let cancelled = false;
    loadV4PageGlyphs(page).then((glyphs) => {
      if (!cancelled) setV4Glyphs(glyphs);
    });
    ensureMushafFontFor(qcfV4Provider, page).then((ok) => {
      if (!cancelled) setV4FontLoaded(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [useV2, activePageIndex]);
  // Clear both on page change (reader pattern): a stale page's map
  // or font state must never render under the new page. Runs after
  // the load effect in the same commit; the new page's fetch resolves
  // later and repopulates both.
  useEffect(() => {
    setV4Glyphs(undefined);
    setV4FontLoaded(undefined);
  }, [activePageIndex]);

  // ---- Performance (§8): fallback-only data loads. ----
  // The old QPC1 line data (1.78MB raw / 354KB gzip) and the
  // juz/hizb/page boundaries (265KB raw / 55KB gzip) used to download
  // unconditionally on mount, in parallel with the V2 data — on slow
  // 3G they shared the pipe for the whole first minute and the QPC1
  // chunk ending gated the load event. Both are fallback-only now:
  // the mushaf renders from V2 (pageReady never waits for them) and
  // the header reads page/juz/hizb from the V2 page (headerMeta).
  // They download only when the V2 path cannot render the view:
  //   - V2 failed outright (v2Index === null): at once, both.
  //   - the current page's V2 expansion failed (usedV2 false):
  //     after a 3s grace period. The usual transient cause — a
  //     neighbor surah's texts not fetched yet — resolves in ~1s,
  //     and the grace avoids a wasted 354KB download on slow 3G;
  //     the effect cleanup cancels the timer if the render recovers.
  //     A genuine mismatch still falls back, just 3s later.
  const needsOldLines = useMemo(() => {
    if (v2Index === null) return true;
    if (v2Index === undefined || !useV2) return false;
    // The active chunk is still loading: its expansion cannot be
    // judged yet, and treating usedV2=false as a failure here would
    // download the 354KB old lines on every healthy load.
    if (activeV2Page === undefined) return false;
    if (!usedV2) return true;
    return false;
  }, [v2Index, useV2, usedV2, activePageIndex, activeV2Page, v2Pages, textsBySurah, wallAyahs, surah]);

  useEffect(() => {
    if (!needsOldLines || mushafPages !== undefined) return;
    if (v2Index === null) {
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
  }, [needsOldLines, v2Index, mushafPages]);

  // Boundaries are header-fallback-only (headerMeta prefers the V2
  // page): they download only when V2 failed outright. The loader
  // itself still prefers V2 page starts and falls back to the QPC1
  // boundaries JSON — that fallback only runs while V2 is
  // unavailable, never on a healthy load.
  useEffect(() => {
    if (v2Index !== null) return;
    let cancelled = false;
    loadBoundaries().then((b) => {
      if (!cancelled) setBoundaries(b);
    });
    return () => {
      cancelled = true;
    };
  }, [v2Index]);

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
  // Swipe guard (Tarteel step 6): a swipe that starts on a word
  // must not also tap it — the tap handlers below ignore clicks
  // within 500ms of a swipe (lastSwipeAtRef is set by onPageTouchEnd).
  const lastSwipeAtRef = useRef(0);
  const wordTapSuppressed = () => Date.now() - lastSwipeAtRef.current < 500;
  // QPC V4 glyph span (2026-11-08): the printed glyph string in
  // this page's QCF4NNN_COLOR family, via inline style — the family
  // is per-page, so static CSS cannot name it. No renderTajweedText
  // call, no .hifz-tj-* spans: the COLR palette colours the glyph.
  // Callers must already have decided the word may paint a glyph
  // (shouldUseV4Glyph + v4FontLoaded === true).
  const renderV4Glyph = (slot: LineWordSlot) => (
    <span style={{ fontFamily: v4FontFamily ?? undefined }}>{slot.glyph}</span>
  );
  const renderLineWord = (slot: LineWordSlot, key: string) => {
    // Listen mode: the word the reciter is currently on.
    const isListenNow =
      studyMode === 'listen' &&
      listen.isPlaying &&
      slot.ayah === listenAyah &&
      listenWord !== null &&
      slot.index === listenWord - 1;
    // Display-only (another surah's words on this page): always
    // visible in plain mushaf ink — no practice, no grading, no
    // wall status. V4 glyph when the word may paint in its plain
    // state, else the Tanzil text with its tajweed letters. Not
    // tappable: there is no practice word, dispute, or listen-now
    // state for another surah's words.
    if (slot.displayOnly) {
      const useGlyphDisplay =
        v4FontLoaded === true &&
        shouldUseV4Glyph(slot.glyph, {
          concealed: false,
          newestLive: false,
          status: null,
          listenNow: false,
        });
      return (
        <span
          key={key}
          className={[
            'hifz-line-word',
            'hifz-line-word-display-only',
            useGlyphDisplay ? 'hifz-line-word-glyph' : '',
          ].join(' ')}
          data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
          data-qul-id={slot.qulId}
        >
          {useGlyphDisplay ? renderV4Glyph(slot) : renderTajweedText(slot.text)}
          {slot.pauseAfter ? (
            <span className="hifz-word-pause" aria-hidden="true">
              {slot.pauseAfter}
            </span>
          ) : null}
        </span>
      );
    }
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
              onClick={() => {
                if (wordTapSuppressed()) return;
                setRevealedWords((prev) => new Set(prev).add(listenKey));
              }}
              aria-label={labels.showScript}
              data-word-key={listenKey}
              data-qul-id={slot.qulId}
            >
              <span aria-hidden="true">{renderTajweedText(slot.text)}</span>
            </button>
          );
        }
        // Listen follow-along words (not the current one) may paint
        // their V4 glyph; the current word stays text so the green
        // highlight + white ink reads as "current word".
        const useGlyphListen =
          v4FontLoaded === true &&
          shouldUseV4Glyph(slot.glyph, {
            concealed: false,
            newestLive: false,
            status: null,
            listenNow: isListenNow,
          });
        return (
          <span
            key={key}
            className={[
              'hifz-line-word',
              'hifz-word-listen',
              isListenNow ? 'hifz-word-listen-now' : '',
              useGlyphListen ? 'hifz-line-word-glyph' : '',
            ].join(' ')}
            data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
            data-qul-id={slot.qulId}
          >
            {useGlyphListen ? renderV4Glyph(slot) : renderTajweedText(slot.text)}
            {slot.pauseAfter ? (
              <span className="hifz-word-pause" aria-hidden="true">
                {slot.pauseAfter}
              </span>
            ) : null}
          </span>
        );
      }
      // Hidden (unwritten/spacer) words: visibility:hidden hides a
      // COLR glyph element-level, so these MAY stay glyphs — the
      // layout is identical either way, and the glyph keeps the
      // hidden slot's true printed width.
      const useGlyphHidden =
        v4FontLoaded === true &&
        shouldUseV4Glyph(slot.glyph, {
          concealed: false,
          newestLive: false,
          status: null,
          listenNow: false,
        });
      return (
        <span
          key={key}
          className={useGlyphHidden ? 'hifz-line-word-hidden hifz-line-word-glyph' : 'hifz-line-word-hidden'}
          aria-hidden="true"
          data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
          data-qul-id={slot.qulId}
        >
          {useGlyphHidden ? renderV4Glyph(slot) : slot.text}
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
          onClick={() => {
            if (wordTapSuppressed()) return;
            setRevealedWords((prev) => new Set(prev).add(wordKey));
          }}
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
    // V4 glyph iff the word is in its plain state (§5 rule):
    // correct, older-live, peeked and practice-selected words keep
    // their glyph (their tone is ink-identical to plain, or an
    // outline only — peeked: user directive 2026-11-09 ~19:28, the faint
    // beige tint is the cue (no outline) and the glyph keeps its tajweed colours);
    // the newest live word and wrong/close/skipped grades stay text
    // because their signal IS the ink colour, and the listen-now
    // word stays text so the green highlight reads.
    const useGlyph =
      v4FontLoaded === true &&
      shouldUseV4Glyph(slot.glyph, {
        concealed: false,
        newestLive: isNewestLive,
        status: w.status,
        listenNow: isListenNow,
      });
    return (
      <span
        key={key}
        className={[
          'hifz-line-word',
          tone,
          isPractice ? 'hifz-word-practice' : '',
          isListenNow ? 'hifz-word-listen-now' : '',
          useGlyph ? 'hifz-line-word-glyph' : '',
        ].join(' ')}
        data-word-key={slot.index >= 0 ? `${slot.surah}:${slot.ayah}:${slot.index}` : undefined}
        data-qul-id={slot.qulId}
      >
        <button
          type="button"
          className="hifz-word-text"
          onClick={() => {
            if (wordTapSuppressed()) return;
            setPracticeWord({ ayah: slot.ayah, index: slot.index, text: slot.text });
          }}
          title={labels.practiceWordHint}
        >
          {useGlyph ? renderV4Glyph(slot) : renderTajweedText(slot.text)}
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
  // Tarteel (2026-11-08): the listen mini player is gone, so
  // entering listen starts the CURRENT ayah by itself — otherwise
  // listen mode would have no way to play at all. playAyah(ayah)
  // plays the study's selected ayah (play() alone would start from
  // the hook's own current ayah, which is 1 on first entry); when
  // timings are not loaded yet it fetches them and seeks to this
  // ayah. Pause/stop stay available: the bottom-bar mic becomes
  // play/pause in listen mode, and the listen panel keeps Stop.
  const switchToListen = useCallback(() => {
    if (isZipformer) {
      if (liveState === 'listening' || liveState === 'paused') stopLive();
      else if (liveStarting) cancelLive(false);
    } else if (isWhisper && recState === 'recording') {
      stopRecording();
    }
    setStudyMode('listen');
    listen.playAyah(ayah);
  }, [isZipformer, liveState, liveStarting, stopLive, cancelLive, isWhisper, recState, stopRecording, listen.playAyah, ayah]);

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
      // Listen mode: the same long-press switches back to practice
      // (the old listen player's long-press did exactly that).
      if (studyMode === 'listen') switchToPractice();
      else switchToListen();
    }, HIFZ_LISTEN_LONG_PRESS_MS);
  }, [clearMicLongPress, switchToListen, switchToPractice, studyMode]);

  const micOnClick = (): void => {
    if (micLongPressFiredRef.current) {
      micLongPressFiredRef.current = false;
      return;
    }
    // Listen mode: the bottom-bar mic is the play/pause control
    // (the mini player is gone). Paused resumes mid-ayah; idle or
    // error restarts the current ayah.
    if (studyMode === 'listen') {
      if (listen.isPlaying) listen.pause();
      else if (listen.listenStatus === 'paused') listen.resume();
      else listen.playAyah(ayah);
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

  // Tarteel (2026-11-08, step 6): page turning, shared by the
  // swipe gesture and (until the bottom bar was rebuilt) the
  // prev/next-page buttons. V2: load the neighbour page's chunk and
  // jump to its first ayah of this surah; old lines: scan the page
  // for this surah's first text line. Out of range (first/last
  // page) or a page with no ayah of this surah: no-op, never an
  // empty page or an error.
  const goToPage = useCallback(
    (delta: -1 | 1) => {
      if (activePageIndex === null) return;
      const target = activePageIndex + delta;
      if (useV2) {
        if (!v2Index || target < 0 || target >= v2Index.pageCount) return;
        void loadV2Page(target + 1).then((pg) => {
          if (!pg) return;
          const first = v2FirstAyahOfSurahOnPage(pg, surah);
          if (first !== null) setAyah(first);
        });
        return;
      }
      if (!mushafPages || target < 0 || target >= mushafPages.length) return;
      const lines = mushafPages[target];
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
    },
    [activePageIndex, useV2, v2Index, surah, mushafPages],
  );

  // Quran index sheet (user 2026-11-10): a range row (juz / hizb /
  // page) jumps the session to the FIRST AYAH BEGINNING on the
  // range's first mushaf page — the same page → first-ayah
  // resolution the ?view=page deep link uses (v2Index.pageFirstAyahs
  // carries every one of the 604 pages; boundaries.page starts are
  // the fallback). A range in another surah moves the surah too,
  // via resumeAyahRef — the same pattern the resume button and the
  // deep-link effect use. The kind/target are the sheet's own
  // (firstPage already encodes them); if neither source is loaded
  // yet the sheet stays open instead of a silent no-op jump — both
  // load on mount, so this is a load race only.
  const jumpToPickerRange = useCallback(
    (_kind: RangeKind, _target: number, firstPage: number): void => {
      let first: { surah: number; ayah: number } | null = null;
      if (v2Index !== undefined && v2Index !== null) {
        const entry = v2Index.pageFirstAyahs.find(([, , p]) => p === firstPage);
        if (entry) first = { surah: entry[0], ayah: entry[1] };
      } else if (v2Index === null && boundaries) {
        const entry = boundaries.page[firstPage - 1];
        if (entry) first = { surah: entry.surah, ayah: entry.ayah };
      }
      if (!first) return; // index still loading — sheet stays open
      setPickerOpen(false);
      if (first.surah !== surah) {
        resumeAyahRef.current = first.ayah;
        setSurah(first.surah);
      }
      setAyah(first.ayah);
    },
    [v2Index, boundaries, surah],
  );

  // Swipe to turn the page (mushaf mode only): a horizontal swipe
  // of 50px+ that dominates the vertical movement turns the page —
  // left = next page, right = previous page (RTL mushaf order).
  // Vertical scrolling is untouched (touch-action: pan-y on the
  // section) and a tap on a word never fires a swipe: the threshold
  // plus a 500ms tap-suppression window (see lastSwipeAtRef) keep
  // word taps, peek taps and practice-word selection intact.
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPageTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);
  const onPageTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 50) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (Date.now() - start.t > 1000) return;
      lastSwipeAtRef.current = Date.now();
      goToPage(dx < 0 ? 1 : -1);
    },
    [goToPage],
  );

  // Phase 7: Escape closes any open sheet (keyboard path to
  // match the backdrop tap + the close button; no focus trap yet —
  // see the phase 7 notes, deliberately not changed).
  useEffect(() => {
    if (!settingsOpen && !errorSheetOpen && !displaySheetOpen && !pickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setErrorSheetOpen(false);
        setDisplaySheetOpen(false);
        setPickerOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, errorSheetOpen, displaySheetOpen, pickerOpen]);

  // One printed page as a section: header/basmala/text lines + the
  // printed page number at the bottom (Eastern Arabic digits).
  // Tarteel (2026-11-08): in mushaf mode the section takes the
  // swipe handlers (page turning); nass/translation render their
  // own scrolling views and never use this section.
  const renderPageSection = (pIdx: number, lines: RenderLine[], key: string) => (
    <section
      key={key}
      className="hifz-line-page"
      aria-label={labels.title}
      onTouchStart={displayMode === 'mushaf' ? onPageTouchStart : undefined}
      onTouchEnd={displayMode === 'mushaf' ? onPageTouchEnd : undefined}
    >
      {/* Wave 2 (2026-11-09): the caption ("surah · page N") is
          gone — it duplicated the sticky header card, which already
          carries surah + page | juz | hizb, and the footer below
          carries the page number. Removing it frees 32.5px of
          vertical budget for the 16.5px text size; no meta is lost. */}
      {lines.map((line) => {
        if (line.kind === 'header') {
          // Tarteel (2026-11-08): the surah-name SVG is calligraphy
          // ONLY — the file holds no frame (verified byte-for-byte
          // against Drive: no rect/frame/border). The old comment
          // calling it a "floral black-white SVG frame" was wrong.
          // The frame is the real vector asset
          // `public/quran/surah-headers/sura-border.svg` ("Sura
          // border.svg" by Hadysylmy, CC BY-SA 4.0 — bundled on the
          // user's explicit order, licence research deferred; see
          // THIRD_PARTY_NOTICES.md), rendered as the background of
          // .hifz-surah-frame with the name calligraphy centred in
          // its cartouche (report 07). Sizing is by HEIGHT
          // (aspect-ratio 16320/2000 = 8.16:1, ~43px on a 393px
          // phone), never by width:98% — that rule made the header
          // 3.7–4.4x taller than Tarteel. Surah 1 has no SVG in
          // that set, and a failed load falls back to the
          // plain-text header below.
          const headerSurah = line.surah;
          if (
            headerSurah !== undefined &&
            headerSurah !== 1 &&
            !failedStudyHeaders.has(headerSurah)
          ) {
            const padded = String(headerSurah).padStart(3, '0');
            return (
              <p key={line.key} className="hifz-line hifz-line-header hifz-line-header--svg">
                <span className="hifz-surah-frame">
                  <img
                    src={`/quran/surah-headers/surah-${padded}.svg`}
                    alt={line.text}
                    onError={() =>
                      setFailedStudyHeaders((prev) => new Set(prev).add(headerSurah))
                    }
                  />
                </span>
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
          // Wave 1 (2026-11-09): the dedicated Basmalah SVG
          // (public/quran/surah-headers/basmalah.svg — the printed
          // surah-header form, composed from the page-1 V4 glyph
          // outlines, never from Tarteel's bismallah.ttf) — but ONLY
          // when the line is in a plain state: every slot hidden,
          // or every slot written with a plain 'correct' grade.
          // Any grade, live word, listen mode, script-hide, or a
          // practice-selected Basmalah word falls back to the word
          // spans below, so grading, peek, listen-now, per-word
          // reveal and the practice outline keep working exactly as
          // before. The Fatiha Basmalah (1:1:1-4, real ayah words)
          // never reaches this branch — it renders as text-line
          // words — so it stays glyphs/text as before.
          const basmalaAllHidden = line.slots.every((s) => s.hidden);
          const basmalaAllPlain = line.slots.every(
            (s) => s.written !== null && s.written.status === 'correct' && !s.written.live,
          );
          const basmalaPracticeSelected =
            practiceWord !== null &&
            practiceWord.ayah === 1 &&
            practiceWord.index >= 0 &&
            practiceWord.index < 4;
          if (
            studyMode !== 'listen' &&
            !scriptHidden &&
            !basmalaPracticeSelected &&
            (basmalaAllHidden || basmalaAllPlain)
          ) {
            return (
              <p key={line.key} className="hifz-line hifz-line-basmala" dir="rtl">
                <img
                  className={
                    basmalaAllHidden
                      ? 'hifz-basmala-svg hifz-line-word-hidden'
                      : 'hifz-basmala-svg'
                  }
                  src="/quran/surah-headers/basmalah.svg"
                  alt={line.slots.map((s) => s.text).join(' ')}
                />
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
            {line.slots.flatMap((slot, si) => {
              const node =
                slot.kind === 'marker' ? (
                  // Wave 2 (2026-11-09): the ayah-end marker as a V4
                  // glyph (its COLR layers draw the ayah number;
                  // advance 16.06px vs the SVG rosette's 28.8px —
                  // this is what fixes p584 line 2). Falls back to
                  // the SVG rosette whenever the slot has no glyph
                  // (old-lines fallback path, missing V4 key) or
                  // the V4 font is not loaded.
                  slot.glyph !== undefined && v4FontLoaded === true ? (
                    <span
                      key={`m${si}`}
                      className="hifz-line-marker hifz-line-marker-glyph"
                      style={{ fontFamily: v4FontFamily ?? undefined }}
                      aria-hidden="true"
                    >
                      {slot.glyph}
                    </span>
                  ) : (
                    <HifzRosette key={`m${si}`} digit={slot.text} />
                  )
                ) : slot.kind === 'ornament' ? (
                  <span key={`o${si}`} className="hifz-line-ornament" aria-hidden="true">
                    {slot.text}
                  </span>
                ) : (
                  renderLineWord(slot, `${line.key}-${si}`)
                );
              // Wave 2: a real space between slots (in the page's
              // QCF family, ~1px) so text-align-last: justify can
              // distribute it and flush the left edge (probe 2:
              // plain justify alone does nothing; text-align-last
              // flushes the void 93px -> 1px). Only while V4 glyphs
              // are active: in the Uthmanic fallback a space is
              // ~4px and would overflow the tightest lines.
              if (si === 0 || v4FontLoaded !== true) return [node];
              return [
                <span
                  key={`sep${si}`}
                  className="hifz-line-sep"
                  aria-hidden="true"
                  style={{ fontFamily: v4FontFamily ?? undefined }}
                >
                  {' '}
                </span>,
                node,
              ];
            })}
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
      className={`quran-hifz-study${hifzSettings.hideAyahMarkers ? ' hifz-hide-markers' : ''}${displayMode === 'mushaf' ? ' hifz-mode-mushaf' : ''}`}
      dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Header: Tarteel top bar, row 1 (hamburger + surah card +
          search + gear) — see components/hifz-study/HifzStudyHeader.tsx.
          Row 2 is gone: the mode toggle was removed 2026-11-08 and
          the eye moved to the bottom bar (same change). */}
      <HifzStudyHeader
        surahName={surahName}
        headerMeta={headerMeta}
        liveActive={liveActive}
        surah={surah}
        ayah={ayah}
        labels={labels}
        menuOpen={setupOpen}
        onOpenMenu={() => setSetupOpen((v) => !v)}
        onOpenSearch={() => setSearchSheetOpen(true)}
        bookmarked={bookmarked}
        onToggleBookmark={toggleBookmark}
        onOpenPicker={() => setPickerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* The hide/show-script eye moved to the bottom bar
          2026-11-08 (user order: eye only at the bottom); the
          practice/listen mode toggle was removed the same day —
          mode switching is now ONLY the long-press on the green
          mic button (signed-in users); guests have no path to
          listen mode (the mic is disabled for them). */}

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

      {/* Phase-1 hifz fix: the session-setup form (picker, range,
          repetition, listen controls) is a collapsible panel, CLOSED
          by default — the mushaf below is the first visible element
          on load. It opens from the hamburger in the top bar. */}
      <div className={`hifz-setup${setupOpen ? ' is-open' : ''}`}>
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

      {/* Tarteel (2026-11-08): the listen mini player is GONE — no
          HifzListenPlayer, no spacer. The <audio> above stays (the
          useQuranListen hook owns it) and listen mode autoplays the
          current ayah on entry (switchToListen) with play/pause on
          the bottom-bar mic. The listen-controls panel above keeps
          reciter / repeat / stop / resume. HifzListenPlayer.tsx
          itself is kept, unused, for reversibility. */}

      {/* Live pills: see components/hifz-study/HifzLivePills.tsx
          (refactor step 7 - moved verbatim; pillStats, timerText
          and accuracyTone stay here). */}
      <HifzLivePills
        visible={showPills && studyMode === 'practice'}
        stats={pillStats}
        accuracyTone={accuracyTone}
        liveWordsPresent={liveWords.length > 0}
        showTimer={liveState === 'listening'}
        timerText={timerText}
        labels={labels}
      />

      {/* The blank line page: faint markers from the start, words
          written in Uthmanic font as recited. While the line data
          loads, a loading note; on page failure, the wall below
          takes over entirely (see svgFailedNote). Performance (§8):
          the note waits for V2 — or, when V2 failed, for the
          fallback old lines — but NOT for the old lines on a healthy
          V2 load: they are fallback-only now and stay unloaded. */}
      {displayMode === 'mushaf' &&
        (v2Index === undefined ||
          (useV2 && activeV2Page === undefined) ||
          (v2Index === null && mushafPages === undefined)) && (
          <p className="hifz-line-loading">{labels.loadingPage}</p>
        )}
      {/* Mushaf (Tarteel default): the one printed page, swipe to turn.
          V4 gate: while this page's glyph map is still loading or its
          V4 font is not ready yet, blank placeholder lines of the same
          count and line-height — never tofu, never a wrong-font flash.
          A null map (file missing) or a failed/timed-out font load
          renders the page at once, in Tanzil text (v4FontLoaded false
          keeps every word on the text path). The old-lines fallback
          (usedV2 false) never waits on V4. */}
      {pageReady &&
        textsReady &&
        displayMode === 'mushaf' &&
        usedV2 &&
        (v4Glyphs === undefined || !v4FontReady) && (
          <section className="hifz-line-page" aria-busy="true" aria-label={labels.title}>
            {/* No caption here either (Wave 2): the placeholder
                must match the real section's layout exactly, or
                the page jumps when the glyphs arrive. */}
            {renderLines.map((line) => (
              <p
                key={line.key}
                className={
                  line.kind === 'header'
                    ? 'hifz-line hifz-line-header'
                    : line.kind === 'basmala'
                      ? 'hifz-line hifz-line-basmala'
                      : 'hifz-line'
                }
                aria-hidden="true"
              >
                {'\u00a0'}
              </p>
            ))}
            <p className="hifz-page-footer" aria-hidden="true">
              {toArabicIndic((activePageIndex ?? 0) + 1)}
            </p>
          </section>
        )}
      {pageReady &&
        textsReady &&
        displayMode === 'mushaf' &&
        (!usedV2 || (v4Glyphs !== undefined && v4FontReady)) &&
        renderPageSection(activePageIndex ?? 0, renderLines, 'mushaf')}
      {/* Nass (Tarteel): the whole surah as scrolling Uthmani text.
          Same slots as the page (renderLineWord), so hide/reveal,
          peek (›/») and grades work identically; only the layout
          differs. The Basmalah is its own centred line (surahs 1
          and 9 have none); ayah 1's words follow after it. Needs
          only the surah texts, never the V2 page. */}
      {textsReady && ayahCount > 0 && displayMode === 'nass' && (
        <div className="hifz-nass" dir="rtl" aria-label={labels.displayNass}>
          {surah !== 1 && surah !== 9 && (
            <p className="hifz-line hifz-line-basmala" dir="rtl">
              {(textsBySurah[surah]?.[1] ?? '')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 4)
                .map((text, i) => {
                  const written = nassWrittenByKey.get(`1:${i}`) ?? null;
                  return renderLineWord(
                    { kind: 'word', surah, ayah: 1, index: i, text, written, hidden: written === null },
                    `nass-b-${i}`,
                  );
                })}
            </p>
          )}
          {ayahNumbers.map((a) => {
            const words = (textsBySurah[surah]?.[a] ?? '').split(/\s+/).filter(Boolean);
            const start = a === 1 && surah !== 1 && surah !== 9 ? 4 : 0;
            return (
              <p key={a} className="hifz-nass-ayah" dir="rtl">
                {words.slice(start).map((text, k) => {
                  const i = start + k;
                  const written = nassWrittenByKey.get(`${a}:${i}`) ?? null;
                  return renderLineWord(
                    { kind: 'word', surah, ayah: a, index: i, text, written, hidden: written === null },
                    `nass-${a}-${i}`,
                  );
                })}
                <HifzRosette digit={toArabicIndic(a)} />
              </p>
            );
          })}
        </div>
      )}
      {/* Translation (Tarteel): the whole surah as scrolling
          translation, read-only. One block per ayah, one paragraph
          per active edition (CRM order). The default edition arrives
          with the server render; the rest load on demand (see the
          translation effect). Needs only the surah texts, never the
          V2 page. */}
      {textsReady && ayahCount > 0 && displayMode === 'translation' && (
        <div className="hifz-translation" aria-label={labels.displayTranslation}>
          {trLoading && <p className="hifz-line-loading">{labels.translationLoading}</p>}
          {activeTranslationEditions.length === 0 ? (
            <p className="hifz-line-loading">{labels.translationUnavailable}</p>
          ) : (
            ayahNumbers.map((a) => (
              <div key={a} className="hifz-translation-ayah">
                <p className="hifz-translation-ref">
                  {surahName} — {toArabicIndic(a)}
                </p>
                {activeTranslationEditions.map((ed) => {
                  const tr = translationsByKey[`${surah}:${ed}`]?.[a];
                  if (!tr) return null;
                  return (
                    <div key={ed} className="hifz-translation-edition">
                      <p className="hifz-translation-edition-name">
                        {editionDisplayName(ed, locale) ?? ed}
                      </p>
                      <p dir={ed.startsWith('en') ? 'ltr' : 'rtl'} lang={ed.split('.')[0]}>
                        {tr}
                      </p>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {trFailed && (
            <p className="hifz-error" role="alert">
              {labels.translationUnavailable}
            </p>
          )}
        </div>
      )}
      {!textsReady && (displayMode !== 'mushaf' || pageReady) && (
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
          ayahs whose words are NOT placed on the line page. Mushaf
          mode only — nass and translation already show the whole
          surah, so the wall would duplicate them. Nothing written
          yet on a ready page means no wall section at all (the blank
          page above is the whole state). While the surah texts still
          load, the wall stays hidden: placement is undecided until
          they arrive, and showing the whole surah below would repeat
          the silent fallback. */}
      {displayMode === 'mushaf' &&
        (pageFailed || (pageReady && textsSettled && unplacedGroups.length > 0)) && (
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

      {/* Recitation toolbar (user design, 2026-11-10): the old
          Tarteel bottom bar is replaced by the user's green
          toolbar, EXACTLY as designed — dir="ltr" so the visual
          order matches the user's screenshot (chevrons + pill
          left, mic centre, eye + grid right). Every old control
          is wired in, nothing dropped: mic (record / play-pause
          + long-press mode switch), «<» = peek next word,
          «<<» = peek whole ayah, pill = accuracy + errors (tap
          opens the errors sheet), eye = hide/show script,
          grid = display sheet. The old errors-icon button is
          gone — its function moved to the pill tap. The pill is
          practice-only, as before. */}
      <div className="recitation-toolbar" dir="ltr" role="group" aria-label={labels.displayMode}>
        <div className="toolbar-decor toolbar-decor-left" aria-hidden="true">
          <svg viewBox="0 0 220 130" aria-hidden="true">
            <g fill="currentColor">
              <path d="M0 130 V80 Q15 68 25 80 V130Z" />
              <path d="M15 83 Q20 50 28 83Z" />
              <path d="M26 130 V95 Q45 67 64 95 V130Z" />
              <path d="M35 95 Q45 63 55 95Z" />
              <path d="M55 130 V100 Q78 72 100 100 V130Z" />
              <path d="M76 99 Q88 65 101 99Z" />
              <path d="M100 130 V105 Q120 83 140 105 V130Z" />
              <path d="M140 130 V95 Q165 65 190 95 V130Z" />
              <path d="M165 95 Q178 58 190 95Z" />
            </g>
          </svg>
        </div>
        <div className="toolbar-left">
          <button
            type="button"
            className="tool-button"
            disabled={!peekTarget}
            onClick={() => void peekNext()}
            aria-label={labels.peekWord}
            title={labels.peekWordHint}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5 L8 12 L15 19" />
            </svg>
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={!peekTarget}
            onClick={() => void peekAyah()}
            aria-label={labels.peekAyah}
            title={labels.peekAyahHint}
          >
            <svg viewBox="0 0 28 24" aria-hidden="true">
              <path d="M13 4 L6 12 L13 20" />
              <path d="M24 4 L17 12 L24 20" />
            </svg>
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          {studyMode === 'practice' && (
            <button
              type="button"
              className={`progress-pill ${accuracyPillClass(accuracyTone)}`}
              onClick={() => setErrorSheetOpen(true)}
              aria-label={`${labels.pillAccuracy} ${formatLatinDecimal(pillStats.accuracy)}٪، ${labels.pillErrors} ${pillStats.errors}، ${labels.errorsOpen}`}
              title={labels.errorsTitle}
            >
              <svg className="waveform" viewBox="0 0 40 30" aria-hidden="true">
                <path d="M3 12v6 M9 6v18 M15 10v10 M21 2v26 M27 9v12 M33 5v20 M38 11v8" />
              </svg>
              <span>
                <span className="hifz-pill-label">{labels.pillAccuracy}: </span>
                {formatLatinDecimal(pillStats.accuracy)}٪
                <span aria-hidden="true"> | </span>
                <span className="hifz-pill-label">{labels.pillErrors}: </span>
                {pillStats.errors}
              </span>
            </button>
          )}
        </div>
        {(isZipformer || isWhisper) && (
          <button
            type="button"
            className="mic-button"
            aria-label={
              studyMode === 'listen'
                ? listen.isPlaying
                  ? labels.listenPause
                  : labels.listenPlay
                : micLabel
            }
            disabled={studyMode === 'practice' && (!authed || micBusy || modelUnavailable)}
            onClick={micOnClick}
            onPointerDown={onMicPointerDown}
            onPointerUp={clearMicLongPress}
            onPointerLeave={clearMicLongPress}
            onPointerCancel={clearMicLongPress}
            onContextMenu={(e) => e.preventDefault()}
            title={labels.listenLongPressSwitch}
          >
            <span className="mic-outer-ring">
              {studyMode === 'listen' ? (
                listen.isPlaying ? (
                  <span className="hifz-mic-pause" aria-hidden="true" />
                ) : (
                  <span className="hifz-mic-play" aria-hidden="true" />
                )
              ) : micActive ? (
                <span className="hifz-mic-stop" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 48 56" aria-hidden="true">
                  <rect x="18" y="3" width="12" height="31" rx="6" />
                  <path d="M9 25v3a15 15 0 0 0 30 0v-3" />
                  <path d="M24 43v8 M15 51h18" />
                </svg>
              )}
            </span>
          </button>
        )}
        <div className="toolbar-right">
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="tool-button"
            aria-pressed={scriptHidden}
            aria-label={scriptHidden ? labels.showScript : labels.hideScript}
            title={scriptHidden ? labels.showScript : labels.hideScript}
            onClick={() => {
              setScriptHidden((v) => !v);
              setRevealedWords(new Set());
            }}
          >
            <svg viewBox="0 0 32 24" aria-hidden="true">
              <path d="M2 12 Q16 -5 30 12 Q16 29 2 12Z" />
              <circle cx="16" cy="12" r="5" />
              {scriptHidden && <line x1="5" y1="3" x2="27" y2="21" />}
            </svg>
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="tool-button grid-button"
            onClick={() => setDisplaySheetOpen(true)}
            aria-label={labels.displaySheetTitle}
            title={labels.displaySheetTitle}
          >
            <svg viewBox="0 0 30 30" aria-hidden="true">
              <g fill="currentColor" stroke="none">
                <circle cx="5" cy="5" r="2.5" />
                <circle cx="15" cy="5" r="2.5" />
                <circle cx="25" cy="5" r="2.5" />
                <circle cx="5" cy="15" r="2.5" />
                <circle cx="15" cy="15" r="2.5" />
                <circle cx="25" cy="15" r="2.5" />
                <circle cx="5" cy="25" r="2.5" />
                <circle cx="15" cy="25" r="2.5" />
                <circle cx="25" cy="25" r="2.5" />
              </g>
            </svg>
          </button>
        </div>
        <div className="toolbar-decor toolbar-decor-right" aria-hidden="true">
          <svg viewBox="0 0 220 150" aria-hidden="true">
            <g fill="currentColor">
              <path d="M0 150 V112 Q25 80 50 112 V150Z" />
              <path d="M20 112 Q35 72 50 112Z" />
              <path d="M53 150 V103 Q80 65 107 103 V150Z" />
              <path d="M67 105 Q80 55 94 105Z" />
              <path d="M100 150 V65 H116 V150Z" />
              <path d="M96 65 L108 39 L120 65Z" />
              <path d="M106 40 V20 M103 28 H111" />
              <path d="M137 150 V110 Q161 80 185 110 V150Z" />
              <path d="M148 110 Q161 65 175 110Z" />
              <path d="M179 150 V70 H193 V150Z" />
              <path d="M176 70 L186 45 L196 70Z" />
              <path d="M186 45 V28" />
            </g>
          </svg>
        </div>
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
      {/* Tarteel (2026-11-08): the mic moved INTO the fixed bottom
          bar (see above) — no floating layer anymore. In practice
          mode it records; in listen mode it is play/pause. */}
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

      {/* Search sheet (Tarteel top bar): the one Quran search. */}
      <HifzSearchSheet
        open={searchSheetOpen}
        locale={locale}
        surahList={surahList}
        labels={labels}
        searchLabels={searchLabels}
        onClose={() => setSearchSheetOpen(false)}
      />

      {/* Quran index sheet (user 2026-11-10): opened from the surah
          card in the top bar. Owned here — not the reader's
          instance — so picking stays in hifz: surah rows link to
          ?tab=hifz and range rows jump the session to the range's
          first ayah (jumpToPickerRange). */}
      {pickerOpen ? (
        <QuranPickerSheet
          locale={locale}
          surahList={surahList}
          currentSurah={surah}
          currentView="page"
          currentTarget={headerMeta?.page ?? null}
          onSelectRange={jumpToPickerRange}
          onClose={() => setPickerOpen(false)}
          labels={labels.picker}
          surahHref={(n) => `/${locale}/quran/${n}?tab=hifz`}
        />
      ) : null}

      {/* Display sheet (Tarteel, 2026-11-08): mushaf / nass /
          translation picker; same sheet pattern as settings/errors. */}
      <HifzDisplaySheet
        open={displaySheetOpen}
        mode={displayMode}
        labels={labels}
        onSelect={(m) => setDisplayModePersist(m)}
        onClose={() => setDisplaySheetOpen(false)}
      />

      {/* Error sheet: see components/hifz-study/HifzErrorSheet.tsx
          (refactor step 6 - moved verbatim; state, the errorWords
          memo and the delete call stay here). */}
      <HifzErrorSheet
        open={errorSheetOpen}
        groups={groupedMistakes}
        errorWords={errorWords}
        liveExtraWords={liveExtraWords}
        liveExtraCount={liveExtraCount}
        surah={surah}
        labels={labels}
        onDelete={deleteMistake}
        onClose={() => setErrorSheetOpen(false)}
      />

    </div>
  );
}
