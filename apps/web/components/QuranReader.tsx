'use client';

/**
 * QuranReader — client shell for the Quran reader (umum section).
 *
 * User-locked 2026-11-01: NO section tabs. The reader renders ONLY the
 * section selected via ?tab= (default umum); hifz / children render
 * their existing honest placeholders and nothing else. Back navigation
 * is via the site Quran menu — no back link is invented here.
 *
 * Umum view modes (switcher order, user-locked): سوره، آیه، جزء، حزب،
 * صفحه. Initial mode is سوره. Modes are deep-linkable (?view= + ?target=,
 * mirrored into the URL on change so refresh keeps the view).
 *
 * Juz / hizb / page views SPAN SURAH BOUNDARIES: the reader assembles
 * every spanned surah (entry surah from RSC props, the rest fetched
 * client-side) and filters by the range span from
 * lib/quran-boundaries.json (provider-derived, never hand-typed).
 * The page view renders EXACT Madani print lines from
 * lib/quran-mushaf-lines.json (QPC1 breaks, verified line-by-line
 * against the user's Bayan page-106 screenshot), falling back to
 * flowing text if the line data fails to load.
 *
 * All data arrives as props from the RSC page except range surahs
 * (client-fetched); all user-visible strings arrive via `labels`.
 * Playback state lives in useQuranPlayback; the player bar carries the
 * waveform INSIDE the progress bar (no separate waveform row).
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuranPlayback, type PlaybackStatus } from '@/lib/hooks/useQuranPlayback';
import type { Ayah, Reciter, SurahDetail, SurahSummary } from '@/lib/quran';
import { fawasilFor, type FawasilSchool } from '@/lib/quran-fawasil';
import {
  isSajda,
  parseMadhhabId,
  sajdaRuling,
  stripBismillahFromFirst,
  toDisplayAyahs,
  wordIndexForCard,
  type MadhhabId,
} from '@/lib/quran-madhhab';
import { reciterDisplayName } from '@/lib/quran-reciters';
import {
  filterRangeAyahs,
  inRangeSpan,
  juzPages,
  rangeContaining,
  rangeSpan,
  RANGE_COUNTS,
  VIEW_MODE_ORDER,
  type QuranBoundaries,
  type QuranViewMode,
  type RangeKind,
  type RangeSpan,
} from '@/lib/quran-view-modes';
import { loadBoundaries } from '@/lib/quran-boundaries-loader';
import { loadMushafLines, type MushafExactLine } from '@/lib/quran-mushaf-lines';
import { fetchSurahClient } from '@/lib/quran-range-client';
import { toLatinDigits } from '@/lib/quran-search';
import type { QuranSettings } from '@/lib/settings';
import { AyahCard, type AyahCardLabels } from './AyahCard';
import { AyahNotes, type AyahNotesLabels } from './AyahNotes';
import { QuranWaveform } from './QuranWaveform';
import { QuranMushafPage, type MushafSurahGroup } from './QuranMushafPage';
import { QuranSearchBox, type QuranSearchLabels } from './QuranSearchBox';

export interface QuranReaderLabels extends AyahCardLabels, AyahNotesLabels {
  surahOf: string;
  reciterLabel: string;
  playSurah: string;
  pause: string;
  resume: string;
  stop: string;
  prevSurah: string;
  nextSurah: string;
  audioUnavailable: string;
  audioFailed: string;
  ayahLink: string;
  showTranslation: string;
  showTafsir: string;
  bismillah: string;
  hifzPlaceholder: string;
  childrenPlaceholder: string;
  madhhabLabel: string;
  madhhabHanafi: string;
  madhhabShafii: string;
  madhhabMaliki: string;
  madhhabHanbali: string;
  sajdaWajib: string;
  sajdaSunnah: string;
  /** Template with %school% and %count% tokens (plain replace, not ICU). */
  fawasilCount: string;
  /** Template with %school%; shown only when the mapped school has no data. */
  fawasilFallback: string;
  schoolKufi: string;
  schoolBasri: string;
  schoolMadani1: string;
  schoolMadani2: string;
  schoolMakki: string;
  schoolShami: string;
  schoolHimsi: string;
  prevAyah: string;
  nextAyah: string;
  speedLabel: string;
  volumeLabel: string;
  /** View-mode switcher (order: surah, ayah, juz, hizb, page — user-locked). */
  modeLabel: string;
  modeSurah: string;
  modeAyah: string;
  modeJuz: string;
  modeHizb: string;
  modePage: string;
  prevPage: string;
  nextPage: string;
  prevJuz: string;
  nextJuz: string;
  prevHizb: string;
  nextHizb: string;
  /** Templates with %n% (page / juz / hizb number). */
  pageCurrent: string;
  juzCurrent: string;
  hizbCurrent: string;
  /** Template with %s% (surah name) for the mushaf page header. */
  mushafHeaderSurah: string;
  /** Template with %current% and %total%. */
  ayahOf: string;
  /** Template with %current% and %total% (page within the open juz). */
  juzPageOf: string;
  surahTotalLabel: string;
  /** Total label for range views (the range's audio, not one surah). */
  rangeTotalLabel: string;
  waveformLabel: string;
  juzListTitle: string;
  hizbListTitle: string;
  pageListTitle: string;
  backToList: string;
  pageJumpLabel: string;
  pageJumpButton: string;
  /** Template with %max% (604). */
  pageJumpOutOfRange: string;
  rangeLoading: string;
  rangeFailed: string;
  /** Script/typeface switch (typeface only — see the note label). */
  scriptLabel: string;
  scriptUthmani: string;
  scriptIndopak: string;
  /** Plain note: the switch changes the typeface, not the text. */
  scriptTypefaceNote: string;
}

type QuranSection = 'general' | 'hifz' | 'children';
type ScriptId = 'uthmani' | 'indopak';

/** "m:ss" or "h:mm:ss" — never NaN, never negative. */
function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const STATUS_KEY: Record<PlaybackStatus, 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'> = {
  idle: 'idle',
  loading: 'loading',
  playing: 'playing',
  paused: 'paused',
  ended: 'ended',
  error: 'error',
};

interface RangeSurahData {
  surah: SurahDetail;
  ayahs: Ayah[];
}

/**
 * Display groups for a span (page / juz / ayah-page): per-surah
 * madhhab mapping, Bismillah header only when the surah actually
 * STARTS inside the span, and the embedded Bismillah prefix stripped
 * exactly when the header shows — the same single-condition rule as
 * the surah view. Shared by the range groups, the juz page groups,
 * and the ayah page groups so all three stay consistent.
 */
