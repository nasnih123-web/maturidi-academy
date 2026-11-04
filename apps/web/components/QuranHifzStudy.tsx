'use client';

/**
 * QuranHifzStudy: Phase 3 (hifz) study screen, Tarteel-style blank
 * mushaf page with true line layout.
 *
 * The study screen is a WHITE blank page in true mushaf LINE layout:
 * the 15-line Madinah page breaks come from the bundled line data
 * (lib/quran-mushaf-lines.json, QPC1 Hafs), faint ayah-end markers
 * are visible from the start at their line positions, and as the
 * memorizer recites, text is WRITTEN word-by-word in UthmanicHafs
 * font into its line slots. Words appear with live colors:
 * green >=0.8 / amber 0.5-0.8 / red <0.5 / gray skipped, thresholds
 * from the CRM settings. Unwritten words occupy hidden slots
 * (visibility:hidden) so marker positions never jump as words are
 * revealed; the page looks blank until written.
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
 *   the page fills LIVE. Audio is transient, never stored.
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
 * grading, history, SRS and stats need sign-in (honest hint, never
 * fake saved state).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api-base';
import { authFetch, authJson, getAccessToken } from '@/lib/auth-client';
import { getSurah, type SurahSummary } from '@/lib/quran';
import { loadMushafLines, type MushafExactLine } from '@/lib/quran-mushaf-lines';

/** Arabic-Indic digits, as printed at ayah ends. */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** True for a pure Arabic-Indic digit token: an ayah-end marker. */
function isMarkerToken(tok: string): boolean {
  return tok.length > 0 && [...tok].every((c) => ARABIC_INDIC.includes(c));
}

interface LineSegment {
  ayah: number;
  /** Printed words of this ayah on this line, in order. */
  words: string[];
  /** Ayah-end marker printed after these words, if any. */
  marker: string | null;
}

interface ParsedTextLine {
  surah: number;
  segments: LineSegment[];
}

/**
 * Parse one printed text line into per-ayah segments. A marker token
 * ends its ayah: the words before it belong to that ayah, the next
 * ayah starts after it. Returns null for non-text lines, lines
 * without a verse range, or lines whose range spans two surahs
 * (never happens in the data; defensive).
 */
