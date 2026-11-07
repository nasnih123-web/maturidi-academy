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
 * accuracy % (green >=95 / amber 80-95 / red <80), session timer
 * (gray, MM:SS, counts up). The header shows the surah name +
 * printed page / juz / hizb + the current surah:ayah while live.
 * The footer of the mushaf area shows the printed page number
 * (Eastern Arabic digits). The page follows the heard ayah and
 * turns automatically.
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
import { HifzMutashabihat, type HifzMutashabihatLabels } from './HifzMutashabihat';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import { loadMushafLines, type MushafExactLine } from '@/lib/quran-mushaf-lines';
import {
  ARABIC_INDIC,
  RUB_EL_HIZB,
  parseTextLine,
  toArabicIndic,
} from '@/lib/quran-print-lines';
import { colorizeTajweedWord } from '@/lib/quran-tajweed';
import { rangeContaining } from '@/lib/quran-view-modes';

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

/** First page (0-based) whose lines cover the given ayah, else null. */
function pageIndexFor(
  pages: MushafExactLine[][],
  surah: number,
  ayah: number,
): number | null {
  for (let p = 0; p < pages.length; p += 1) {
    for (const line of pages[p]) {
      if (line.t !== 'text' || !line.v || !line.w) continue;
      const [vs, va] = line.v.split(':').map(Number);
      const [ws, wa] = line.w.split(':').map(Number);
      if (vs === surah && ws === surah && va <= ayah && ayah <= wa) return p;
    }
  }
  return null;
}

/**
 * Surahs whose Basmalah line sits on this page: a basmala line whose
 * immediately following text line starts a new surah at ayah 1
 * (surahs 1 and 9 have no Basmalah line in the data).
 */
function basmalaSurahsOnPage(lines: MushafExactLine[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].t !== 'basmala') continue;
    const next = lines[i + 1];
    if (next?.t === 'text' && next.v) {
      const [s, a] = next.v.split(':').map(Number);
      if (a === 1 && s !== 1 && s !== 9) out.add(s);
    }
  }
  return out;
}

/** One rendered word slot on a line page. */
interface LineWordSlot {
  kind: 'word';
  surah: number;
  ayah: number;
  /** Provider-text word index, or -1 for a printed spacer. */
  index: number;
  text: string;
  written: WallWord | null;
  /** Hidden slots keep layout stable but are never shown. */
  hidden: boolean;
}

interface LineMarkerSlot {
  kind: 'marker';
  text: string;
}

/** A rub el hizb ornament (۞) printed between words: visible, but
    never a word — it carries no provider index and no score. */
interface LineOrnamentSlot {
  kind: 'ornament';
  text: string;
}

type LineSlot = LineWordSlot | LineMarkerSlot | LineOrnamentSlot;

type RenderLine =
  | { kind: 'header'; key: string; text: string }
  | { kind: 'basmala'; key: string; slots: LineWordSlot[] }
  | { kind: 'text'; key: string; slots: LineSlot[] };

/** Simple microphone glyph for the floating 3D record button. */
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="hifz-mic-icon">
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 10a7 7 0 0 0 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 17v3M8.5 20.5h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
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
  disclaimer: string;
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
  /** Header: surah + page/juz/hizb + current surah:ayah. */
  headerJuz: string;
  headerHizb: string;
  headerPage: string;
  /** Display modes (bottom menu). */
  displayMode: string;
  displayPage: string;
  displayScroll: string;
  displayCard: string;
  /** Listen/follow mode (reciter audio + word highlight). */
  modePractice: string;
  modeListen: string;
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
  /** Mutashabihat panel (phrases computed from our Tanzil text). */
  mutashabihat: HifzMutashabihatLabels;
  /** Link to the separate hifz hub (dashboard/testing/Tasmi). */
  hubLink: string;
}