function buildMushafGroups(
  forSpan: RangeSpan,
  surahs: RangeSurahData[],
  madhhab: MadhhabId,
): MushafSurahGroup[] {
  const groups: MushafSurahGroup[] = [];
  for (const { surah: s, ayahs: sa } of surahs) {
    const disp = toDisplayAyahs(s.number, sa, madhhab);
    const startsHere = inRangeSpan(s.number, 1, forSpan);
    const header =
      startsHere && s.number !== 9 && (s.number !== 1 || disp.bismillahAsHeader);
    const stripped = stripBismillahFromFirst(disp.ayahs, header);
    const items = stripped.filter((d) => inRangeSpan(s.number, d.standardNumber, forSpan));
    if (items.length === 0) continue;
    groups.push({
      surahNumber: s.number,
      surahNameAr: s.nameAr,
      surahStartsHere: startsHere,
      bismillahHeader: header,
      items,
    });
  }
  return groups;
}

/** One flattened play entry: the ayah plus the surah it belongs to. */
type PlayAyah = Ayah & { surahNumber: number };

function parseViewParam(v: string | null): QuranViewMode {
  return v === 'ayah' || v === 'juz' || v === 'hizb' || v === 'page' ? v : 'surah';
}

export function QuranReader({
  locale,
  surah,
  ayahs,
  reciters,
  settings,
  initialAyah,
  initialTab,
  initialView,
  initialTarget,
  surahList,
  labels,
  searchLabels,
}: {
  locale: string;
  surah: SurahDetail;
  ayahs: Ayah[];
  reciters: Reciter[];
  settings: QuranSettings;
  /** Deep-link: highlight + scroll to this ayah number (1-based). */
  initialAyah: number | null;
  /** Section from ?tab= — the reader renders ONLY this section. */
  initialTab?: QuranSection;
  /** Deep-link view from ?view= (validated server-side). */
  initialView?: QuranViewMode;
  /** Deep-link range target from ?target= (null = list state). */
  initialTarget?: number | null;
  /** Full surah list for search name matching. */
  surahList: SurahSummary[];
  labels: QuranReaderLabels;
  searchLabels: QuranSearchLabels;
}) {
  const section: QuranSection = initialTab ?? 'general';

  // Non-umum sections render ONLY their honest placeholder — no header,
  // no toolbar, no player, no modes, no other section's content.
  if (section !== 'general') {
    return (
      <div className="quran-reader">
        <div className="quran-placeholder" role="note">
          <p>{section === 'hifz' ? labels.hifzPlaceholder : labels.childrenPlaceholder}</p>
        </div>
      </div>
    );
  }

  return (
    <QuranUmumReader
      locale={locale}
      surah={surah}
      ayahs={ayahs}
      reciters={reciters}
      settings={settings}
      initialAyah={initialAyah}
      initialView={initialView}
      initialTarget={initialTarget}
      surahList={surahList}
      labels={labels}
      searchLabels={searchLabels}
    />
  );
}

