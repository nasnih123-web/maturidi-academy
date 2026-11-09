/**
 * hifz-study-types: shared types for the hifz study screen
 * (QuranHifzStudy). Pure type move from components/QuranHifzStudy.tsx
 * (hifz-completion refactor step 1) — no behavioral change, no values.
 */


/** One rendered word slot on a line page. */
export interface LineWordSlot {
  kind: 'word';
  surah: number;
  ayah: number;
  /** Provider-text word index, or -1 for a printed spacer. */
  index: number;
  text: string;
  written: WallWord | null;
  /** Hidden slots keep layout stable but are never shown. */
  hidden: boolean;
  /** Phase 3 (hifz redesign): the V2 layout word id (1..83668). */
  qulId?: number;
  /** Phase 3: the pause sign printed after this word, if any. */
  pauseAfter?: string;
  /** QPC V4 Tajweed glyph string (1–3 page-relative PUA chars) for
      this word, from the page's V4 map (key "surah:ayah:word",
      word 1-based). Present only on V2-built pages when the map was
      supplied; `text` stays the Tanzil text forever and is the
      logical key for grading/hiding/peek/matching. A word renders
      its glyph only in its plain state (see shouldUseV4Glyph) and
      only in its own page's QCF4NNN_COLOR family. */
  glyph?: string;
}

export interface LineMarkerSlot {
  kind: 'marker';
  text: string;
  /** Wave 2 (2026-11-09): the ayah this marker ends, so the V4
      marker glyph (the ayah's last V4 entry, key realWordCount+1)
      can be looked up. `glyph` is present only on V2-built pages
      when the page's V4 map was supplied and holds the key; the
      renderer falls back to the SVG rosette whenever it is absent
      (old-lines fallback path, missing key, V4 not loaded). */
  surah: number;
  ayah: number;
  glyph?: string;
}

/** A rub el hizb ornament (۞) printed between words: visible, but
    never a word — it carries no provider index and no score. */
export interface LineOrnamentSlot {
  kind: 'ornament';
  text: string;
}

export type LineSlot = LineWordSlot | LineMarkerSlot | LineOrnamentSlot;

export type RenderLine =
  | { kind: 'header'; key: string; text: string; surah?: number }
  | { kind: 'basmala'; key: string; slots: LineWordSlot[] }
  | { kind: 'text'; key: string; slots: LineSlot[] };
/** Labels for the mutashabihat (similar-ayah) panel (HifzMutashabihat).
    Defined here so the lib layer never imports from components. */
export interface HifzMutashabihatLabels {
  title: string;
  hide: string;
  show: string;
  empty: string;
  goToAyah: string;
}