interface HifzWordScore {
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

interface HifzMistake {
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

interface HifzCounts {
  correct: number;
  close: number;
  wrong: number;
  skipped: number;
}

interface HifzAttempt {
  id: string;
  surah: number;
  page: number | null;
  status: string;
  engine: string;
  counts: HifzCounts;
  created_at: string;
}

interface HifzGrade {
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

interface HifzStatus {
  engine: string;
  available: boolean;
  reason: string;
}

/** Live word events (v2 envelope) live in lib/quran-audio.ts. */

interface WallWord {
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

/**
 * Build the render lines for ONE printed page (pure — no hooks).
 * Ayahs whose study words match the printed segment totals render
 * in line slots (revealed when written, hidden otherwise); every
 * other segment uses its printed tokens as hidden spacers, so marker
 * positions stay true. For a surah with a Basmalah line on this
 * page, ayah 1's printed segments exclude the four Basmalah words,
 * so the study total is compared minus four.
 * Used for the current page (page/card mode) and for every page of
 * the surah (scroll mode).
 */
function buildPageRender(
  pageLines: MushafExactLine[],
  surah: number,
  texts: Record<number, string> | undefined,
  wallAyahs: { ayah: number; words: WallWord[] }[],
): { placedAyahs: Set<number>; basmalaSplit: boolean; renderLines: RenderLine[] } {
  const empty = {
    placedAyahs: new Set<number>(),
    basmalaSplit: false,
    renderLines: [] as RenderLine[],
  };
  if (!texts) return empty;
  const split = basmalaSurahsOnPage(pageLines).has(surah);
  const totals = new Map<number, number>();
  for (const line of pageLines) {
    const parsed = parseTextLine(line);
    if (!parsed || parsed.surah !== surah) continue;
    for (const seg of parsed.segments) {
      totals.set(seg.ayah, (totals.get(seg.ayah) ?? 0) + seg.words.length);
    }
  }
  const placed = new Set<number>();
  for (const [a, total] of totals) {
    const words = (texts[a] ?? '').split(/\s+/).filter(Boolean);
    const expected = a === 1 && split ? words.length - 4 : words.length;
    if (words.length > 0 && total === expected) placed.add(a);
  }
  const writtenByKey = new Map<string, WallWord>();
  for (const group of wallAyahs) {
    for (const w of group.words) writtenByKey.set(`${group.ayah}:${w.index}`, w);
  }
  const consumed = new Map<number, number>();
  const out: RenderLine[] = [];
  pageLines.forEach((line, li) => {
    if (line.t === 'surah-header') {
      if (line.x) out.push({ kind: 'header', key: `h${li}`, text: line.x });
      return;
    }
    if (line.t === 'basmala') {
      const next = pageLines[li + 1];
      const [s, a] = (next?.v ?? '').split(':').map(Number);
      const slots: LineWordSlot[] = [];
      if (next?.t === 'text' && a === 1 && s === surah && placed.has(1) && texts?.[1]) {
        const words = texts[1].split(/\s+/).filter(Boolean).slice(0, 4);
        words.forEach((text, i) => {
          const written = writtenByKey.get(`1:${i}`) ?? null;
          slots.push({
            kind: 'word',
            surah,
            ayah: 1,
            index: i,
            text,
            written,
            hidden: written === null,
          });
        });
      }
      out.push({ kind: 'basmala', key: `b${li}`, slots });
      return;
    }
    const parsed = parseTextLine(line);
    if (!parsed) return;
    const slots: LineSlot[] = [];
    for (const seg of parsed.segments) {
      if (parsed.surah === surah && placed.has(seg.ayah) && texts?.[seg.ayah]) {
        const study = texts[seg.ayah].split(/\s+/).filter(Boolean);
        const start = consumed.get(seg.ayah) ?? (seg.ayah === 1 && split ? 4 : 0);
        seg.words.forEach((_, i) => {
          for (const off of seg.ornaments) {
            if (off === i) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
          }
          const index = start + i;
          const text = study[index];
          if (text === undefined) return;
          const written = writtenByKey.get(`${seg.ayah}:${index}`) ?? null;
          slots.push({
            kind: 'word',
            surah,
            ayah: seg.ayah,
            index,
            text,
            written,
            hidden: written === null,
          });
        });
        for (const off of seg.ornaments) {
          if (off === seg.words.length) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
        }
        consumed.set(seg.ayah, start + seg.words.length);
      } else {
        seg.words.forEach((tok, i) => {
          for (const off of seg.ornaments) {
            if (off === i) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
          }
          slots.push({
            kind: 'word',
            surah: parsed.surah,
            ayah: seg.ayah,
            index: -1,
            text: tok,
            written: null,
            hidden: true,
          });
        });
        for (const off of seg.ornaments) {
          if (off === seg.words.length) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
        }
      }
      if (seg.marker !== null) slots.push({ kind: 'marker', text: seg.marker });
    }
    out.push({ kind: 'text', key: `t${li}`, slots });
  });
  return { placedAyahs: placed, basmalaSplit: split, renderLines: out };
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

/** Ayah-end marker as an ornate rosette (own SVG, like the printed
    mushaf): an 8-petal ring with a small knob on top and the ayah
    number inside. Replaces the old plain double-ring circle. */
function HifzRosette({ digit }: { digit: string }) {
  return (
    <span className="hifz-line-marker" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="presentation" focusable="false">
        <g fill="none" stroke="#8a8378" strokeWidth="1.6">
          <circle cx="24" cy="24" r="14" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path
              key={a}
              d="M24 4.5 L26.8 9.5 L24 12.5 L21.2 9.5 Z"
              transform={`rotate(${a} 24 24)`}
            />
          ))}
          <circle cx="24" cy="2.5" r="1.4" />
        </g>
        <text x="24" y="29.5" textAnchor="middle" fontSize="15" fill="#57534e">
          {digit}
        </text>
      </svg>
    </span>
  );
}

const HIFZ_API = '/api/v1/quran/hifz';

/** Encode Float32 mono samples as a 16-bit PCM WAV blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function QuranHifzStudy({
  locale,
  surahList,
  initialSurah,
  initialAyah,
  initialTexts,
  labels,
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
    setAyah(1);
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

  // Line data loads once (dynamic import, like the reader's search
  // index); a failed load returns null and the wall takes over.
  useEffect(() => {
    let cancelled = false;
    loadMushafLines().then((pages) => {
      if (!cancelled) setMushafPages(pages);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Juz/hizb/page boundaries load once, for the header.
  useEffect(() => {
    let cancelled = false;
    loadBoundaries().then((b) => {
      if (!cancelled) setBoundaries(b);
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
  const listen = useQuranListen({
    reciter: listenReciter,
    surah,
    ayahTexts: textsBySurah[surah] ?? {},
    ayahAudioUrls,
    ayahCount,
    audioRef: listenAudioRef,
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
  const pageReady = pageLines !== null;
  const pageFailed = mushafPages !== undefined && !pageReady;
  // Surah texts settled (loaded, or failed): only then may the wall
  // claim an ayah is unplaced. While they still load, placedAyahs is
  // empty by construction and the wall would wrongly swallow the
  // whole surah, so both the page and the wall wait.
  const textsReady = textsBySurah[surah] !== undefined;
  const textsSettled = textsReady || textsFailed;

  // The current page's render lines (placed ayahs + line slots),
  // built by the pure buildPageRender helper. Scroll mode calls the
  // same helper for every page of the surah.
  const pageRender = useMemo(
    () =>
      pageLines
        ? buildPageRender(pageLines, surah, textsBySurah[surah], wallAyahs)
        : {
            placedAyahs: new Set<number>(),
            basmalaSplit: false,
            renderLines: [] as RenderLine[],
          },
    [pageLines, textsBySurah, surah, wallAyahs],
  );
  const { placedAyahs, renderLines } = pageRender;

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
    try {
      const created = await authJson<HifzAttempt>(`${HIFZ_API}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surah, page: null }),
      });
      setAttempt(created);
      return created.id;
    } catch {
      setError(labels.noAttemptHint);
      return null;
    }
  }, [attempt, labels.noAttemptHint, surah]);

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
    // Pause is a CLIENT-side hold: the server has no pause state.
    // The capture context is suspended, so no frames leave the
    // page and the timer stops; the socket stays open and the
    // session resumes exactly where it left off. A long pause may
    // still be cut by the server (then it surfaces as interrupted).
    if (liveState !== 'listening') return;
    const mic = liveMicRef.current;
    if (mic) void mic.ctx.suspend().catch(() => { /* already suspended */ });
    setLiveState('paused');
  }, [liveState]);

  const resumeLive = useCallback(() => {
    if (liveState !== 'paused') return;
    const mic = liveMicRef.current;
    if (mic) {
      void mic.ctx.resume().catch(() => {
        /* resume needs a gesture; the tap that called this is one */
      });
    }
    setLiveState('listening');
  }, [liveState]);

  // Reveal words by Peek: one shared path for the next word and
  // for the rest of the ayah. The words are always the NEXT
  // unwritten words of the CURRENT ayah (peekTarget's ayah) —
  // never random and never past the ayah. Authenticated: one POST
  // with the index list (the server inserts one peek mistake per
  // word, each with status `peeked`); guest: the same words go to
  // revealedLocal with the same status.
  const revealWords = useCallback(async (ayahNum: number, indices: number[]) => {
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
        }),
      });
      await refreshDetail(attemptId);
    } catch {
      setError(labels.errorGeneric);
    }
  }, [authed, ensureAttempt, refreshDetail, surah, labels.errorGeneric]);

  const peekNext = useCallback(async () => {
    if (!peekTarget) return;
    await revealWords(peekTarget.ayah, [peekTarget.index]);
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
    await revealWords(peekTarget.ayah, indices);
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
  const timerText = useMemo(() => {
    const m = Math.floor(sessionSeconds / 60);
    const s = sessionSeconds % 60;
    return `${toArabicIndic(m)}:${toArabicIndic(s).padStart(2, '٠')}`;
  }, [sessionSeconds]);

  // Listen progress as M:SS (same digits as the session timer).
  const formatListenMs = useCallback((ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${toArabicIndic(m)}:${toArabicIndic(s).padStart(2, '٠')}`;
  }, []);

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
    if (!mushafPages) return [];
    const first = pageIndexFor(mushafPages, surah, 1);
    if (first === null) return [];
    const last = pageIndexFor(mushafPages, surah, ayahCount || 1) ?? first;
    const out: number[] = [];
    for (let p = first; p <= last; p += 1) out.push(p);
    return out;
  }, [mushafPages, surah, ayahCount]);

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
        return (
          <span
            key={key}
            className={[
              'hifz-line-word',
              'hifz-word-listen',
              isListenNow ? 'hifz-word-listen-now' : '',
            ].join(' ')}
          >
            {renderTajweedText(slot.text)}
          </span>
        );
      }
      return (
        <span key={key} className="hifz-line-word-hidden" aria-hidden="true">
          {slot.text}
        </span>
      );
    }
    const w = slot.written;
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
  const micOnClick = (): void => {
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
    if (pageIndex === null) return;
    const el = scrollPageRefs.current.get(pageIndex);
    if (el) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [displayMode, pageIndex, ayah]);

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

  // Accuracy pill color: green >=95, amber 80-95, red <80.
  const accuracyTone =
    pillStats.accuracy >= 95 ? 'hifz-pill-green' : pillStats.accuracy >= 80 ? 'hifz-pill-amber' : 'hifz-pill-red';

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
    <div className="quran-hifz-study" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header (Tarteel): surah name + page/juz/hizb + the current
          surah:ayah while a live session runs. */}
      <header className="hifz-header">
        <h2 className="hifz-title">{labels.title}</h2>
        <p className="hifz-header-sub">
          {surahName}
          {headerRange &&
            headerRange.page !== null &&
            headerRange.juz !== null &&
            headerRange.hizb !== null && (
              <>
                {' · '}
                {labels.headerPage} {toArabicIndic(headerRange.page)} {' · '}
                {labels.headerJuz} {toArabicIndic(headerRange.juz)} {' · '}
                {labels.headerHizb} {toArabicIndic(headerRange.hizb)}
              </>
            )}
          {liveActive && (
            <>
              {' · '}
              <span className="hifz-header-pos">
                {toArabicIndic(surah)}:{toArabicIndic(ayah)}
              </span>
            </>
          )}
        </p>
      </header>

      {/* Mode toggle: practice (recite) or listen (follow the reciter). */}
      <div className="hifz-mode-toggle" role="group" aria-label={labels.displayMode}>
        <button
          type="button"
          aria-pressed={studyMode === 'practice'}
          className={studyMode === 'practice' ? 'is-active' : ''}
          onClick={() => {
            listen.stop();
            setStudyMode('practice');
          }}
        >
          {labels.modePractice}
        </button>
        <button
          type="button"
          aria-pressed={studyMode === 'listen'}
          className={studyMode === 'listen' ? 'is-active' : ''}
          onClick={() => setStudyMode('listen')}
        >
          {labels.modeListen}
        </button>
      </div>

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
                {s.number} — {s.nameAr}
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
                  {n}
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

      {/* Listen controls: reciter picker + play/pause/resume/stop +
          prev/next ayah + repeat + speed + progress bar + current
          ayah, and the timing-source note (real vs estimated). */}
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
          <p className="hifz-hint" aria-live="polite">
            {labels.listenCurrentAyah}: {toArabicIndic(listen.currentAyah)}
            {ayahCount > 0 ? ` / ${toArabicIndic(ayahCount)}` : ''}
          </p>
          {listen.isPlaying ? (
            <button type="button" onClick={() => listen.pause()}>
              {labels.listenPause}
            </button>
          ) : (
            <button type="button" onClick={() => listen.resume()}>
              {labels.listenResume}
            </button>
          )}
          <button type="button" onClick={() => listen.stop()}>
            {labels.listenStop}
          </button>
          <button
            type="button"
            onClick={() => listen.prevAyah()}
            disabled={listen.currentAyah <= 1}
            aria-label={labels.listenPrevAyah}
          >
            {labels.listenPrevAyah}
          </button>
          <button
            type="button"
            onClick={() => listen.nextAyah()}
            disabled={ayahCount > 0 && listen.currentAyah >= ayahCount}
            aria-label={labels.listenNextAyah}
          >
            {labels.listenNextAyah}
          </button>
          <label>
            {labels.listenRepeat}
            <select
              value={listen.repeatMode}
              onChange={(e) =>
                listen.setRepeatMode(
                  e.target.value as 'off' | 'ayah' | 'surah',
                )
              }
              aria-label={labels.listenRepeat}
            >
              <option value="off">{labels.listenRepeatOff}</option>
              <option value="ayah">{labels.listenRepeatAyah}</option>
              <option value="surah">{labels.listenRepeatSurah}</option>
            </select>
          </label>
          <label>
            {labels.listenSpeed}
            <select
              value={String(listen.speed)}
              onChange={(e) => listen.setSpeed(Number(e.target.value))}
              aria-label={labels.listenSpeed}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <option key={rate} value={String(rate)}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
          {listen.durationMs > 0 && (
            <div className="hifz-listen-progress">
              <input
                type="range"
                min={0}
                max={listen.durationMs}
                step={250}
                value={Math.min(listen.progressMs, listen.durationMs)}
                onChange={(e) => listen.seek(Number(e.target.value))}
                aria-label={labels.listenProgress}
              />
              <span>
                {formatListenMs(listen.progressMs)} /{' '}
                {formatListenMs(listen.durationMs)}
              </span>
            </div>
          )}
          {listen.timingSource === 'segments' && (
            <p className="hifz-hint">{labels.listenSegmentsNote}</p>
          )}
          {listen.timingSource === 'interpolated' && (
            <p className="hifz-hint">{labels.listenInterpolatedNote}</p>
          )}
          {listen.listenError && (
            <p className="hifz-error" role="alert">
              {labels.listenAudioFailed}
            </p>
          )}
          {/* The listen audio element (hidden). */}
          <audio ref={listenAudioRef} preload="metadata" />
        </div>
      )}

      {/* Live pills (Tarteel): error count (red), accuracy % (color
          by range), session timer (gray, counts up). Shown while a
          live session runs; the timer disappears after stop. */}
      {showPills && studyMode === 'practice' && (
        <div className="hifz-pills" aria-live="polite">
          <span className="hifz-pill hifz-pill-red">
            {labels.pillErrors}: {toArabicIndic(pillStats.errors)}
          </span>
          {/* Provisional (live words present, stored grade not yet
              arrived): show a count, not a percent — the uncalibrated
              live score is not a final percentage. When no live words
              are present the stored grade's final percent stands. */}
          {liveWords.length > 0 ? (
            <span className="hifz-pill hifz-pill-gray">
              {labels.pillAccuracy}: {toArabicIndic(pillStats.correct)} از{' '}
              {toArabicIndic(pillStats.total)}
            </span>
          ) : (
            <span className={`hifz-pill ${accuracyTone}`}>
              {labels.pillAccuracy}: {pillStats.accuracy}٪
            </span>
          )}
          {liveState === 'listening' && (
            <span className="hifz-pill hifz-pill-gray">
              {labels.pillTimer}: {timerText}
            </span>
          )}
        </div>
      )}

      {/* The blank line page: faint markers from the start, words
          written in Uthmanic font as recited. While the line data
          loads, a loading note; on page failure, the wall below
          takes over entirely (see svgFailedNote). */}
      {mushafPages === undefined && (
        <p className="hifz-line-loading">{labels.loadingPage}</p>
      )}
      {pageReady && textsReady && displayMode === 'page' && renderPageSection(pageIndex ?? 0, renderLines, 'page')}
      {pageReady && textsReady && displayMode === 'card' && (
        <div className="hifz-card-frame">{renderPageSection(pageIndex ?? 0, renderLines, 'card')}</div>
      )}
      {pageReady && textsReady && displayMode === 'scroll' && (
        <div className="hifz-scroll-pages">
          {surahPageIndices.map((pIdx) => {
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
                {surahName} — {group.ayah}
              </p>
              <div className="hifz-wall-words" dir="rtl">
                {group.words.map((word) => {
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
          the session (never as an end-of-session results page). */}
      <div className="hifz-bottom-bar">
        <button
          type="button"
          onClick={() => setErrorSheetOpen(true)}
          aria-label={labels.errorsOpen}
        >
          {labels.errorsTitle}
        </button>
        <button type="button" disabled={!peekTarget} onClick={() => void peekNext()}>
          {labels.peekWord}
        </button>
        <button type="button" disabled={!peekTarget} onClick={() => void peekAyah()}>
          {labels.peekAyah}
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
          disabled={pageIndex === null || pageIndex <= 0}
          onClick={() => {
            if (pageIndex === null || !mushafPages) return;
            const prev = pageIndex - 1;
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
          disabled={pageIndex === null || !mushafPages || pageIndex >= mushafPages.length - 1}
          onClick={() => {
            if (pageIndex === null || !mushafPages) return;
            const next = pageIndex + 1;
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

      {/* Error sheet (bottom sheet, opened by hand during the
          session): wrong words (expected vs recited) and extra words.
          No end-of-session results page exists. */}
      {errorSheetOpen && (
        <div className="hifz-error-sheet" role="dialog" aria-label={labels.errorsTitle}>
          <div className="hifz-error-sheet-head">
            <h3>{labels.errorsTitle}</h3>
            <button type="button" onClick={() => setErrorSheetOpen(false)}>
              {labels.errorsClose}
            </button>
          </div>
          <h4>{labels.errorsWrong}</h4>
          {errorWords.length === 0 ? (
            <p>{labels.errorsEmpty}</p>
          ) : (
            <ul>
              {errorWords.map((w) => (
                <li key={`${w.ayah}:${w.index}`}>
                  <span className="hifz-error-expected">{w.expected}</span>{' '}
                  <span className="hifz-error-meta">
                    {labels.errorsExpected}: {w.expected}
                    {w.heard ? ` · ${labels.errorsHeard}: ${w.heard}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h4>{labels.errorsExtra}</h4>
          {liveExtraWords.length === 0 && liveExtraCount === 0 ? (
            <p>{labels.errorsEmpty}</p>
          ) : liveExtraWords.length > 0 ? (
            <ul>
              {liveExtraWords.map((t, i) => (
                <li key={i} className="hifz-error-extra">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {labels.errorsExtra}: {toArabicIndic(liveExtraCount)}
            </p>
          )}
        </div>
      )}

      <p className="hifz-disclaimer">{labels.disclaimer}</p>
    </div>
  );
}