function QuranUmumReader({
  locale,
  surah,
  ayahs,
  reciters,
  settings,
  initialAyah,
  initialView,
  initialTarget,
  surahList,
  labels,
  searchLabels,
}: {
  locale: string;
  surah: SurahDetail;
  ayahs: Ayah[];
  reciters: Reciter[];
  settings: QuranSettings;
  initialAyah: number | null;
  initialView?: QuranViewMode;
  initialTarget?: number | null;
  surahList: SurahSummary[];
  labels: QuranReaderLabels;
  searchLabels: QuranSearchLabels;
}) {
  const [reciterId, setReciterId] = useState<string>(settings.defaultReciter ?? reciters[0]?.id ?? '');
  const [showTranslation, setShowTranslation] = useState(settings.showTranslation);
  const [showTafsir, setShowTafsir] = useState(settings.showTafsir);
  const [madhhab, setMadhhab] = useState<MadhhabId>(() => parseMadhhabId(settings.madhhabDefault));
  const [script, setScript] = useState<ScriptId>('uthmani');
  const scriptClass = script === 'indopak' ? 'quran-script-indopak' : 'quran-script-uthmani';

  // View mode + range target. Initial mode is سوره. Range modes with a
  // null target show their LIST; a target shows that range's ayahs.
  const [viewMode, setViewMode] = useState<QuranViewMode>(initialView ?? 'surah');
  const [rangeTarget, setRangeTarget] = useState<number | null>(initialTarget ?? null);
  const [focusedDisplayIdx, setFocusedDisplayIdx] = useState(0);
  const isRangeMode = viewMode === 'juz' || viewMode === 'hizb' || viewMode === 'page';
  const rangeKind: RangeKind | null = isRangeMode ? viewMode : null;

  // Mode-specific selections reset when the surah CHANGES (prev/next
  // navigation reuses this component instance). The mount run must NOT
  // reset: it would wipe the deep-linked ?view=/?target= the page was
  // opened with. Madhhab/reciter/script selections survive navigation.
  const prevSurahRef = useRef(surah.number);
  useEffect(() => {
    if (prevSurahRef.current === surah.number) return;
    prevSurahRef.current = surah.number;
    setViewMode('surah');
    setRangeTarget(null);
    setFocusedDisplayIdx(0);
  }, [surah.number]);

  // Mirror view/target into the URL (replaceState, no refetch) so a
  // refresh keeps the view. Other params (tab/ayah/reciter/...) pass
  // through untouched.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (viewMode === 'surah') {
      url.searchParams.delete('view');
      url.searchParams.delete('target');
    } else if (viewMode === 'ayah') {
      url.searchParams.set('view', 'ayah');
      url.searchParams.delete('target');
    } else {
      url.searchParams.set('view', viewMode);
      if (rangeTarget !== null) url.searchParams.set('target', String(rangeTarget));
      else url.searchParams.delete('target');
    }
    const next = url.toString();
    if (next !== window.location.href) window.history.replaceState(null, '', next);
  }, [viewMode, rangeTarget]);

  // Back/forward buttons restore the view from the URL.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      setViewMode(parseViewParam(params.get('view')));
      const t = params.get('target');
      setRangeTarget(t && /^\d+$/.test(t) ? Number(t) : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Display mapping (madhhab) for the ENTRY surah. Playback keeps
  // working on the STANDARD ayahs array — the hook never sees display
  // numbers.
  const display = useMemo(
    () => toDisplayAyahs(surah.number, ayahs, madhhab),
    [surah.number, ayahs, madhhab],
  );
  // Bismillah header condition — the SAME condition gates the header
  // render below and the embedded-prefix strip: the two can never
  // disagree, so Bismillah is never shown twice or zero times.
  const showBismillahHeader =
    surah.bismillahPre && surah.number !== 9 && (surah.number !== 1 || display.bismillahAsHeader);
  const visible = useMemo(
    () => stripBismillahFromFirst(display.ayahs, showBismillahHeader),
    [display, showBismillahHeader],
  );
  const fawasil = useMemo(() => fawasilFor(surah.number, madhhab), [surah.number, madhhab]);
  const sajdaTitle = sajdaRuling(madhhab) === 'wajib' ? labels.sajdaWajib : labels.sajdaSunnah;

  const SCHOOL_NAMES: Record<FawasilSchool, string> = {
    kufi: labels.schoolKufi,
    basri: labels.schoolBasri,
    madani1: labels.schoolMadani1,
    madani2: labels.schoolMadani2,
    makki: labels.schoolMakki,
    shami: labels.schoolShami,
    himsi: labels.schoolHimsi,
  };
  const fawasilLine = labels.fawasilCount
    .replace('%school%', SCHOOL_NAMES[fawasil.school])
    .replace('%count%', fawasil.count !== null ? String(fawasil.count) : '–');
  const fawasilFallbackLine = fawasil.fallback
    ? labels.fawasilFallback.replace('%school%', SCHOOL_NAMES[fawasil.mappedSchool])
    : null;

  const MADHHAB_OPTIONS: { id: MadhhabId; label: string }[] = [
    { id: 'hanafi', label: labels.madhhabHanafi },
    { id: 'shafii', label: labels.madhhabShafii },
    { id: 'maliki', label: labels.madhhabMaliki },
    { id: 'hanbali', label: labels.madhhabHanbali },
  ];

  const currentReciter = reciters.find((r) => r.id === reciterId) ?? null;
  // Trilingual display name; unknown ids fall back to the raw id.
  const currentReciterName = currentReciter
    ? (reciterDisplayName(currentReciter.id, locale) ?? currentReciter.name)
    : null;
  const reciterOptionName = (r: Reciter): string =>
    reciterDisplayName(r.id, locale) ?? r.name;

  // ---- Range data (juz / hizb / page) + ayah-mode page data ----
  // Boundaries load for range modes AND for ayah mode (ayah mode
  // renders the mushaf page containing the focused ayah).
  const [boundaries, setBoundaries] = useState<QuranBoundaries | null>(null);
  useEffect(() => {
    if (!isRangeMode && viewMode !== 'ayah') return;
    let cancelled = false;
    loadBoundaries()
      .then((b) => {
        if (!cancelled) setBoundaries(b);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isRangeMode, viewMode]);

  const span: RangeSpan | null = useMemo(() => {
    if (!isRangeMode || rangeKind === null || rangeTarget === null || !boundaries) return null;
    return rangeSpan(boundaries, rangeKind, rangeTarget);
  }, [isRangeMode, rangeKind, rangeTarget, boundaries]);

  const [rangeSurahs, setRangeSurahs] = useState<RangeSurahData[] | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState(false);
  useEffect(() => {
    if (!span) {
      setRangeSurahs(null);
      setRangeError(false);
      setRangeLoading(false);
      return;
    }
    let cancelled = false;
    setRangeLoading(true);
    setRangeError(false);
    const jobs = span.surahs.map(async (n): Promise<RangeSurahData> => {
      // Reuse the RSC entry surah instead of refetching it.
      if (n === surah.number) return { surah, ayahs };
      const view = await fetchSurahClient(n, {
        translation: settings.defaultTranslation,
        tafsir: settings.defaultTafsir,
      });
      return { surah: view.surah, ayahs: view.ayahs };
    });
    Promise.all(jobs)
      .then((rows) => {
        if (cancelled) return;
        setRangeSurahs(rows);
        setRangeLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRangeError(true);
        setRangeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [span, surah, ayahs, settings.defaultTranslation, settings.defaultTafsir]);

  // Display groups for the range (whole span, used by the hizb card
  // list and as the base for the page views).
  const rangeGroups: MushafSurahGroup[] | null = useMemo(() => {
    if (!span || !rangeSurahs) return null;
    return buildMushafGroups(span, rangeSurahs, madhhab);
  }, [span, rangeSurahs, madhhab]);



  // Flattened play array for the active reading set. Range views play
  // the range's standard ayahs (per-ayah files only); surah/ayah modes
  // play the entry surah exactly as before.
  const playAyahs: PlayAyah[] = useMemo(() => {
    if (isRangeMode) {
      if (!span || !rangeSurahs) return [];
      const out: PlayAyah[] = [];
      for (const { surah: s, ayahs: sa } of rangeSurahs) {
        for (const a of filterRangeAyahs(s.number, sa, span)) {
          out.push({ ...a, surahNumber: s.number });
        }
      }
      return out;
    }
    return ayahs.map((a) => ({ ...a, surahNumber: surah.number }));
  }, [isRangeMode, span, rangeSurahs, ayahs, surah.number]);

  const playMap = useMemo(() => {
    const m = new Map<string, number>();
    playAyahs.forEach((a, i) => m.set(`${a.surahNumber}:${a.number}`, i));
    return m;
  }, [playAyahs]);

  const playSetId = isRangeMode
    ? `range-${rangeKind}-${rangeTarget ?? 'list'}`
    : `surah-${surah.number}`;

  const {
    state,
    canPlay,
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
    getAudioContext,
    ctxState,
  } = useQuranPlayback(playAyahs, {
    surahAudioUrl: isRangeMode ? null : surah.audioUrl,
    initialRate: settings.playerDefaultSpeed,
  });

  // A new reading set stops the old playback (the hook's element is
  // shared, so an explicit stop keeps indices from pointing at the
  // previous set's ayahs).
  useEffect(() => {
    stop();
  }, [playSetId, stop]);

  const [highlightAyah, setHighlightAyah] = useState<number | null>(initialAyah);

  useEffect(() => {
    if (!initialAyah || isRangeMode) return;
    // Deep-link numbers are STANDARD; scroll to the first display card
    // with that standard number (the first pair card for Fatiha 7).
    const target = visible.find((d) => d.standardNumber === initialAyah);
    if (!target) return;
    document
      .getElementById(`ayah-${target.displayNumber}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [initialAyah, visible, isRangeMode]);

  // Focused ayah follows the deep-link on mount / surah change.
  useEffect(() => {
    if (!initialAyah || isRangeMode) return;
    const idx = visible.findIndex((d) => d.standardNumber === initialAyah);
    if (idx >= 0) setFocusedDisplayIdx(idx);
  }, [initialAyah, visible, isRangeMode]);

  const statusKey = STATUS_KEY[state.status];
  const playing = statusKey === 'playing' || statusKey === 'loading';

  // Auto-follow playback in surah/ayah modes: keep the playing card in
  // view. 'nearest' scrolls only when the card is out of view, so
  // reading ahead while paused is never yanked back.
  useEffect(() => {
    if (isRangeMode || state.ayahIndex < 0 || !playing) return;
    const ayah = ayahs[state.ayahIndex];
    if (!ayah) return;
    const target = visible.find((d) => d.standardIndex === state.ayahIndex);
    document
      .getElementById(`ayah-${target ? target.displayNumber : ayah.number}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.ayahIndex, playing, ayahs, visible, isRangeMode]);

  // Auto-follow playback in range modes: scroll to the playing ayah's
  // card wrapper / mushaf segment.
  useEffect(() => {
    if (!isRangeMode || state.ayahIndex < 0 || !playing) return;
    const item = playAyahs[state.ayahIndex];
    if (!item) return;
    document
      .getElementById(`range-${item.surahNumber}-${item.number}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.ayahIndex, playing, isRangeMode, playAyahs]);

  // Step through DISPLAY cards (surah/ayah modes; Fatiha pair = two
  // steps, one audio file: stepping 6→7 or 7→6 replays standard 1:7 —
  // the documented Phase 1 simplification).
  const currentDisplayIndex = visible.findIndex((d) => d.standardIndex === state.ayahIndex);
  const stepAyah = (dir: 1 | -1): void => {
    if (currentDisplayIndex < 0) {
      if (dir === 1) playIndex(0);
      return;
    }
    const next = visible[currentDisplayIndex + dir];
    if (next) playIndex(next.standardIndex);
  };

  // Step through the play array (range modes).
  const stepRange = (dir: 1 | -1): void => {
    if (playAyahs.length === 0) return;
    const idx = state.ayahIndex < 0 ? (dir === 1 ? 0 : playAyahs.length - 1) : state.ayahIndex + dir;
    if (idx >= 0 && idx < playAyahs.length) playIndex(idx);
  };

  const playCurrent = (dir: 1 | -1): void => {
    if (isRangeMode) stepRange(dir);
    else stepAyah(dir);
  };

  const progressPct = useMemo(() => {
    if (!state.duration || state.duration <= 0) return 0;
    return Math.min(100, (state.currentTime / state.duration) * 100);
  }, [state.currentTime, state.duration]);

  const playingPlayItem = state.ayahIndex >= 0 ? playAyahs[state.ayahIndex] : undefined;
  const playingKey = playingPlayItem
    ? `${playingPlayItem.surahNumber}:${playingPlayItem.number}`
    : null;

  const clampedFocused =
    visible.length === 0 ? 0 : Math.min(Math.max(0, focusedDisplayIdx), visible.length - 1);

  // While playing, the ayah view tracks the playing ayah. Paused
  // navigation is never yanked (playing is false then).
  useEffect(() => {
    if (isRangeMode || !playing || state.ayahIndex < 0) return;
    const idx = visible.findIndex((d) => d.standardIndex === state.ayahIndex);
    if (idx >= 0) setFocusedDisplayIdx(idx);
  }, [state.ayahIndex, playing, visible, isRangeMode]);

  const modeAyahs =
    viewMode === 'ayah' ? (visible.length > 0 ? [visible[clampedFocused]] : []) : visible;

  // ---- Mushaf-page display (page / juz / ayah modes) ----
  // Bayan-style reading: each of these modes DISPLAYS a mushaf page
  // (exact lines + frame + header/footer), never a card list.
  //   page mode: the selected page (rangeTarget).
  //   juz mode: the page inside the open juz (juzPage state, moved
  //     with page navigation inside the juz's pages).
  //   ayah mode: the page containing the focused ayah (derived, so
  //     prev/next switches pages when the ayah sits on another page).
  const juzPagesList = useMemo(
    () =>
      viewMode === 'juz' && rangeTarget !== null && boundaries
        ? juzPages(boundaries, rangeTarget)
        : [],
    [viewMode, rangeTarget, boundaries],
  );
  const [juzPage, setJuzPage] = useState<number | null>(null);
  useEffect(() => {
    if (viewMode !== 'juz' || juzPagesList.length === 0) return;
    if (juzPage === null || !juzPagesList.includes(juzPage)) setJuzPage(juzPagesList[0]);
  }, [viewMode, juzPagesList, juzPage]);
  const ayahPage = useMemo(() => {
    if (viewMode !== 'ayah' || !boundaries || visible.length === 0) return null;
    const d = visible[clampedFocused];
    if (!d) return null;
    return rangeContaining(boundaries, surah.number, d.standardNumber).page;
  }, [viewMode, boundaries, visible, clampedFocused, surah.number]);
  const focusedAyah = visible.length > 0 ? visible[clampedFocused] : null;
  const displayPage =
    viewMode === 'page' ? rangeTarget : viewMode === 'juz' ? juzPage : viewMode === 'ayah' ? ayahPage : null;
  const displayPageSpan = useMemo(
    () => (displayPage !== null && boundaries ? rangeSpan(boundaries, 'page', displayPage) : null),
    [displayPage, boundaries],
  );

  // Surahs for the ayah mode's display page (the page may span two
  // surahs; the entry surah is reused, the other is fetched — the
  // same pattern as the range fetch).
  const [ayahPageSurahs, setAyahPageSurahs] = useState<RangeSurahData[] | null>(null);
  const [ayahPageLoading, setAyahPageLoading] = useState(false);
  const [ayahPageError, setAyahPageError] = useState(false);
  useEffect(() => {
    if (viewMode !== 'ayah' || !displayPageSpan) {
      setAyahPageSurahs(null);
      setAyahPageError(false);
      setAyahPageLoading(false);
      return;
    }
    let cancelled = false;
    setAyahPageLoading(true);
    setAyahPageError(false);
    const jobs = displayPageSpan.surahs.map(async (n): Promise<RangeSurahData> => {
      if (n === surah.number) return { surah, ayahs };
      const view = await fetchSurahClient(n, {
        translation: settings.defaultTranslation,
        tafsir: settings.defaultTafsir,
      });
      return { surah: view.surah, ayahs: view.ayahs };
    });
    Promise.all(jobs)
      .then((rows) => {
        if (cancelled) return;
        setAyahPageSurahs(rows);
        setAyahPageLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAyahPageError(true);
        setAyahPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, displayPageSpan, surah, ayahs, settings.defaultTranslation, settings.defaultTafsir]);

  // Flowing-fallback groups for the display page (page mode reuses
  // the range groups: its span IS the page span).
  const displayPageGroups: MushafSurahGroup[] | null = useMemo(() => {
    if (displayPage === null || !displayPageSpan) return null;
    if (viewMode === 'juz' && rangeSurahs) return buildMushafGroups(displayPageSpan, rangeSurahs, madhhab);
    if (viewMode === 'ayah' && ayahPageSurahs)
      return buildMushafGroups(displayPageSpan, ayahPageSurahs, madhhab);
    if (viewMode === 'page' && rangeSurahs) return buildMushafGroups(displayPageSpan, rangeSurahs, madhhab);
    return null;
  }, [displayPage, displayPageSpan, viewMode, rangeSurahs, ayahPageSurahs, madhhab]);

  // Exact Madani lines for the display page: lazy-loaded once, then
  // the current page's lines. Null while loading or on failure → the
  // flowing fallback renders (never a blank page, never stale lines:
  // the page change clears first).
  const [exactLines, setExactLines] = useState<MushafExactLine[] | null>(null);
  useEffect(() => {
    if (displayPage === null) return;
    setExactLines(null);
    let cancelled = false;
    loadMushafLines().then((pages) => {
      if (cancelled) return;
      setExactLines(
        pages && displayPage >= 1 && displayPage <= pages.length
          ? pages[displayPage - 1]
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [displayPage]);

  // While playing in juz mode, follow the playing ayah's page inside
  // the juz (paused navigation is never yanked).
  useEffect(() => {
    if (viewMode !== 'juz' || !playing || !playingPlayItem || !boundaries || juzPagesList.length === 0)
      return;
    const p = rangeContaining(boundaries, playingPlayItem.surahNumber, playingPlayItem.number).page;
    if (p !== null && juzPagesList.includes(p) && p !== juzPage) setJuzPage(p);
  }, [viewMode, playing, playingPlayItem, boundaries, juzPagesList, juzPage]);

  const MODE_LABELS: Record<QuranViewMode, string> = {
    surah: labels.modeSurah,
    ayah: labels.modeAyah,
    juz: labels.modeJuz,
    hizb: labels.modeHizb,
    page: labels.modePage,
  };

  const selectMode = (mode: QuranViewMode): void => {
    // Clicking the active range mode returns to its list.
    if (mode === viewMode && (mode === 'juz' || mode === 'hizb' || mode === 'page')) {
      setRangeTarget(null);
      return;
    }
    setViewMode(mode);
    setRangeTarget(null);
  };

  const ayahLink = (surahNum: number, n: number): string =>
    `/${locale}/quran/${surahNum}?ayah=${n}${reciterId ? `&reciter=${encodeURIComponent(reciterId)}` : ''}`;

  const surahNameAr = (n: number): string => {
    const s = surahList.find((x) => x.number === n);
    return s ? s.nameAr : String(n);
  };

  // Range list rows (boundaries loaded lazily on first range view).
  const listEntries = boundaries && rangeKind ? boundaries[rangeKind] : null;
  const listTitle =
    rangeKind === 'juz'
      ? labels.juzListTitle
      : rangeKind === 'hizb'
        ? labels.hizbListTitle
        : labels.pageListTitle;
  const rangeNavLabel =
    rangeKind === 'juz'
      ? labels.juzCurrent
      : rangeKind === 'hizb'
        ? labels.hizbCurrent
        : labels.pageCurrent;
  const rangePrevLabel =
    rangeKind === 'juz' ? labels.prevJuz : rangeKind === 'hizb' ? labels.prevHizb : labels.prevPage;
  const rangeNextLabel =
    rangeKind === 'juz' ? labels.nextJuz : rangeKind === 'hizb' ? labels.nextHizb : labels.nextPage;
  const rangeCount = rangeKind ? RANGE_COUNTS[rangeKind] : 0;

  // Page jump input (page list only): digits only, 1..604.
  const [pageJump, setPageJump] = useState('');
  const [pageJumpError, setPageJumpError] = useState(false);
  const submitPageJump = (): void => {
    const digits = toLatinDigits(pageJump.trim());
    if (!/^[0-9]+$/.test(digits)) {
      setPageJumpError(true);
      return;
    }
    const p = Number(digits);
    if (p < 1 || p > 604) {
      setPageJumpError(true);
      return;
    }
    setPageJumpError(false);
    setRangeTarget(p);
  };

  // Player title + total label: range views show the range, not the
  // entry surah.
  const rangeTitle =
    rangeKind && rangeTarget !== null ? rangeNavLabel.replace('%n%', String(rangeTarget)) : null;
  const playerTitle = rangeTitle ?? surah.nameAr;
  const totalLabel = isRangeMode ? labels.rangeTotalLabel : labels.surahTotalLabel;
  const showPlayer = !isRangeMode || (rangeTarget !== null && rangeGroups !== null && !rangeLoading);

  const onSeekBarClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!state.duration || state.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const frac = rtl
      ? (rect.right - e.clientX) / rect.width
      : (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, frac)) * state.duration);
  };

  // Page meta (juz/hizb/surah of the page's LAST ayah). Bayan's own
  // page-106 header proves the header follows the page's final content
  // (جزء ۶ · حزب ۲۲ · مائده), not its first ayah (which would give
  // حزب ۲۱ · نساء): the last ayah of page 106 is Ma'idah, in hizb 22.
  const pageLastRef =
    displayPageGroups && displayPageGroups.length > 0
      ? (() => {
          const g = displayPageGroups[displayPageGroups.length - 1];
          const d = g.items[g.items.length - 1];
          return d ? { surah: g.surahNumber, ayah: d.standardNumber } : null;
        })()
      : null;
  const pageMeta =
    displayPage !== null && displayPageSpan && boundaries
      ? rangeContaining(
          boundaries,
          (pageLastRef ?? displayPageSpan.start).surah,
          (pageLastRef ?? displayPageSpan.start).ayah,
        )
      : { juz: null, hizb: null, page: null };



  return (
    <div className={`quran-reader ${scriptClass}`}>
      <header className="quran-surah-head">
        <div>
          {isRangeMode ? (
            <>
              <h1 className="quran-surah-title">
                {rangeTarget !== null ? rangeTitle : listTitle}
              </h1>
              {rangeGroups && rangeGroups.length > 0 ? (
                <p className="quran-surah-sub" lang="ar" dir="rtl">
                  {rangeGroups.map((g) => g.surahNameAr).join(' ، ')}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="quran-surah-kicker">
                {labels.surahOf} {surah.number} · {surah.ayahCount} · {surah.revelationType}
              </p>
              <h1 className="quran-surah-title" lang="ar" dir="rtl">
                {surah.nameAr}
              </h1>
              <p className="quran-surah-sub">
                {surah.name}
                {surah.englishName !== surah.name ? ` · ${surah.englishName}` : ''}
              </p>
              <p className="quran-fawasil-note">
                {fawasilLine}
                {fawasilFallbackLine ? ` · ${fawasilFallbackLine}` : ''}
              </p>
            </>
          )}
        </div>
        {!isRangeMode ? (
          <nav className="quran-surah-nav" aria-label={`${surah.nameAr}`}>
            {surah.number > 1 ? (
              <Link href={`/${locale}/quran/${surah.number - 1}`} className="quran-nav-btn">
                {labels.prevSurah}
              </Link>
            ) : null}
            {surah.number < 114 ? (
              <Link href={`/${locale}/quran/${surah.number + 1}`} className="quran-nav-btn">
                {labels.nextSurah}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </header>

      <div className="quran-toolbar" role="toolbar" aria-label={surah.name}>
        {reciters.length > 0 ? (
          <label className="quran-reciter">
            <span>{labels.reciterLabel}</span>
            <select
              value={reciterId}
              onChange={(e) => {
                const id = e.target.value;
                setReciterId(id);
                // Refetch the surah with the new reciter's audio.
                const url = new URL(window.location.href);
                if (id) url.searchParams.set('reciter', id);
                else url.searchParams.delete('reciter');
                window.location.href = url.toString();
              }}
            >
              {reciters.map((r) => (
                <option key={r.id} value={r.id}>
                  {reciterOptionName(r)}
                  {r.rewaya ? ` — ${r.rewaya}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="quran-madhhab">
          <span>{labels.madhhabLabel}</span>
          <select value={madhhab} onChange={(e) => setMadhhab(e.target.value as MadhhabId)}>
            {MADHHAB_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="quran-toggle">
          <input
            type="checkbox"
            checked={showTranslation}
            onChange={(e) => setShowTranslation(e.target.checked)}
          />
          {labels.showTranslation}
        </label>
        <label className="quran-toggle">
          <input
            type="checkbox"
            checked={showTafsir}
            onChange={(e) => setShowTafsir(e.target.checked)}
          />
          {labels.showTafsir}
        </label>

        <label className="quran-script">
          <span>{labels.scriptLabel}</span>
          <select value={script} onChange={(e) => setScript(e.target.value as ScriptId)}>
            <option value="uthmani">{labels.scriptUthmani}</option>
            <option value="indopak">{labels.scriptIndopak}</option>
          </select>
          <span className="quran-script-note">{labels.scriptTypefaceNote}</span>
        </label>
      </div>

      <QuranSearchBox locale={locale} surahs={surahList} labels={searchLabels} />

      {/* Audio player bar — the waveform lives INSIDE the progress bar
          (no separate waveform row). Hidden for range LISTS (navigation,
          not reading); shown for every reading view. */}
      {showPlayer ? (
        <div
          className="quran-player"
          role="region"
          aria-label={labels.playSurah}
          data-status={statusKey}
        >
          {!canPlay ? (
            <p className="quran-player-note">{labels.audioUnavailable}</p>
          ) : (
            <>
              <div className="quran-player-meta">
                {settings.playerShowPhoto ? (
                  currentReciter?.photoUrl ? (
                    <img
                      className="quran-reciter-photo"
                      src={currentReciter.photoUrl}
                      alt={currentReciterName ?? currentReciter.name}
                    />
                  ) : (
                    <span className="quran-reciter-photo quran-reciter-photo-empty" aria-hidden="true">
                      ♪
                    </span>
                  )
                ) : null}
                {currentReciterName ? (
                  <span className="quran-player-reciter">{currentReciterName}</span>
                ) : null}
                <span className="quran-player-surah" lang="ar" dir="rtl">
                  {playerTitle}
                </span>
              </div>
              <div className="quran-player-controls">
                <button
                  type="button"
                  className="quran-step-btn"
                  onClick={() => playCurrent(-1)}
                  aria-label={labels.prevAyah}
                  disabled={!canPlay}
                >
                  ⏮
                </button>
                {statusKey === 'playing' || statusKey === 'loading' ? (
                  <button type="button" className="quran-play-btn" onClick={pause} aria-label={labels.pause}>
                    ❚❚
                  </button>
                ) : statusKey === 'paused' ? (
                  <button type="button" className="quran-play-btn" onClick={resume} aria-label={labels.resume}>
                    ▶
                  </button>
                ) : (
                  <button
                    type="button"
                    className="quran-play-btn"
                    onClick={() => {
                      if (isRangeMode) playIndex(0);
                      else playIndex(highlightAyah ? highlightAyah - 1 : 0);
                    }}
                    aria-label={labels.playSurah}
                  >
                    ▶
                  </button>
                )}
                <button
                  type="button"
                  className="quran-step-btn"
                  onClick={() => playCurrent(1)}
                  aria-label={labels.nextAyah}
                  disabled={!canPlay}
                >
                  ⏭
                </button>
                <button type="button" className="quran-stop-btn" onClick={stop} aria-label={labels.stop}>
                  ■
                </button>
                <div
                  className="quran-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progressPct)}
                  onClick={onSeekBarClick}
                >
                  <QuranWaveform
                    getAudioElement={getAudioElement}
                    getAudioContext={getAudioContext}
                    ctxState={ctxState}
                    playing={playing}
                    progressPct={progressPct}
                    label={labels.waveformLabel}
                    style={settings.waveformStyle}
                  />
                </div>
              </div>
              <div className="quran-player-times" dir="ltr">
                <span>
                  {formatTime(state.currentTime)} / {state.duration > 0 ? formatTime(state.duration) : '–'}
                </span>
                {surahDuration !== null ? (
                  <span>
                    {totalLabel}: {formatTime(surahDuration)}
                  </span>
                ) : null}
              </div>
              <div className="quran-player-settings">
                <label className="quran-speed">
                  <span>{labels.speedLabel}</span>
                  <select
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    aria-label={labels.speedLabel}
                  >
                    {PLAYBACK_SPEEDS.map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                </label>
                <label className="quran-volume">
                  <span>{labels.volumeLabel}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label={labels.volumeLabel}
                  />
                </label>
              </div>
              {state.status === 'error' ? (
                <p className="quran-player-note" role="alert">
                  {state.error === 'audio_missing' ? labels.audioUnavailable : labels.audioFailed}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {!isRangeMode && showBismillahHeader ? (
        <p className="quran-bismillah" lang="ar" dir="rtl">
          {labels.bismillah}
        </p>
      ) : null}

      <div className="quran-view-modes" role="group" aria-label={labels.modeLabel}>
        {VIEW_MODE_ORDER.map((mode) => (
          <button
            key={mode}
            type="button"
            className={viewMode === mode ? 'quran-mode-btn quran-mode-active' : 'quran-mode-btn'}
            aria-pressed={viewMode === mode}
            onClick={() => selectMode(mode)}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* ---- Range LISTS (target null) ---- */}
      {isRangeMode && rangeTarget === null ? (
        <>
          <h2 className="quran-range-list-title">{listTitle}</h2>
          {rangeKind === 'page' ? (
            <form
              className="quran-page-jump"
              onSubmit={(e) => {
                e.preventDefault();
                submitPageJump();
              }}
            >
              <label>
                <span>{labels.pageJumpLabel}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageJump}
                  onChange={(e) => {
                    setPageJump(e.target.value);
                    setPageJumpError(false);
                  }}
                  aria-label={labels.pageJumpLabel}
                />
              </label>
              <button type="submit">{labels.pageJumpButton}</button>
              {pageJumpError ? (
                <p className="quran-page-jump-error" role="alert">
                  {labels.pageJumpOutOfRange.replace('%max%', '604')}
                </p>
              ) : null}
            </form>
          ) : null}
          {!listEntries ? (
            <p className="quran-mode-note">{labels.rangeLoading}</p>
          ) : (
            <ol className="quran-range-list">
              {listEntries.map((entry) => (
                <li key={entry.n}>
                  <button
                    type="button"
                    className="quran-range-row"
                    onClick={() => setRangeTarget(entry.n)}
                  >
                    <span className="quran-range-row-num">
                      {rangeNavLabel.replace('%n%', String(entry.n))}
                    </span>
                    <span className="quran-range-row-ref" lang="ar" dir="rtl">
                      {surahNameAr(entry.surah)} · {entry.ayah}
                    </span>
                    <span className="quran-range-row-text" lang="ar" dir="rtl">
                      {entry.text}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}

      {/* ---- Range READING (target set) ---- */}
      {isRangeMode && rangeTarget !== null ? (
        <>
          <div className="quran-mode-nav">
            <button type="button" onClick={() => setRangeTarget(null)}>
              {labels.backToList}
            </button>
            <span>
              {rangeTarget !== null ? rangeNavLabel.replace('%n%', String(rangeTarget)) : ''}
            </span>
            <span className="quran-range-nav-steps">
              <button
                type="button"
                onClick={() => setRangeTarget(Math.max(1, rangeTarget - 1))}
                disabled={rangeTarget <= 1}
                aria-label={rangePrevLabel}
              >
                {rangePrevLabel}
              </button>
              <button
                type="button"
                onClick={() => setRangeTarget(Math.min(rangeCount, rangeTarget + 1))}
                disabled={rangeTarget >= rangeCount}
                aria-label={rangeNextLabel}
              >
                {rangeNextLabel}
              </button>
            </span>
          </div>
          {rangeLoading || !rangeGroups || (viewMode === 'juz' && (displayPage === null || !displayPageGroups)) ? (
            <p className="quran-mode-note">{rangeError ? labels.rangeFailed : labels.rangeLoading}</p>
          ) : viewMode === 'page' || viewMode === 'juz' ? (
            <>
              {viewMode === 'juz' && displayPage !== null && juzPagesList.length > 0 ? (
                <div className="quran-mode-nav">
                  <button
                    type="button"
                    onClick={() => {
                      const i = juzPagesList.indexOf(displayPage);
                      if (i > 0) setJuzPage(juzPagesList[i - 1]);
                    }}
                    disabled={juzPagesList.indexOf(displayPage) <= 0}
                    aria-label={labels.prevPage}
                  >
                    {labels.prevPage}
                  </button>
                  <span>
                    {labels.juzPageOf
                      .replace('%current%', String(juzPagesList.indexOf(displayPage) + 1))
                      .replace('%total%', String(juzPagesList.length))}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const i = juzPagesList.indexOf(displayPage);
                      if (i >= 0 && i < juzPagesList.length - 1) setJuzPage(juzPagesList[i + 1]);
                    }}
                    disabled={juzPagesList.indexOf(displayPage) >= juzPagesList.length - 1}
                    aria-label={labels.nextPage}
                  >
                    {labels.nextPage}
                  </button>
                </div>
              ) : null}
              <QuranMushafPage
                groups={displayPageGroups ?? rangeGroups}
                exactLines={exactLines}
                pageNumber={displayPage ?? rangeTarget}
                juz={pageMeta.juz}
                hizb={pageMeta.hizb}
                headerSurah={(displayPageGroups ?? rangeGroups)[
                  (displayPageGroups ?? rangeGroups).length - 1
                ].surahNameAr}
                headerSurahTemplate={labels.mushafHeaderSurah}
                pageCurrent={labels.pageCurrent}
                juzCurrent={labels.juzCurrent}
                hizbCurrent={labels.hizbCurrent}
                bismillah={labels.bismillah}
                scriptClass={scriptClass}
                playingKey={playingKey}
                onPlayAyah={(sn, d) => {
                  const idx = playMap.get(`${sn}:${d.standardNumber}`);
                  if (idx !== undefined) playIndex(idx);
                }}
                onPlayLine={(sn, an) => {
                  const idx = playMap.get(`${sn}:${an}`);
                  if (idx !== undefined) playIndex(idx);
                }}
              />
            </>
          ) : (
            <div className="ayah-list">
              {rangeGroups.map((group) => (
                <div key={group.surahNumber} className="quran-range-surah-block">
                  {group.bismillahHeader ? (
                    <p className="quran-bismillah" lang="ar" dir="rtl">
                      {labels.bismillah}
                    </p>
                  ) : null}
                  {group.items.map((d) => {
                    const key = `${group.surahNumber}:${d.standardNumber}`;
                    const isPlayingCard = playingKey === key;
                    return (
                      <div key={key} id={`range-${group.surahNumber}-${d.standardNumber}`}>
                        <AyahCard
                          ayah={d.ayah}
                          surahNumber={group.surahNumber}
                          highlighted={
                            isPlayingCard ||
                            (initialAyah !== null &&
                              group.surahNumber === surah.number &&
                              d.standardNumber === initialAyah)
                          }
                          wordIndex={
                            isPlayingCard ? wordIndexForCard(d, state.wordIndex) : -1
                          }
                          showTranslation={showTranslation}
                          showTafsir={showTafsir}
                          isCurrent={isPlayingCard && playing}
                          labels={labels}
                          ayahHref={ayahLink(group.surahNumber, d.standardNumber)}
                          sajdaTitle={
                            isSajda(group.surahNumber, d.standardNumber, madhhab)
                              ? sajdaTitle
                              : null
                          }
                          idPrefix={`r${group.surahNumber}-`}
                          notes={
                            <AyahNotes
                              surah={group.surahNumber}
                              ayahNumber={d.standardNumber}
                              locale={locale}
                              labels={labels}
                              onPlayAyah={() => {
                                const idx = playMap.get(key);
                                if (idx !== undefined) playIndex(idx);
                              }}
                              canPlay={Boolean(d.ayah.audioUrl)}
                            />
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ---- Surah / ayah modes ---- */}
      {!isRangeMode ? (
        <>
          {viewMode === 'ayah' && visible.length > 0 ? (
            <div className="quran-mode-nav">
              <button
                type="button"
                onClick={() => setFocusedDisplayIdx(clampedFocused - 1)}
                disabled={clampedFocused <= 0}
                aria-label={labels.prevAyah}
              >
                {labels.prevAyah}
              </button>
              <span>
                {labels.ayahOf
                  .replace('%current%', String(visible[clampedFocused].displayNumber))
                  .replace('%total%', String(visible.length))}
              </span>
              <button
                type="button"
                onClick={() => setFocusedDisplayIdx(clampedFocused + 1)}
                disabled={clampedFocused >= visible.length - 1}
                aria-label={labels.nextAyah}
              >
                {labels.nextAyah}
              </button>
            </div>
          ) : null}

          {viewMode === 'ayah' && focusedAyah ? (
            ayahPageLoading || displayPage === null || !displayPageGroups ? (
              <p className="quran-mode-note">
                {ayahPageError ? labels.rangeFailed : labels.rangeLoading}
              </p>
            ) : (
              <>
                <QuranMushafPage
                  groups={displayPageGroups}
                  exactLines={exactLines}
                  pageNumber={displayPage}
                  juz={pageMeta.juz}
                  hizb={pageMeta.hizb}
                  headerSurah={displayPageGroups[displayPageGroups.length - 1].surahNameAr}
                  headerSurahTemplate={labels.mushafHeaderSurah}
                  pageCurrent={labels.pageCurrent}
                  juzCurrent={labels.juzCurrent}
                  hizbCurrent={labels.hizbCurrent}
                  bismillah={labels.bismillah}
                  scriptClass={scriptClass}
                  playingKey={playingKey}
                  highlightKey={`${surah.number}:${focusedAyah.standardNumber}`}
                  linesClickable={false}
                  onPlayAyah={(sn, d) => {
                    const idx = playMap.get(`${sn}:${d.standardNumber}`);
                    if (idx !== undefined) playIndex(idx);
                  }}
                  onPlayLine={(sn, an) => {
                    const idx = playMap.get(`${sn}:${an}`);
                    if (idx !== undefined) playIndex(idx);
                  }}
                />
                {(() => {
                  const sajda = isSajda(surah.number, focusedAyah.standardNumber, madhhab)
                    ? sajdaTitle
                    : null;
                  const hasTr = showTranslation && focusedAyah.ayah.translation;
                  const hasTf = showTafsir && focusedAyah.ayah.tafsir;
                  if (!sajda && !hasTr && !hasTf) return null;
                  return (
                    <div className="quran-ayah-panel">
                      {sajda ? <p className="quran-ayah-sajda">{sajda}</p> : null}
                      {hasTr ? (
                        <div className="ayah-translation">
                          <span className="ayah-sub-label">{labels.translationLabel}</span>
                          <p>{focusedAyah.ayah.translation}</p>
                        </div>
                      ) : null}
                      {hasTf ? (
                        <details className="ayah-tafsir">
                          <summary>{labels.tafsirLabel}</summary>
                          <p>{focusedAyah.ayah.tafsir}</p>
                        </details>
                      ) : null}
                    </div>
                  );
                })()}
              </>
            )
          ) : (
            <div className="ayah-list">
              {modeAyahs.map((d) => (
                <AyahCard
                  key={d.displayNumber}
                  ayah={d.ayah}
                  surahNumber={surah.number}
                  highlighted={state.ayahIndex === d.standardIndex || highlightAyah === d.standardNumber}
                  wordIndex={
                    state.ayahIndex === d.standardIndex ? wordIndexForCard(d, state.wordIndex) : -1
                  }
                  showTranslation={showTranslation}
                  showTafsir={showTafsir}
                  isCurrent={state.ayahIndex === d.standardIndex && playing}
                  labels={labels}
                  ayahHref={ayahLink(surah.number, d.standardNumber)}
                  sajdaTitle={isSajda(surah.number, d.standardNumber, madhhab) ? sajdaTitle : null}
                  notes={
                    <AyahNotes
                      surah={surah.number}
                      ayahNumber={d.standardNumber}
                      locale={locale}
                      labels={labels}
                      onPlayAyah={() => playIndex(d.standardIndex)}
                      canPlay={Boolean(d.ayah.audioUrl)}
                    />
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