export interface HifzLabels {
  title: string;
  surahLabel: string;
  pageLabel: string;
  prevPage: string;
  nextPage: string;
  pageJump: string;
  studyModeOn: string;
  studyModeOff: string;
  recordGrade: string;
  stopRecording: string;
  recording: string;
  grading: string;
  practiceWordHint: string;
  practiceWord: string;
  clearPractice: string;
  peekWord: string;
  peekAyah: string;
  micDenied: string;
  offline: string;
  offlineDisconnected: string;
  modelUnavailable: string;
  pauseLive: string;
  resumeLive: string;
  pausedHint: string;
  startAyahHint: string;
  dispute: string;
  disputed: string;
  signInHint: string;
  engineUnavailable: string;
  selectAyahHint: string;
  svgFailedNote: string;
  loadingPage: string;
  textsFailed: string;
  textsRetry: string;
  errorGeneric: string;
  noAttemptHint: string;
  revealedByPeek: string;
  liveStart: string;
  liveStop: string;
  liveCancel: string;
  liveListening: string;
  liveConnecting: string;
  liveEnded: string;
  liveDisconnected: string;
  liveDiagSampleRate: string;
  liveDiagFrames: string;
  liveDiagSocket: string;
  liveRequestingPermission: string;
  liveEngineLoading: string;
  liveInterrupted: string;
  liveStopping: string;
  liveLegacyCapture: string;
  liveDeviceChanged: string;
  liveFramesBeforeReady: string;
  liveReadingNow: string;
  liveDiagCapture: string;
  liveDiagDropped: string;
  liveOnlyZipformer: string;
  ayahLabel: string;
  prevAyah: string;
  nextAyah: string;
  wallHint: string;
  // --- Tarteel rebuild: live pills, error sheet, display modes, listen mode ---
  /** Live pills (shown during a live session). */
  pillErrors: string;
  pillAccuracy: string;
  pillTimer: string;
  /** Error sheet (bottom sheet with wrong + extra words). */
  errorsTitle: string;
  errorsWrong: string;
  errorsExtra: string;
  errorsEmpty: string;
  errorsExpected: string;
  errorsHeard: string;
  errorsOpen: string;
  errorsClose: string;
  errorsDelete: string;
  errorsTransposed: string;
  /** Phase 6 — info pill at the bottom of the error sheet
      (Tarteel: «تعلم عن خاصية كشف الأخطاء التلقائي»); static
      text, not a button — its action was never observed. */
  errorsLearn: string;
  /** Phase 4 — settings sheet (per-user, stored server-side). */
  settingsTitle: string;
  settingsOpen: string;
  freezeSetting: string;
  freezeHint: string;
  mistakeDetection: string;
  tashkeelDetection: string;
  resumableSessions: string;
  hideMarkers: string;
  /** Phase 4 — freeze hold banner (freeze_on_error is ON). */
  freezeHold: string;
  freezeResume: string;
  /** Phase 4 — hide/reveal the script (crossed-eye button). */
  hideScript: string;
  showScript: string;
  /** Phase 4 — practice range + repetition. */
  rangeStart: string;
  rangeEnd: string;
  repeatAyah: string;
  repeatRange: string;
  rangeErrorStart: string;
  rangeErrorEnd: string;
  rangeErrorOrder: string;
  /** Phase 4 — resume an unfinished session. */
  resumeTitle: string;
  resumeContinue: string;
  resumeDismiss: string;
  /** Phase 4 — Peek button meanings (best-evidence inference). */
  peekWordHint: string;
  peekAyahHint: string;
  /** Header: surah + page/juz/hizb + current surah:ayah. */
  headerJuz: string;
  headerHizb: string;
  headerPage: string;
  /** Tarteel top bar (2026-11-08): hamburger menu, Quran search
      sheet, page bookmark toggle, and the study-mode group label
      (the old displayMode label means "page display" and does not
      fit the practice/listen group). */
  menuOpen: string;
  searchOpen: string;
  searchTitle: string;
  bookmarkAdd: string;
  bookmarkRemove: string;
  /** Display modes (bottom menu). Kept for the mode toggle's
      aria-label; the old page/scroll/card menu itself is gone —
      the Tarteel display sheet (mushaf/nass/translation) replaces
      it. */
  displayMode: string;
  displayPage: string;
  displayScroll: string;
  displayCard: string;
  /** Tarteel display sheet (2026-11-08): three display modes —
      mushaf (printed page, swipe), nass (scrolling Uthmani text),
      translation (scrolling, read-only). */
  displaySheetTitle: string;
  displayMushaf: string;
  displayMushafDesc: string;
  displayNass: string;
  displayNassDesc: string;
  displayTranslation: string;
  displayTranslationDesc: string;
  /** Translation mode: loading / unavailable states. */
  translationLoading: string;
  translationUnavailable: string;
  /** Listen/follow mode (reciter audio + word highlight). */
  listenReciter: string;
  listenPlay: string;
  listenPause: string;
  listenResume: string;
  listenStop: string;
  listenPrevAyah: string;
  listenNextAyah: string;
  listenRepeat: string;
  listenRepeatOff: string;
  listenRepeatAyah: string;
  listenRepeatSurah: string;
  listenSpeed: string;
  listenCurrentAyah: string;
  listenProgress: string;
  listenSegmentsNote: string;
  listenInterpolatedNote: string;
  listenAudioFailed: string;
  listenReciters: { id: string; label: string }[];
  /** Phase 5 — player completion (repeat range, loading/buffering/
      offline/retry, saved-position resume, long-press mode switch). */
  listenRepeatRange: string;
  listenLoading: string;
  listenBuffering: string;
  listenOffline: string;
  listenRetry: string;
  listenResumeFrom: string;
  listenLongPressSwitch: string;
  /** Mutashabihat panel (phrases computed from our Tanzil text). */
  mutashabihat: HifzMutashabihatLabels;
  /** Link to the separate hifz hub (dashboard/testing/Tasmi). */
  hubLink: string;
}

export interface HifzWordScore {
  id: string;
  attempt_id: string;
  surah: number;
  ayah: number;
  word_index: number;
  expected_text: string;
  status: 'correct' | 'close' | 'wrong' | 'skipped';
  prob: number;
  heard: string | null;
  mistake_type: string | null;
  disputed: boolean;
}

export interface HifzMistake {
  id: string;
  attempt_id: string;
  surah: number;
  ayah: number;
  word_index: number | null;
  mistake_type: string;
  expected_text: string;
  heard: string | null;
  created_at: string;
}

export interface HifzCounts {
  correct: number;
  close: number;
  wrong: number;
  skipped: number;
}

export interface HifzAttempt {
  id: string;
  surah: number;
  page: number | null;
  status: string;
  engine: string;
  counts: HifzCounts;
  created_at: string;
  /** Phase 4 — practice range, last position, repetition. */
  start_ayah?: number | null;
  end_ayah?: number | null;
  current_surah?: number | null;
  current_ayah?: number | null;
  current_word_index?: number | null;
  repeat_ayah?: number;
  repeat_range?: number;
}

/** One card of the grouped mistake sheet (Phase 4, API shape). */
export interface HifzMistakeGroupItem {
  id: string;
  mistake_type: string;
  word_index: number | null;
  expected_text: string;
  heard: string | null;
  created_at: string;
}

export interface HifzMistakeGroup {
  surah: number;
  ayah: number;
  category: 'wrong_words' | 'extra_words';
  items: HifzMistakeGroupItem[];
}

export interface HifzGrade {
  attempt_id: string;
  surah: number;
  ayah: number;
  word_index: number | null;
  engine_used: string;
  thresholds: { green: number; amber: number };
  words: HifzWordScore[];
  counts: HifzCounts;
  extra_words: string[];
}

export interface HifzStatus {
  engine: string;
  available: boolean;
  reason: string;
}

/** Live word events (v2 envelope) live in lib/quran-audio.ts. */

export interface WallWord {
  ayah: number;
  index: number;
  text: string;
  status: 'correct' | 'close' | 'wrong' | 'skipped' | 'peeked';
  prob: number;
  heard: string | null;
  scoreId: string | null;
  disputed: boolean;
  /** True while the word is only a live hearing (ink on the page);
      false once the server grade for it has arrived. */
  live: boolean;
}