function parseTextLine(line: MushafExactLine): ParsedTextLine | null {
  if (line.t !== 'text' || !line.x || !line.v || !line.w) return null;
  const [vs, va] = line.v.split(':').map(Number);
  const [ws] = line.w.split(':').map(Number);
  if (!Number.isFinite(vs) || !Number.isFinite(va) || ws !== vs) return null;
  const segments: LineSegment[] = [];
  let ayah = va;
  let words: string[] = [];
  for (const tok of line.x.split(/\s+/).filter(Boolean)) {
    if (isMarkerToken(tok)) {
      segments.push({ ayah, words, marker: tok });
      words = [];
      ayah += 1;
    } else {
      words.push(tok);
    }
  }
  if (words.length > 0) segments.push({ ayah, words, marker: null });
  return { surah: vs, segments };
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

type LineSlot = LineWordSlot | LineMarkerSlot;

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
  startSession: string;
  sessionActive: string;
  completeSession: string;
  sessionCompleted: string;
  recordGrade: string;
  stopRecording: string;
  recording: string;
  grading: string;
  practiceWordHint: string;
  practiceWord: string;
  clearPractice: string;
  peek: string;
  dispute: string;
  disputed: string;
  disclaimer: string;
  signInHint: string;
  engineLabel: string;
  engineUnavailable: string;
  countsTitle: string;
  correctLabel: string;
  closeLabel: string;
  wrongLabel: string;
  skippedLabel: string;
  extraLabel: string;
  reviewTitle: string;
  reviewEmpty: string;
  historyTitle: string;
  historyEmpty: string;
  statsTitle: string;
  attemptsLabel: string;
  gradedWordsLabel: string;
  dominantMistakeLabel: string;
  dueLabel: string;
  selectAyahHint: string;
  svgFailedNote: string;
  loadingPage: string;
  errorGeneric: string;
  noAttemptHint: string;
  revealedByPeek: string;
  heardLabel: string;
  liveStart: string;
  liveStop: string;
  liveListening: string;
  liveConnecting: string;
  liveEnded: string;
  liveOnlyZipformer: string;
  ayahLabel: string;
  prevAyah: string;
  nextAyah: string;
  wallHint: string;
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

interface HifzStats {
  attempts: number;
  graded_words: number;
  counts: HifzCounts;
  dominant_mistake: string | null;
  due_ayahs: number;
}

interface HifzReview {
  surah: number;
  ayah: number;
  mistake_count: number;
  last_activity_at: string;
}

interface HifzStatus {
  engine: string;
  available: boolean;
  reason: string;
}

interface LiveWordEvent {
  type: 'word';
  surah: number;
  ayah: number;
  word_index: number;
  expected: string;
  status: 'correct' | 'close' | 'wrong' | 'skipped';
  prob: number;
  heard: string | null;
}

interface WallWord {
  ayah: number;
  index: number;
  text: string;
  status: 'correct' | 'close' | 'wrong' | 'skipped' | 'peeked';
  prob: number;
  heard: string | null;
  scoreId: string | null;
  disputed: boolean;
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
  labels,
}: {
  locale: string;
  surahList: SurahSummary[];
  initialSurah: number;
  /** Ignored: the line data is always Hafs (see header). */
  initialMushaf: string;
  labels: HifzLabels;
}) {
  const [surah, setSurah] = useState(initialSurah);
  const [ayah, setAyah] = useState(1);
  const [ayahCount, setAyahCount] = useState(0);
  const [textsBySurah, setTextsBySurah] = useState<Record<number, Record<number, string>>>({});
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
  const [liveState, setLiveState] = useState<'idle' | 'connecting' | 'listening' | 'ended'>('idle');
  const [liveWords, setLiveWords] = useState<LiveWordEvent[]>([]);
  const [liveExtraCount, setLiveExtraCount] = useState(0);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastGrade, setLastGrade] = useState<HifzGrade | null>(null);
  const [engineStatus, setEngineStatus] = useState<HifzStatus | null>(null);
  const [stats, setStats] = useState<HifzStats | null>(null);
  const [review, setReview] = useState<HifzReview[]>([]);
  const [history, setHistory] = useState<HifzAttempt[]>([]);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveMicRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    proc: ScriptProcessorNode;
  } | null>(null);
  const liveWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Line page: the bundled 15-line Madinah page of the SELECTED
  // ayah (undefined = loading, null = load failed). The page
  // follows the selected ayah only: when live writing advances to
  // another page, those ayahs stay in the wall below. The page
  // never jumps mid-recitation.
  const [mushafPages, setMushafPages] = useState<MushafExactLine[][] | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setAuthed(Boolean(getAccessToken()));
    fetch(`${apiBaseUrl()}${HIFZ_API}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: HifzStatus | null) => setEngineStatus(j))
      .catch(() => {});
  }, []);

  // Surah change: load its ayah texts (public) and restart at ayah 1.
  useEffect(() => {
    let cancelled = false;
    getSurah(surah)
      .then((view) => {
        if (cancelled) return;
        const texts: Record<number, string> = {};
        for (const a of view.ayahs) texts[a.number] = a.text;
        setTextsBySurah((prev) => ({ ...prev, [surah]: texts }));
        setAyahCount(view.ayahs.length);
      })
      .catch(() => {});
    setAyah(1);
    setPracticeWord(null);
    return () => {
      cancelled = true;
    };
  }, [surah]);

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

  const refreshPanels = useCallback(async () => {
    try {
      const [s, r, h] = await Promise.all([
        authJson<HifzStats>(`${HIFZ_API}/stats`),
        authJson<HifzReview[]>(`${HIFZ_API}/review`),
        authJson<HifzAttempt[]>(`${HIFZ_API}/attempts?limit=20`),
      ]);
      setStats(s);
      setReview(r);
      setHistory(h);
    } catch {
      /* panels stay empty; grading still works */
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    void refreshPanels();
    // Resume the user's in-progress attempt for this surah (if any):
    // without this, a returning student would see an empty wall and
    // their earlier scores would only appear via the history list.
    void (async () => {
      try {
        const list = await authJson<HifzAttempt[]>(`${HIFZ_API}/attempts?limit=5`);
        const current =
          list.find((a) => a.surah === surah && a.status === 'in_progress') ??
          list.find((a) => a.surah === surah);
        if (current) await refreshDetail(current.id);
      } catch {
        /* grading still works; the wall just starts fresh */
      }
    })();
  }, [authed, refreshPanels, refreshDetail, surah]);

  // Stop the live stream when leaving the screen.
  useEffect(
    () => () => {
      liveWsRef.current?.close();
      const mic = liveMicRef.current;
      if (mic) {
        mic.stream.getTracks().forEach((t) => t.stop());
        void mic.ctx.close();
      }
      if (liveWatchdogRef.current) clearTimeout(liveWatchdogRef.current);
    },
    [],
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

  // Ayahs of the current surah whose study words match the printed
  // segment totals on this page: only those render in line slots.
  // Every other written ayah (mismatch, or not on this page) stays
  // in the wall below. For a surah with a Basmalah line on this
  // page, ayah 1's printed segments exclude the four Basmalah words,
  // so the study total is compared minus four.
  const { placedAyahs, basmalaSplit } = useMemo(() => {
    const empty = { placedAyahs: new Set<number>(), basmalaSplit: false };
    if (!pageLines) return empty;
    const texts = textsBySurah[surah];
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
    return { placedAyahs: placed, basmalaSplit: split };
  }, [pageLines, textsBySurah, surah]);

  // The page's render lines, in order. Placed ayahs use study words
  // (revealed when written, hidden otherwise); every other segment
  // uses its printed tokens as hidden spacers, so marker positions
  // stay true and the page keeps its shape. Markers are always
  // visible, faint, at their printed positions.
  const renderLines = useMemo<RenderLine[]>(() => {
    if (!pageLines) return [];
    const texts = textsBySurah[surah];
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
        if (next?.t === 'text' && a === 1 && s === surah && placedAyahs.has(1) && texts?.[1]) {
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
        if (parsed.surah === surah && placedAyahs.has(seg.ayah) && texts?.[seg.ayah]) {
          const study = texts[seg.ayah].split(/\s+/).filter(Boolean);
          const start = consumed.get(seg.ayah) ?? (seg.ayah === 1 && basmalaSplit ? 4 : 0);
          seg.words.forEach((_, i) => {
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
          consumed.set(seg.ayah, start + seg.words.length);
        } else {
          for (const tok of seg.words) {
            slots.push({
              kind: 'word',
              surah: parsed.surah,
              ayah: seg.ayah,
              index: -1,
              text: tok,
              written: null,
              hidden: true,
            });
          }
        }
        if (seg.marker !== null) slots.push({ kind: 'marker', text: seg.marker });
      }
      out.push({ kind: 'text', key: `t${li}`, slots });
    });
    return out;
  }, [pageLines, textsBySurah, surah, wallAyahs, placedAyahs, basmalaSplit]);

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
    if (attempt) return attempt.id;
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
            setLastGrade(grade);
            await refreshDetail(attemptId);
            await refreshPanels();
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
    refreshPanels,
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
        mic.proc.disconnect();
      } catch {
        /* already disconnected */
      }
      mic.stream.getTracks().forEach((t) => t.stop());
      void mic.ctx.close();
      liveMicRef.current = null;
    }
  }, []);

  const startLive = useCallback(async () => {
    if (!authed) {
      setError(labels.signInHint);
      return;
    }
    const attemptId = await ensureAttempt();
    if (!attemptId) return;
    setLiveError(null);
    setLiveState('connecting');
    try {
      const ticketRes = await authFetch('/api/v1/auth/ws-ticket', { method: 'POST' });
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
        ws.send(JSON.stringify({ type: 'start', surah, ayah }));
        setLiveState('listening');
      };
      ws.onmessage = (ev: MessageEvent) => {
        let msg: { type?: string; message?: string } & Partial<LiveWordEvent>;
        try {
          msg = JSON.parse(ev.data as string) as typeof msg;
        } catch {
          return;
        }
        if (msg.type === 'word') {
          setLiveWords((prev) => [...prev, msg as LiveWordEvent]);
        } else if (msg.type === 'extra') {
          setLiveExtraCount((c) => c + 1);
        } else if (msg.type === 'final') {
          if (liveWatchdogRef.current) clearTimeout(liveWatchdogRef.current);
          setLiveState('ended');
          void refreshDetail(attemptId);
          void refreshPanels();
        } else if (msg.type === 'error') {
          if (liveWatchdogRef.current) clearTimeout(liveWatchdogRef.current);
          cleanupLiveMic();
          setLiveError(msg.message ?? labels.errorGeneric);
          setLiveState('idle');
        }
      };
      ws.onerror = () => {
        cleanupLiveMic();
        setLiveError(labels.errorGeneric);
        setLiveState('idle');
      };
      // Microphone at the model's native rate: 16 kHz mono. Frames go
      // out as Int16LE over the socket and are never stored anywhere.
      // ScriptProcessorNode is deprecated but needs no extra worklet
      // file; the frame size (4096) is small enough for live colors.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 },
      });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e: AudioProcessingEvent) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const buf = new ArrayBuffer(input.length * 2);
        const view = new DataView(buf);
        for (let i = 0; i < input.length; i += 1) {
          const s = Math.max(-1, Math.min(1, input[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        ws.send(buf);
      };
      src.connect(proc);
      proc.connect(ctx.destination);
      liveMicRef.current = { stream, ctx, proc };
    } catch {
      cleanupLiveMic();
      setLiveError(labels.errorGeneric);
      setLiveState('idle');
    }
  }, [authed, ensureAttempt, labels, surah, ayah, refreshDetail, refreshPanels, cleanupLiveMic]);

  const stopLive = useCallback(() => {
    const ws = liveWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end' }));
    }
    cleanupLiveMic();
    // If the server never answers with final, do not hang in
    // "listening" forever: close after 10s and let the user retry.
    if (liveWatchdogRef.current) clearTimeout(liveWatchdogRef.current);
    liveWatchdogRef.current = setTimeout(() => {
      liveWsRef.current?.close();
      setLiveState((s) => (s === 'listening' ? 'idle' : s));
    }, 10000);
  }, [cleanupLiveMic]);

  const peekNext = useCallback(async () => {
    if (!peekTarget) return;
    if (!authed) {
      setRevealedLocal((prev) => {
        const next = new Set(prev);
        next.add(`${surah}:${peekTarget.ayah}:${peekTarget.index}`);
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
          ayah: peekTarget.ayah,
          word_index: peekTarget.index,
        }),
      });
      await refreshDetail(attemptId);
      await refreshPanels();
    } catch {
      setError(labels.errorGeneric);
    }
  }, [peekTarget, authed, ensureAttempt, refreshDetail, refreshPanels, surah, labels.errorGeneric]);

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

  const completeSession = useCallback(async () => {
    if (!attempt) return;
    try {
      await authJson(`${HIFZ_API}/attempts/${attempt.id}/complete`, {
        method: 'POST',
      });
      await refreshDetail(attempt.id);
      await refreshPanels();
    } catch {
      setError(labels.errorGeneric);
    }
  }, [attempt, labels.errorGeneric, refreshDetail, refreshPanels]);

  const surahName =
    surahList.find((s) => s.number === surah)?.nameAr ?? String(surah);

  // Mistake codes are API values; show the Persian word for them.
  const dominantMistakeText =
    stats?.dominant_mistake === 'skipped'
      ? labels.skippedLabel
      : stats?.dominant_mistake === 'wrong_word' ||
          stats?.dominant_mistake === 'wrong_tashkeel'
        ? labels.wrongLabel
        : (stats?.dominant_mistake ?? '—');

  const isZipformer = engineStatus?.engine === 'zipformer';
  const isWhisper = engineStatus?.engine === 'whisper_quran';

  // One line-page word slot: a hidden slot (unwritten, or a printed
  // spacer) renders invisible but keeps its place; a written slot
  // renders its status color, practice selection, and dispute.
  const renderLineWord = (slot: LineWordSlot, key: string) => {
    if (slot.hidden || slot.written === null) {
      return (
        <span key={key} className="hifz-line-word-hidden" aria-hidden="true">
          {slot.text}
        </span>
      );
    }
    const w = slot.written;
    const isPractice = practiceWord?.ayah === slot.ayah && practiceWord?.index === slot.index;
    return (
      <span
        key={key}
        className={[
          'hifz-line-word',
          w.status === 'peeked' ? 'hifz-word-peeked' : `hifz-word-${w.status}`,
          isPractice ? 'hifz-word-practice' : '',
        ].join(' ')}
      >
        <button
          type="button"
          className="hifz-word-text"
          onClick={() =>
            setPracticeWord({ ayah: slot.ayah, index: slot.index, text: slot.text })
          }
          title={w.heard ? `${labels.heardLabel} ${w.heard}` : labels.practiceWordHint}
        >
          {slot.text}
        </button>
        {w.status !== 'peeked' &&
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
  const micActive =
    (isZipformer && liveState === 'listening') || (isWhisper && recState === 'recording');
  const micBusy = liveState === 'connecting' || recState === 'processing';
  const micLabel = isZipformer
    ? micActive
      ? labels.liveStop
      : labels.liveStart
    : micActive
      ? labels.stopRecording
      : labels.recordGrade;
  const micOnClick = (): void => {
    if (isZipformer) {
      if (liveState === 'listening') stopLive();
      else void startLive();
    } else if (isWhisper) {
      if (recState === 'recording') stopRecording();
      else void startRecording();
    }
  };

  return (
    <div className="quran-hifz-study" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
      <h2 className="hifz-title">{labels.title}</h2>

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

      {/* The blank line page: faint markers from the start, words
          written in Uthmanic font as recited. While the line data
          loads, a loading note; on page failure, the wall below
          takes over entirely (see svgFailedNote). */}
      {mushafPages === undefined && (
        <p className="hifz-line-loading">{labels.loadingPage}</p>
      )}
      {pageReady && (
        <section className="hifz-line-page" aria-label={labels.title}>
          <p className="hifz-line-caption">
            {surahName} · {labels.pageLabel} {(pageIndex ?? 0) + 1}
          </p>
          {renderLines.map((line) => {
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
                    {' '}
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
                    <span key={`m${si}`} className="hifz-line-marker" aria-hidden="true">
                      {slot.text}
                    </span>
                  ) : (
                    renderLineWord(slot, `${line.key}-${si}`)
                  ),
                )}
              </p>
            );
          })}
        </section>
      )}

      {/* The wall: everything when the page failed, otherwise only the
          ayahs whose words are NOT placed on the line page. Nothing
          written yet on a ready page means no wall section at all (the
          blank page above is the whole state). */}
      {(pageFailed || (pageReady && unplacedGroups.length > 0)) && (
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
                  return (
                    <span
                      key={word.index}
                      className={[
                        'hifz-word',
                        word.status === 'peeked'
                          ? 'hifz-word-peeked'
                          : `hifz-word-${word.status}`,
                        isPractice ? 'hifz-word-practice' : '',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        className="hifz-word-text"
                        onClick={() =>
                          setPracticeWord({ ayah: group.ayah, index: word.index, text: word.text })
                        }
                        title={labels.practiceWordHint}
                      >
                        {word.text}
                      </button>
                      {word.status !== 'peeked' &&
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
                      {word.heard && (
                        <span className="hifz-word-heard">
                          {labels.heardLabel} {word.heard}
                        </span>
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

      <div className="hifz-controls">
        <button type="button" disabled={!peekTarget} onClick={() => void peekNext()}>
          {labels.peek}
        </button>
        {isZipformer && liveState === 'listening' && (
          <p className="hifz-hint">{labels.liveListening}</p>
        )}
        {isZipformer && liveState === 'ended' && <p className="hifz-hint">{labels.liveEnded}</p>}
        {isWhisper && <p className="hifz-hint">{labels.liveOnlyZipformer}</p>}
        {isWhisper && recState === 'recording' && <p className="hifz-hint">{labels.recording}</p>}
        {!authed && <p className="hifz-hint">{labels.signInHint}</p>}
      </div>
      {/* Floating 3D mic: a separate layer, like the music player. It
          is the only record control; its action follows the engine. */}
      {(isZipformer || isWhisper) && (
        <div className="hifz-mic-layer">
          <button
            type="button"
            className={`hifz-mic-3d${micActive ? ' is-live' : ''}`}
            aria-label={micLabel}
            disabled={!authed || micBusy}
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
      {lastGrade && lastGrade.extra_words.length > 0 && (
        <p className="hifz-extra">
          {labels.extraLabel}: {lastGrade.extra_words.join(' ')}
        </p>
      )}
      {liveExtraCount > 0 && (
        <p className="hifz-extra">
          {labels.extraLabel}: {liveExtraCount}
        </p>
      )}

      <section className="hifz-session">
        <h3>{labels.countsTitle}</h3>
        {attempt ? (
          <>
            <p>
              {labels.sessionActive} — {labels.correctLabel} {attempt.counts.correct} ·{' '}
              {labels.closeLabel} {attempt.counts.close} · {labels.wrongLabel}{' '}
              {attempt.counts.wrong} · {labels.skippedLabel} {attempt.counts.skipped}
            </p>
            {attempt.status !== 'completed' ? (
              <button type="button" onClick={() => void completeSession()}>
                {labels.completeSession}
              </button>
            ) : (
              <p>{labels.sessionCompleted}</p>
            )}
          </>
        ) : (
          <p>{labels.noAttemptHint}</p>
        )}
        {authed && (
          <button type="button" onClick={() => void ensureAttempt()}>
            {labels.startSession}
          </button>
        )}
        {engineStatus && (
          <p className="hifz-engine">
            {labels.engineLabel}: {engineStatus.engine}{' '}
            {!engineStatus.available && `(${labels.engineUnavailable})`}
          </p>
        )}
      </section>

      <p className="hifz-disclaimer">{labels.disclaimer}</p>

      {authed && (
        <section className="hifz-panels">
          <h3>{labels.statsTitle}</h3>
          {stats ? (
            <p>
              {labels.attemptsLabel} {stats.attempts} · {labels.gradedWordsLabel}{' '}
              {stats.graded_words} · {labels.dominantMistakeLabel}{' '}
              {dominantMistakeText} · {labels.dueLabel} {stats.due_ayahs}
            </p>
          ) : (
            <p>—</p>
          )}
          <h3>{labels.reviewTitle}</h3>
          {review.length === 0 ? (
            <p>{labels.reviewEmpty}</p>
          ) : (
            <ul>
              {review.map((r) => (
                <li key={`${r.surah}:${r.ayah}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSurah(r.surah);
                      setAyah(r.ayah);
                    }}
                  >
                    {r.surah}:{r.ayah} ({r.mistake_count})
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3>{labels.historyTitle}</h3>
          {history.length === 0 ? (
            <p>{labels.historyEmpty}</p>
          ) : (
            <ul>
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSurah(h.surah);
                      void refreshDetail(h.id);
                    }}
                  >
                    {h.surah} · {h.status} · {h.counts.correct}/{h.counts.wrong}/
                    {h.counts.skipped}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
