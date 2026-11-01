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
 *
 * Round 4 (Bayan reader parity, shared by all sections' display):
 * display toolbar (OFL font stack, size, color theme, fullscreen,
 * auto-scroll) with per-device localStorage persistence over CRM
 * defaults; range-list filter/sort; local bookmarks + last-read
 * resume; player repeat (off / ayah / surah); translation/tafsir
 * edition selectors over the verified AlQuran Cloud catalogs.
 * Hifz study features and children-specific features are NOT here —
 * they are the next rounds.
 *
 * Round 5 (exact app-style reading view): a fullscreen reading view
 * (fixed overlay over the site's dark background; the page face stays
 * light like the apps) with an app-style top bar (page · surah ·
 * juz · hizb), the same exact 15-line QPC page, and a minimal bottom
 * bar (play, picker, mushaf, bookmarks, display, always-visible
 * exit); a bottom-sheet picker (surah/juz/hizb/page tabs + search +
 * card grid) navigating via the existing ?view=&target= deep links;
 * a mushaf picker where ONLY Hafs is a real option and every other
 * row is disabled and labeled «به‌زودی»; and TRUE fullscreen (the
 * Fullscreen API, with a fixed-overlay fallback when the API is
 * unavailable or blocked — a page cannot hide browser chrome itself,
 * so the API is the web maximum). The phrase-chunk coloring in the
 * Hefz reference is a hifz-study feature and is NOT built here.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuranPlayback, type PlaybackStatus } from '@/lib/hooks/useQuranPlayback';
import type { Ayah, Reciter, SurahDetail, SurahSummary } from '@/lib/quran';
import {
  ayahBookmarkId,
  bookmarkHref,
  lastReadHref,
  loadBookmarks,
  loadLastRead,
  pageBookmarkId,
  saveBookmarks,
  saveLastRead,
  type Bookmark,
  type LastRead,
} from '@/lib/quran-bookmarks';
import {
  ARABIC_TAFSIRS,
  editionOptions,
  PERSIAN_TRANSLATIONS,
} from '@/lib/quran-editions';
import {
  DEFAULT_DISPLAY_PREFS,
  displayFontClass,
  displayThemeClass,
  loadDisplayPrefs,
  parseDisplayFont,
  parseDisplayFontSize,
  parseDisplayTheme,
  saveDisplayPrefs,
  type DisplayPrefs,
} from '@/lib/quran-display';
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
import {
  DEFAULT_SVG_MUSHAF,
  parseSvgMushafKey,
  type SvgMushafKey,
} from '@/lib/quran-svg-page';
import { editionAyahText } from '@/lib/quran-text-edition';
import { normalizeQuranText, toLatinDigits } from '@/lib/quran-search';
import type { QuranSettings } from '@/lib/settings';
import { AyahCard, type AyahCardLabels } from './AyahCard';
import { AyahNotes, type AyahNotesLabels } from './AyahNotes';
import { QuranWaveform } from './QuranWaveform';
import {
  QuranMushafPage,
  toArabicIndicDigits,
  type MushafSurahGroup,
} from './QuranMushafPage';
import { QuranMushafPicker, type MushafPickerLabels } from './QuranMushafPicker';
import {
  QuranPickerSheet,
  QuranSheetShell,
  type PickerSheetLabels,
} from './QuranPickerSheet';
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
  /* ---- Round 4: display toolbar ---- */
  displayFontLabel: string;
  fontSystem: string;
  fontAmiri: string;
  fontScheherazade: string;
  fontSizeLabel: string;
  displayThemeLabel: string;
  themeDark: string;
  themeSepia: string;
  themeLight: string;
  themeGreen: string;
  fullscreenLabel: string;
  exitFullscreenLabel: string;
  autoScrollLabel: string;
  autoScrollSpeedLabel: string;
  /* ---- Round 4: player repeat ---- */
  repeatLabel: string;
  repeatOff: string;
  repeatAyah: string;
  repeatSurah: string;
  /* ---- Round 4: edition selectors ---- */
  translationEditionLabel: string;
  tafsirEditionLabel: string;
  /* ---- Round 4: bookmarks + history ---- */
  bookmarksLabel: string;
  bookmarksTitle: string;
  bookmarkAyah: string;
  bookmarkPage: string;
  bookmarkRemove: string;
  bookmarksEmpty: string;
  bookmarkFavorite: string;
  bookmarkUnfavorite: string;
  bookmarkRemoveBtn: string;
  resumeReading: string;
  lastReadLabel: string;
  /* ---- Round 4: range-list filter/sort ---- */
  listFilterLabel: string;
  listFilterPlaceholder: string;
  listSortLabel: string;
  listSortAsc: string;
  listSortDesc: string;
  /* ---- Round 5: reading view + picker + mushaf ---- */
  readingLabel: string;
  exitReadingLabel: string;
  pickerLabel: string;
  pickerTitle: string;
  pickerSearchLabel: string;
  pickerSearchPlaceholder: string;
  pickerCloseLabel: string;
  mushafLabel: string;
  mushafTitle: string;
  mushafHafs: string;
  mushafWarsh: string;
  mushafQalun: string;
  mushafHafsMargins: string;
  mushafWarshMargins: string;
  mushafQalunMargins: string;
  mushafMadina: string;
  mushafTajweed: string;
  mushafCurrent: string;
  mushafSoon: string;
  mushafNote: string;
  readingSettingsLabel: string;
  /** Template with %current% and %total% (reading page nav). */
  readingPageOf: string;
  /* ---- Round 6: real printed SVG pages ---- */
  /** Plain note shown only when the SVG page failed (text fallback). */
  svgFallbackNote: string;
  /** Note shown only when a NON-Hafs SVG page failed (no text exists). */
  svgUnavailableNote: string;
  /** Small credit line under a rendered SVG page. */
  svgCredit: string;
  /** Honesty note under a non-Hafs tap panel (edition text, no Hafs add-ons). */
  svgRefPanelNote: string;
  /** Note for the ayah view under a non-Hafs key (page needs the ayah map). */
  svgNonHafsAyahNote: string;
  /** Label for the edition's own ayah text in a non-Hafs tap panel. */
  svgEditionTextLabel: string;
  mushafDouri: string;
  mushafShubah: string;
  /* ---- Round 7: mobile settings sheet + mini player ---- */
  /** Title of the mobile settings bottom sheet. */
  settingsSheetTitle: string;
  /** Close button label for the mobile settings sheet. */
  settingsSheetClose: string;
  /** Group headings inside the mobile settings sheet. */
  settingsGroupAudio: string;
  settingsGroupDisplay: string;
  settingsGroupEditions: string;
  /** Visible playback status (never a silent failure again). */
  playerStatusIdle: string;
  playerStatusLoading: string;
  playerStatusPlaying: string;
  playerStatusPaused: string;
  playerStatusEnded: string;
  playerStatusError: string;
  /** Expand/collapse labels for the mobile full-player sheet. */
  playerExpandLabel: string;
  playerCollapseLabel: string;
}

export type QuranSheetKind = 'picker' | 'mushaf' | 'settings' | 'bookmarks';

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
  initialMushaf,
  surahList,
  labels,
  searchLabels,
  translationEditions,
  tafsirEditions,
  fontSizeDefault,
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
  /** Deep-link mushaf from ?mushaf= (validated server-side). */
  initialMushaf?: SvgMushafKey;
  /** Full surah list for search name matching. */
  surahList: SurahSummary[];
  labels: QuranReaderLabels;
  searchLabels: QuranSearchLabels;
  /** Full CRM-enabled translation list (selector options, CRM order). */
  translationEditions?: string[];
  /** Full CRM-enabled tafsir list (selector options, CRM order). */
  tafsirEditions?: string[];
  /** CRM quran.font_size (providers) — display size default. */
  fontSizeDefault?: number;
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
      initialMushaf={initialMushaf}
      surahList={surahList}
      labels={labels}
      searchLabels={searchLabels}
      translationEditions={translationEditions}
      tafsirEditions={tafsirEditions}
      fontSizeDefault={fontSizeDefault}
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
  initialMushaf,
  surahList,
  labels,
  searchLabels,
  translationEditions,
  tafsirEditions,
  fontSizeDefault,
}: {
  locale: string;
  surah: SurahDetail;
  ayahs: Ayah[];
  reciters: Reciter[];
  settings: QuranSettings;
  initialAyah: number | null;
  initialView?: QuranViewMode;
  initialTarget?: number | null;
  initialMushaf?: SvgMushafKey;
  surahList: SurahSummary[];
  labels: QuranReaderLabels;
  searchLabels: QuranSearchLabels;
  translationEditions?: string[];
  tafsirEditions?: string[];
  fontSizeDefault?: number;
}) {
  const [reciterId, setReciterId] = useState<string>(settings.defaultReciter ?? reciters[0]?.id ?? '');
  const [showTranslation, setShowTranslation] = useState(settings.showTranslation);
  const [showTafsir, setShowTafsir] = useState(settings.showTafsir);
  const [madhhab, setMadhhab] = useState<MadhhabId>(() => parseMadhhabId(settings.madhhabDefault));
  const [script, setScript] = useState<ScriptId>('uthmani');
  const scriptClass = script === 'indopak' ? 'quran-script-indopak' : 'quran-script-uthmani';

  // ---- Round 4: display prefs (CRM defaults, per-device localStorage
  // overrides win when present; the toolbar works standalone either
  // way). The initializer reads storage synchronously so the first
  // paint already uses the reader's own choice (SSR: window absent →
  // CRM defaults, then the mount effect applies storage).
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => {
    const crm: DisplayPrefs = {
      ...DEFAULT_DISPLAY_PREFS,
      font: parseDisplayFont(settings.displayFont),
      fontSize: parseDisplayFontSize(
        fontSizeDefault ?? DEFAULT_DISPLAY_PREFS.fontSize,
        DEFAULT_DISPLAY_PREFS.fontSize,
      ),
      theme: parseDisplayTheme(settings.displayTheme),
      repeat:
        settings.repeatDefault === 'ayah' || settings.repeatDefault === 'surah'
          ? settings.repeatDefault
          : 'off',
    };
    if (typeof window === 'undefined') return crm;
    return { ...crm, ...(loadDisplayPrefs() ?? {}) };
  });
  const updatePrefs = (patch: Partial<DisplayPrefs>): void => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDisplayPrefs(next);
      return next;
    });
  };
  // Fullscreen state (reader root element). Round 5: TRUE fullscreen
  // — the Fullscreen API on the reader element, with a fixed-overlay
  // fallback (quran-fallback-fullscreen) when the API is unavailable
  // or blocked (iframe/permissions). A page cannot hide browser
  // chrome itself, so the API is the web maximum; the fallback still
  // covers the site header/footer and keeps an always-visible exit.
  const readerRef = useRef<HTMLDivElement | null>(null);
  const readingRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fallbackFs, setFallbackFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const requestFs = async (
    el: HTMLElement | null,
    onFallback: () => void,
  ): Promise<void> => {
    if (!el) {
      onFallback();
      return;
    }
    try {
      const p = el.requestFullscreen() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') await p;
    } catch {
      onFallback();
    }
  };
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void requestFs(readerRef.current, () => setFallbackFs(true));
  };
  // Round 5 sheets (one open at a time): the picker, the mushaf
  // picker, and the reading-view display / bookmarks sheets. Rendered
  // inside the reading overlay when it is open, at the reader root
  // otherwise — the same nodes, never both.
  const [sheet, setSheet] = useState<QuranSheetKind | null>(null);
  /* ---- Round 7: mobile sheets ---- */
  /** Mobile-only: the whole settings panel as one bottom sheet. */
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  /** Mobile-only: full player sheet expanded from the mini bar. */
  const [playerExpanded, setPlayerExpanded] = useState(false);
  // Escape closes the mobile sheets (player first, then settings).
  useEffect(() => {
    if (!settingsSheetOpen && !playerExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (playerExpanded) setPlayerExpanded(false);
      else setSettingsSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsSheetOpen, playerExpanded]);

  // ---- Round 4: bookmarks + last-read (localStorage only). ----
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [lastRead, setLastRead] = useState<LastRead | null>(null);
  useEffect(() => {
    setBookmarks(loadBookmarks());
    setLastRead(loadLastRead());
  }, []);
  const bookmarkIds = useMemo(() => new Set(bookmarks.map((b) => b.id)), [bookmarks]);
  const toggleBookmark = (b: Bookmark): void => {
    setBookmarks((prev) => {
      const next = prev.some((x) => x.id === b.id)
        ? prev.filter((x) => x.id !== b.id)
        : [...prev, b];
      saveBookmarks(next);
      return loadBookmarks();
    });
  };
  const setFavorite = (id: string, favorite: boolean): void => {
    setBookmarks((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, favorite } : x));
      saveBookmarks(next);
      return loadBookmarks();
    });
  };
  const removeBookmark = (id: string): void => {
    setBookmarks((prev) => {
      const next = prev.filter((x) => x.id !== id);
      saveBookmarks(next);
      return loadBookmarks();
    });
  };

  // ---- Round 4: range-list filter/sort (reset per range kind). ----
  const [listQuery, setListQuery] = useState('');
  const [listSort, setListSort] = useState<'asc' | 'desc'>('asc');

  // View mode + range target. Initial mode is سوره. Range modes with a
  // null target show their LIST; a target shows that range's ayahs.
  const [viewMode, setViewMode] = useState<QuranViewMode>(initialView ?? 'surah');
  const [rangeTarget, setRangeTarget] = useState<number | null>(initialTarget ?? null);
  // Round 6: the mushaf key — one parameter for every printed page.
  // It travels beside every page number (URL, bookmarks, resume)
  // because page numbers are per-mushaf, never interchangeable.
  const [mushafKey, setMushafKey] = useState<SvgMushafKey>(
    initialMushaf ?? DEFAULT_SVG_MUSHAF,
  );
  const mushafLabelFor = (k: SvgMushafKey): string =>
    k === 'warsh/kfqc'
      ? labels.mushafWarsh
      : k === 'qalon/kfqc'
        ? labels.mushafQalun
        : k === 'douri/kfqc'
          ? labels.mushafDouri
          : k === 'shubah/kfqc'
            ? labels.mushafShubah
            : labels.mushafHafs;
  const [focusedDisplayIdx, setFocusedDisplayIdx] = useState(0);
  const isRangeMode = viewMode === 'juz' || viewMode === 'hizb' || viewMode === 'page';
  const rangeKind: RangeKind | null = isRangeMode ? viewMode : null;

  // Round 4: a new range list starts unfiltered, ascending.
  useEffect(() => {
    setListQuery('');
    setListSort('asc');
  }, [rangeKind]);

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

  // Mirror view/target/mushaf into the URL (replaceState, no refetch)
  // so a refresh keeps the view. The mushaf key is ALWAYS carried —
  // a deep link without it would silently mean Hafs. Other params
  // (tab/ayah/reciter/...) pass through untouched.
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
    url.searchParams.set('mushaf', mushafKey);
    const next = url.toString();
    if (next !== window.location.href) window.history.replaceState(null, '', next);
  }, [viewMode, rangeTarget, mushafKey]);

  // Back/forward buttons restore the view + mushaf from the URL.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      setViewMode(parseViewParam(params.get('view')));
      const t = params.get('target');
      setRangeTarget(t && /^\d+$/.test(t) ? Number(t) : null);
      setMushafKey(parseSvgMushafKey(params.get('mushaf')));
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
    repeatMode,
    setRepeatMode,
    surahDuration,
    getAudioElement,
    getAudioContext,
    ctxState,
  } = useQuranPlayback(playAyahs, {
    surahAudioUrl: isRangeMode ? null : surah.audioUrl,
    initialRate: settings.playerDefaultSpeed,
    initialRepeat: prefs.repeat,
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

  // Round 7: playback status as VISIBLE text (mini bar + expanded
  // sheet), so a failure is never silent again — the old player only
  // carried data-status, invisible to the user.
  const statusText =
    statusKey === 'playing'
      ? labels.playerStatusPlaying
      : statusKey === 'loading'
        ? labels.playerStatusLoading
        : statusKey === 'paused'
          ? labels.playerStatusPaused
          : statusKey === 'ended'
            ? labels.playerStatusEnded
            : statusKey === 'error'
              ? labels.playerStatusError
              : labels.playerStatusIdle;

  // Round 4 auto-scroll: while playing, advance the window slowly
  // (60/120/180 px per second at speed 1/2/3). Pausing stops it;
  // reaching the bottom stops naturally (scrollY clamps).
  useEffect(() => {
    if (!prefs.autoScroll || !playing) return;
    const pxPerTick = 12 * prefs.autoScrollSpeed;
    const id = window.setInterval(() => {
      window.scrollBy(0, pxPerTick);
    }, 200);
    return () => window.clearInterval(id);
  }, [prefs.autoScroll, prefs.autoScrollSpeed, playing]);

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

  // Round 4 last-read: remember what the reader is looking at (surah
  // + view + target + focused ayah) so the menu page can offer a
  // resume link. Local only; list states save with a null target.
  // Round 6: the mushaf key is saved beside the position.
  useEffect(() => {
    const focused = visible.length > 0 ? visible[clampedFocused] : null;
    const lr: LastRead = {
      surah: surah.number,
      view: viewMode,
      target: isRangeMode ? rangeTarget : null,
      ayah: viewMode === 'ayah' && focused ? focused.standardNumber : null,
      mushaf: mushafKey,
      savedAt: Date.now(),
    };
    saveLastRead(lr);
    setLastRead(lr);
  }, [surah.number, viewMode, rangeTarget, clampedFocused, visible, isRangeMode, mushafKey]);

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

  // ---- Round 6: SVG-tap selection (page view). Tapping a printed
  // page's ayah polygon highlights it and plays it; the selection
  // resets whenever the displayed page changes (it is per-page).
  const [svgSelectedKey, setSvgSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    setSvgSelectedKey(null);
  }, [viewMode, rangeTarget, displayPage, mushafKey]);
  const playSvgAyah = (sn: number, an: number): void => {
    setSvgSelectedKey(`${sn}:${an}`);
    const idx = playMap.get(`${sn}:${an}`);
    if (idx !== undefined) playIndex(idx);
  };

  // ---- Round 6: non-Hafs tap reference. Tapping a non-Hafs polygon
  // does NOT play Hafs audio or show Hafs translation/tafsir for it
  // (that would mix numberings). It highlights the reference and
  // shows the ayah's OWN words in its own edition, labeled as such.
  interface NonHafsSelection {
    surah: number;
    ayah: number;
    page: number;
  }
  const [nonHafsSelected, setNonHafsSelected] = useState<NonHafsSelection | null>(null);
  // undefined = loading, null = unavailable (reference + note only).
  const [nonHafsText, setNonHafsText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setNonHafsSelected(null);
  }, [viewMode, rangeTarget, mushafKey]);
  useEffect(() => {
    if (!nonHafsSelected) return;
    setNonHafsText(undefined);
    let cancelled = false;
    editionAyahText(mushafKey, nonHafsSelected.surah, nonHafsSelected.ayah).then((t) => {
      if (!cancelled) setNonHafsText(t);
    });
    return () => {
      cancelled = true;
    };
  }, [nonHafsSelected, mushafKey]);
  const handleNonHafsTap = (sn: number, an: number): void => {
    setSvgSelectedKey(`${sn}:${an}`);
    setNonHafsSelected({ surah: sn, ayah: an, page: rangeTarget ?? displayPage ?? 1 });
  };


  // ---- Round 5: fullscreen reading view ----
  // The overlay shows ONE mushaf page (readingPage) with its own
  // data pipeline (span → surahs → groups → exact lines), mirroring
  // the main page view so the two can never disagree on what a page
  // contains. Line metrics are NOT rescaled here: the exact-line
  // sizing (3.2cqw) is what keeps a print line on one visual row,
  // and changing it would break the 15-line layout.
  const [readingOpen, setReadingOpen] = useState(false);
  const [readingPage, setReadingPage] = useState<number | null>(null);
  // ---- Round 6: mushaf switch. Picking a mushaf lands the reader on
  // that mushaf's page view, keeping the page NUMBER (re-resolved
  // under the new key — Warsh p42 is not Hafs p42). The reading view,
  // when open, follows to the same number under the new key.
  const selectMushaf = (key: SvgMushafKey): void => {
    const target = displayPage ?? rangeTarget ?? 1;
    setMushafKey(key);
    setViewMode('page');
    setRangeTarget(target);
    if (readingOpen) setReadingPage(target);
    setSheet(null);
  };
  // Surah mode loads no boundaries on its own; the reading view does.
  useEffect(() => {
    if (!readingOpen || boundaries) return;
    let cancelled = false;
    loadBoundaries()
      .then((b) => {
        if (!cancelled) setBoundaries(b);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [readingOpen, boundaries]);
  // Resolve the opening page: the current display page when one
  // exists (page/juz/ayah modes), else the page containing the
  // focused ayah of the entry surah.
  useEffect(() => {
    if (!readingOpen || readingPage !== null || !boundaries) return;
    const focused = visible.length > 0 ? visible[clampedFocused] : null;
    const ref = focused
      ? { surah: surah.number, ayah: focused.standardNumber }
      : { surah: surah.number, ayah: 1 };
    const p = rangeContaining(boundaries, ref.surah, ref.ayah).page;
    if (p !== null) setReadingPage(p);
  }, [readingOpen, readingPage, boundaries, visible, clampedFocused, surah.number]);
  const readingSpan = useMemo(
    () =>
      readingPage !== null && boundaries ? rangeSpan(boundaries, 'page', readingPage) : null,
    [readingPage, boundaries],
  );
  const [readingSurahs, setReadingSurahs] = useState<RangeSurahData[] | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);
  const [readingError, setReadingError] = useState(false);
  useEffect(() => {
    if (!readingOpen || !readingSpan) {
      setReadingSurahs(null);
      setReadingError(false);
      setReadingLoading(false);
      return;
    }
    let cancelled = false;
    setReadingLoading(true);
    setReadingError(false);
    const jobs = readingSpan.surahs.map(async (n): Promise<RangeSurahData> => {
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
        setReadingSurahs(rows);
        setReadingLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setReadingError(true);
        setReadingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readingOpen, readingSpan, surah, ayahs, settings.defaultTranslation, settings.defaultTafsir]);
  const readingGroups = useMemo(
    () =>
      readingSpan && readingSurahs
        ? buildMushafGroups(readingSpan, readingSurahs, madhhab)
        : null,
    [readingSpan, readingSurahs, madhhab],
  );
  const [readingLines, setReadingLines] = useState<MushafExactLine[] | null>(null);
  useEffect(() => {
    if (!readingOpen || readingPage === null) return;
    setReadingLines(null);
    let cancelled = false;
    loadMushafLines().then((pages) => {
      if (cancelled) return;
      setReadingLines(
        pages && readingPage >= 1 && readingPage <= pages.length
          ? pages[readingPage - 1]
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [readingOpen, readingPage]);
  // Reading page meta (last-ayah rule, same as the main page header).
  const readingLastRef =
    readingGroups && readingGroups.length > 0
      ? (() => {
          const g = readingGroups[readingGroups.length - 1];
          const d = g.items[g.items.length - 1];
          return d ? { surah: g.surahNumber, ayah: d.standardNumber } : null;
        })()
      : null;
  const readingMeta =
    readingPage !== null && readingSpan && boundaries
      ? rangeContaining(
          boundaries,
          (readingLastRef ?? readingSpan.start).surah,
          (readingLastRef ?? readingSpan.start).ayah,
        )
      : { juz: null, hizb: null, page: null };
  const readingSurahName =
    readingGroups && readingGroups.length > 0
      ? readingGroups[readingGroups.length - 1].surahNameAr
      : '';

  const openReading = (): void => {
    setReadingPage(displayPage);
    setSheet(null);
    setReadingOpen(true);
  };
  const closeReading = (): void => {
    // Land the main view where reading stopped (page mode), so the
    // last-read resume and the main view agree with the reading view.
    if (readingPage !== null) {
      setViewMode('page');
      setRangeTarget(readingPage);
    }
    setSheet(null);
    setReadingOpen(false);
  };
  // Body scroll lock while the reading overlay is open.
  useEffect(() => {
    if (!readingOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [readingOpen]);
  // Site chrome: the reader lives inside main (a z-index:1 stacking
  // context under the sticky site header), so a fixed layer inside it
  // can NEVER paint above the header — that is why the overlay and
  // the sheets portal to document.body (below). As a second layer,
  // while reading or in fallback fullscreen the site header/footer
  // are hidden outright, so no chrome can ever peek through.
  useEffect(() => {
    document.body.classList.toggle('quran-chrome-hidden', readingOpen || fallbackFs);
    return () => {
      document.body.classList.remove('quran-chrome-hidden');
    };
  }, [readingOpen, fallbackFs]);
  // Escape: close the topmost sheet, else the reading view, else the
  // fallback fullscreen. (Native fullscreen Escape is the browser's.)
  useEffect(() => {
    if (!sheet && !readingOpen && !fallbackFs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sheet) setSheet(null);
      else if (readingOpen) closeReading();
      else setFallbackFs(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet, readingOpen, fallbackFs, readingPage]);
  // Picker range choice: the main view follows (deep link via the
  // URL-mirror effect) and the reading view jumps to the range's
  // first page when it is open.
  const selectRangeFromPicker = (kind: RangeKind, target: number, firstPage: number): void => {
    setViewMode(kind);
    setRangeTarget(target);
    if (readingOpen) setReadingPage(firstPage);
    setSheet(null);
  };
  // Reading bottom-bar play: the main player's own logic (pause /
  // resume / start the current set) — the reading view has no
  // separate playback set, so it never plays something else.
  const readingPlayToggle = (): void => {
    if (statusKey === 'playing' || statusKey === 'loading') pause();
    else if (statusKey === 'paused') resume();
    else if (isRangeMode) playIndex(0);
    else playIndex(highlightAyah ? highlightAyah - 1 : 0);
  };
  const pickerLabels: PickerSheetLabels = {
    title: labels.pickerTitle,
    searchLabel: labels.pickerSearchLabel,
    searchPlaceholder: labels.pickerSearchPlaceholder,
    closeLabel: labels.pickerCloseLabel,
    noResults: searchLabels.noResults,
    loading: labels.rangeLoading,
    tabSurah: labels.modeSurah,
    tabJuz: labels.modeJuz,
    tabHizb: labels.modeHizb,
    tabPage: labels.modePage,
  };
  const mushafLabels: MushafPickerLabels = {
    title: labels.mushafTitle,
    closeLabel: labels.pickerCloseLabel,
    hafs: labels.mushafHafs,
    warsh: labels.mushafWarsh,
    qalun: labels.mushafQalun,
    douri: labels.mushafDouri,
    shubah: labels.mushafShubah,
    hafsMargins: labels.mushafHafsMargins,
    warshMargins: labels.mushafWarshMargins,
    qalunMargins: labels.mushafQalunMargins,
    madina: labels.mushafMadina,
    tajweed: labels.mushafTajweed,
    current: labels.mushafCurrent,
    soon: labels.mushafSoon,
    note: labels.mushafNote,
  };

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
  // Round 4 list filter/sort: digits match the range number (any
  // digit script); otherwise the query matches the start surah's
  // Arabic name after the same normalization as search. Sort is by
  // range number only (name sort is meaningless for page lists).
  const filteredListEntries = useMemo(() => {
    if (!listEntries) return null;
    const q = listQuery.trim();
    let rows = listEntries;
    if (q) {
      const digits = toLatinDigits(q);
      if (/^[0-9]+$/.test(digits)) {
        const n = Number(digits);
        rows = rows.filter((e) => e.n === n);
      } else {
        const nq = normalizeQuranText(q);
        rows = rows.filter((e) => normalizeQuranText(surahNameAr(e.surah)).includes(nq));
      }
    }
    return listSort === 'desc' ? [...rows].reverse() : rows;
  }, [listEntries, listQuery, listSort, surahList]);
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



  // Round 4: edition navigation (same reload pattern as the reciter
  // select — the page already honors ?translation= / ?tafsir=).
  const navigateWithParam = (param: string, value: string | null): void => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(param, value);
    else url.searchParams.delete(param);
    window.location.href = url.toString();
  };
  const translationOptions = editionOptions(
    PERSIAN_TRANSLATIONS,
    [
      ...(translationEditions ?? []),
      ...(settings.defaultTranslation ? [settings.defaultTranslation] : []),
    ],
    locale,
  );
  const tafsirOptions = editionOptions(
    ARABIC_TAFSIRS,
    [...(tafsirEditions ?? []), ...(settings.defaultTafsir ? [settings.defaultTafsir] : [])],
    locale,
  );

  // Round 5 sheets, rendered once: inside the reading overlay when
  // it is open, at the reader root otherwise (never both).
  const sheetNodes = (
    <>
      {sheet === 'picker' ? (
        <QuranPickerSheet
          locale={locale}
          surahList={surahList}
          currentSurah={surah.number}
          currentView={viewMode}
          currentTarget={rangeTarget}
          onSelectRange={selectRangeFromPicker}
          onClose={() => setSheet(null)}
          labels={pickerLabels}
        />
      ) : null}
      {sheet === 'mushaf' ? (
        <QuranMushafPicker
          onClose={() => setSheet(null)}
          labels={mushafLabels}
          currentMushaf={mushafKey}
          onSelect={selectMushaf}
        />
      ) : null}
      {sheet === 'settings' ? (
        <QuranSheetShell
          title={labels.readingSettingsLabel}
          closeLabel={labels.pickerCloseLabel}
          onClose={() => setSheet(null)}
        >
          <div className="quran-reading-settings">
            <label className="quran-reading-setting">
              <span>{labels.displayFontLabel}</span>
              <select
                value={prefs.font}
                onChange={(e) => updatePrefs({ font: e.target.value as DisplayPrefs['font'] })}
              >
                <option value="system">{labels.fontSystem}</option>
                <option value="amiri">{labels.fontAmiri}</option>
                <option value="scheherazade">{labels.fontScheherazade}</option>
              </select>
            </label>
            <label className="quran-reading-setting">
              <span>
                {labels.fontSizeLabel} ({prefs.fontSize}px)
              </span>
              <input
                type="range"
                min={12}
                max={40}
                step={1}
                value={prefs.fontSize}
                onChange={(e) => updatePrefs({ fontSize: Number(e.target.value) })}
                aria-label={labels.fontSizeLabel}
              />
            </label>
            <label className="quran-reading-setting">
              <span>{labels.displayThemeLabel}</span>
              <select
                value={prefs.theme}
                onChange={(e) => updatePrefs({ theme: e.target.value as DisplayPrefs['theme'] })}
              >
                <option value="dark">{labels.themeDark}</option>
                <option value="sepia">{labels.themeSepia}</option>
                <option value="light">{labels.themeLight}</option>
                <option value="green">{labels.themeGreen}</option>
              </select>
            </label>
            <label className="quran-reading-setting quran-toggle">
              <input
                type="checkbox"
                checked={prefs.autoScroll}
                onChange={(e) => updatePrefs({ autoScroll: e.target.checked })}
              />
              {labels.autoScrollLabel}
            </label>
            <button
              type="button"
              className="quran-nav-btn quran-reading-btn"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void requestFs(readingRef.current, () => {});
              }}
            >
              {isFullscreen ? labels.exitFullscreenLabel : labels.fullscreenLabel}
            </button>
          </div>
        </QuranSheetShell>
      ) : null}
      {sheet === 'bookmarks' ? (
        <QuranSheetShell
          title={labels.bookmarksTitle}
          closeLabel={labels.pickerCloseLabel}
          onClose={() => setSheet(null)}
        >
          {lastRead ? (
            <p className="quran-resume">
              <span>{labels.lastReadLabel}: </span>
              <Link href={lastReadHref(lastRead, locale)}>{labels.resumeReading}</Link>
            </p>
          ) : null}
          {bookmarks.length === 0 ? (
            <p className="quran-sheet-empty">{labels.bookmarksEmpty}</p>
          ) : (
            <ul className="quran-bookmark-list">
              {bookmarks.map((b) => (
                <li key={b.id} className="quran-bookmark-row">
                  <Link href={bookmarkHref(b, locale)} lang="ar" dir="rtl">
                    {b.label}
                  </Link>
                  <button
                    type="button"
                    className="quran-bookmark-star"
                    onClick={() => setFavorite(b.id, !b.favorite)}
                    aria-label={b.favorite ? labels.bookmarkUnfavorite : labels.bookmarkFavorite}
                    title={b.favorite ? labels.bookmarkUnfavorite : labels.bookmarkFavorite}
                  >
                    {b.favorite ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    className="quran-bookmark-remove"
                    onClick={() => removeBookmark(b.id)}
                    aria-label={labels.bookmarkRemoveBtn}
                  >
                    {labels.bookmarkRemoveBtn}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QuranSheetShell>
      ) : null}
    </>
  );

  return (
    <div
      ref={readerRef}
      className={`quran-reader ${scriptClass} ${displayFontClass(prefs.font)} ${displayThemeClass(prefs.theme)} quran-mushaf-${mushafKey.replace('/', '-')}${fallbackFs ? ' quran-fallback-fullscreen' : ''}`}
      style={{ '--quran-ayah-size': `${prefs.fontSize}px` } as React.CSSProperties}
    >
      {fallbackFs ? (
        <button
          type="button"
          className="quran-fallback-exit"
          onClick={() => setFallbackFs(false)}
          aria-label={labels.exitFullscreenLabel}
        >
          ✕ {labels.exitFullscreenLabel}
        </button>
      ) : null}
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

      {/* Round 7: on mobile the whole settings panel collapses into ONE
          button + bottom sheet. Same controls, same handlers — only the
          presentation collapses; on desktop the wrapper is
          display:contents, so the layout is exactly as before. */}
      <button
        type="button"
        className="quran-settings-open-btn"
        onClick={() => setSettingsSheetOpen(true)}
        aria-expanded={settingsSheetOpen}
        aria-haspopup="dialog"
      >
        ⚙ {labels.settingsSheetTitle}
      </button>
      {settingsSheetOpen ? (
        <button
          type="button"
          className="quran-settings-backdrop"
          onClick={() => setSettingsSheetOpen(false)}
          aria-label={labels.settingsSheetClose}
        />
      ) : null}
      <div
        className={
          settingsSheetOpen
            ? 'quran-mobile-settings quran-mobile-settings-open'
            : 'quran-mobile-settings'
        }
      >
        <button
          type="button"
          className="quran-settings-close-btn"
          onClick={() => setSettingsSheetOpen(false)}
        >
          × {labels.settingsSheetClose}
        </button>
        <p className="quran-settings-group-title">{labels.settingsGroupAudio}</p>
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

      {/* Round 4 display toolbar: font / size / theme / fullscreen /
          auto-scroll — per-device localStorage over CRM defaults. */}
      <p className="quran-settings-group-title">{labels.settingsGroupDisplay}</p>
      <div className="quran-toolbar quran-display-toolbar" role="toolbar">
        <label className="quran-reciter">
          <span>{labels.displayFontLabel}</span>
          <select
            value={prefs.font}
            onChange={(e) => updatePrefs({ font: e.target.value as DisplayPrefs['font'] })}
          >
            <option value="system">{labels.fontSystem}</option>
            <option value="amiri">{labels.fontAmiri}</option>
            <option value="scheherazade">{labels.fontScheherazade}</option>
          </select>
        </label>
        <label className="quran-reciter">
          <span>
            {labels.fontSizeLabel} ({prefs.fontSize}px)
          </span>
          <input
            type="range"
            min={12}
            max={40}
            step={1}
            value={prefs.fontSize}
            onChange={(e) => updatePrefs({ fontSize: Number(e.target.value) })}
            aria-label={labels.fontSizeLabel}
          />
        </label>
        <label className="quran-reciter">
          <span>{labels.displayThemeLabel}</span>
          <select
            value={prefs.theme}
            onChange={(e) => updatePrefs({ theme: e.target.value as DisplayPrefs['theme'] })}
          >
            <option value="dark">{labels.themeDark}</option>
            <option value="sepia">{labels.themeSepia}</option>
            <option value="light">{labels.themeLight}</option>
            <option value="green">{labels.themeGreen}</option>
          </select>
        </label>
        <button type="button" className="quran-nav-btn" onClick={toggleFullscreen}>
          {isFullscreen ? labels.exitFullscreenLabel : labels.fullscreenLabel}
        </button>
        <label className="quran-toggle">
          <input
            type="checkbox"
            checked={prefs.autoScroll}
            onChange={(e) => updatePrefs({ autoScroll: e.target.checked })}
          />
          {labels.autoScrollLabel}
        </label>
        {prefs.autoScroll ? (
          <label className="quran-reciter">
            <span>{labels.autoScrollSpeedLabel}</span>
            <select
              value={prefs.autoScrollSpeed}
              onChange={(e) => updatePrefs({ autoScrollSpeed: Number(e.target.value) })}
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={3}>3×</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="quran-nav-btn"
          onClick={() => setBookmarksOpen((v) => !v)}
          aria-expanded={bookmarksOpen}
        >
          {labels.bookmarksLabel}
          {bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}
        </button>
        {/* Round 5: reading view + picker + mushaf, from the main view. */}
        <button type="button" className="quran-nav-btn quran-reading-btn" onClick={openReading}>
          {labels.readingLabel}
        </button>
        <button
          type="button"
          className="quran-nav-btn quran-reading-btn"
          onClick={() => setSheet('picker')}
          aria-haspopup="dialog"
        >
          {labels.pickerLabel}
        </button>
        <button
          type="button"
          className="quran-nav-btn quran-reading-btn"
          onClick={() => setSheet('mushaf')}
          aria-haspopup="dialog"
        >
          {labels.mushafLabel}
        </button>
      </div>

      {/* Round 4 edition selectors: CRM-enabled lists first, then the
          verified AlQuran Cloud catalogs. Texts load live through the
          existing provider mechanism — nothing is bundled here. */}
      <p className="quran-settings-group-title">{labels.settingsGroupEditions}</p>
      <div className="quran-toolbar quran-edition-toolbar" role="toolbar">
        <label className="quran-reciter">
          <span>{labels.translationEditionLabel}</span>
          <select
            value={settings.defaultTranslation ?? ''}
            onChange={(e) => navigateWithParam('translation', e.target.value || null)}
          >
            {translationOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {settings.defaultTranslation ? (
            <code className="quran-edition-id" dir="ltr">
              {settings.defaultTranslation}
            </code>
          ) : null}
        </label>
        <label className="quran-reciter">
          <span>{labels.tafsirEditionLabel}</span>
          <select
            value={settings.defaultTafsir ?? ''}
            onChange={(e) => navigateWithParam('tafsir', e.target.value || null)}
          >
            {tafsirOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {settings.defaultTafsir ? (
            <code className="quran-edition-id" dir="ltr">
              {settings.defaultTafsir}
            </code>
          ) : null}
        </label>
      </div>

      {/* Round 4 bookmarks panel (local only) + last-read resume. */}
      {bookmarksOpen ? (
        <section className="quran-bookmarks" aria-label={labels.bookmarksTitle}>
          <h2>{labels.bookmarksTitle}</h2>
          {lastRead ? (
            <p className="quran-resume">
              <span>{labels.lastReadLabel}: </span>
              <Link href={lastReadHref(lastRead, locale)}>{labels.resumeReading}</Link>
            </p>
          ) : null}
          {bookmarks.length === 0 ? (
            <p className="quran-mode-note">{labels.bookmarksEmpty}</p>
          ) : (
            <ul className="quran-bookmark-list">
              {bookmarks.map((b) => (
                <li key={b.id} className="quran-bookmark-row">
                  <Link href={bookmarkHref(b, locale)} lang="ar" dir="rtl">
                    {b.label}
                  </Link>
                  <button
                    type="button"
                    className="quran-bookmark-star"
                    onClick={() => setFavorite(b.id, !b.favorite)}
                    aria-label={b.favorite ? labels.bookmarkUnfavorite : labels.bookmarkFavorite}
                    title={b.favorite ? labels.bookmarkUnfavorite : labels.bookmarkFavorite}
                  >
                    {b.favorite ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    className="quran-bookmark-remove"
                    onClick={() => removeBookmark(b.id)}
                  >
                    {labels.bookmarkRemoveBtn}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      </div>
      {/* End of the round-7 mobile settings wrapper (toolbars +
          bookmarks panel). Search + player stay outside it. */}

      <QuranSearchBox locale={locale} surahs={surahList} labels={searchLabels} />

      {/* Audio player bar — the waveform lives INSIDE the progress bar
          (no separate waveform row). Hidden for range LISTS (navigation,
          not reading); shown for every reading view. */}
      {showPlayer ? (
        <>
          {/* Round 7 mobile mini bar (desktop: display:none): slim
              sticky bar — photo/♪ + reciter + title + status + prev /
              play / next + a thin progress line on the top edge.
              Tapping the bar (not the buttons) expands the full player
              sheet below; the expand button covers the bar so the
              whole bar is the tap target, while the control buttons
              sit above it. Rendered only when audio exists; without
              audio the plain note below stays in flow. */}
          {canPlay ? (
            <div
              className={
                playerExpanded
                  ? 'quran-player-mini quran-player-mini-hidden'
                  : 'quran-player-mini'
              }
              role="region"
              aria-label={labels.playSurah}
              data-status={statusKey}
            >
              <div className="quran-player-mini-progress" aria-hidden="true">
                <div
                  className="quran-player-mini-progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <button
                type="button"
                className="quran-player-mini-expand"
                onClick={() => setPlayerExpanded(true)}
                aria-label={labels.playerExpandLabel}
              />
              {settings.playerShowPhoto ? (
                currentReciter?.photoUrl ? (
                  <img
                    className="quran-player-mini-photo"
                    src={currentReciter.photoUrl}
                    alt={currentReciterName ?? currentReciter.name}
                  />
                ) : (
                  <span
                    className="quran-player-mini-photo quran-reciter-photo-empty"
                    aria-hidden="true"
                  >
                    ♪
                  </span>
                )
              ) : null}
              <span className="quran-player-mini-text">
                {currentReciterName ? (
                  <span className="quran-player-mini-reciter">{currentReciterName}</span>
                ) : null}
                <span className="quran-player-mini-title" lang="ar" dir="rtl">
                  {playerTitle}
                </span>
                <span className="quran-player-mini-status" role="status">
                  {statusText}
                </span>
              </span>
              <span className="quran-player-mini-controls">
                <button
                  type="button"
                  className="quran-mini-btn"
                  onClick={() => playCurrent(-1)}
                  aria-label={labels.prevAyah}
                  disabled={!canPlay}
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className="quran-mini-btn quran-mini-play"
                  onClick={readingPlayToggle}
                  aria-label={
                    statusKey === 'playing' || statusKey === 'loading'
                      ? labels.pause
                      : statusKey === 'paused'
                        ? labels.resume
                        : labels.playSurah
                  }
                >
                  {statusKey === 'playing' || statusKey === 'loading' ? '❚❚' : '▶'}
                </button>
                <button
                  type="button"
                  className="quran-mini-btn"
                  onClick={() => playCurrent(1)}
                  aria-label={labels.nextAyah}
                  disabled={!canPlay}
                >
                  ⏭
                </button>
              </span>
            </div>
          ) : null}
          <div
            className={
              playerExpanded ? 'quran-player quran-player-expanded' : 'quran-player'
            }
            role="region"
            aria-label={labels.playSurah}
            data-status={statusKey}
          >
            {/* Round 7: collapse button for the mobile expanded sheet
                (desktop: display:none). */}
            <button
              type="button"
              className="quran-player-collapse-btn"
              onClick={() => setPlayerExpanded(false)}
            >
              × {labels.playerCollapseLabel}
            </button>
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
                {/* Round 7: visible status (mobile; desktop keeps the
                    old times row exactly — see CSS). */}
                <span className="quran-player-status" role="status" dir="auto">
                  {statusText}
                </span>
                <span>
                  {formatTime(state.currentTime)} /{' '}
                  {state.duration > 0
                    ? formatTime(state.duration)
                    : surahDuration !== null
                      ? formatTime(surahDuration)
                      : '–'}
                </span>
                {surahDuration !== null ? (
                  // Round 7: the total is the SECTION total, labelled
                  // with the section itself — a page total must never
                  // read as a surah total. Ground truth 2026-11-02
                  // (ffprobe on the real Alafasy files): page 566's
                  // 18 ayahs sum to 173.57s = 2:53, so the shown 2:53
                  // was CORRECT; only the display misled (0:00 / –).
                  <span dir="auto">
                    {totalLabel}
                    {rangeTitle ? ` (${rangeTitle})` : ''}: {formatTime(surahDuration)}
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
                <label className="quran-speed">
                  <span>{labels.repeatLabel}</span>
                  <select
                    value={repeatMode}
                    onChange={(e) => {
                      const m = e.target.value as 'off' | 'ayah' | 'surah';
                      setRepeatMode(m);
                      updatePrefs({ repeat: m });
                    }}
                    aria-label={labels.repeatLabel}
                  >
                    <option value="off">{labels.repeatOff}</option>
                    <option value="ayah">{labels.repeatAyah}</option>
                    <option value="surah">{labels.repeatSurah}</option>
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
        </>
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
            <>
              <div className="quran-list-tools" role="toolbar">
                <label>
                  <span>{labels.listFilterLabel}</span>
                  <input
                    type="search"
                    value={listQuery}
                    onChange={(e) => setListQuery(e.target.value)}
                    placeholder={labels.listFilterPlaceholder}
                    aria-label={labels.listFilterLabel}
                  />
                </label>
                <label>
                  <span>{labels.listSortLabel}</span>
                  <select
                    value={listSort}
                    onChange={(e) => setListSort(e.target.value as 'asc' | 'desc')}
                    aria-label={labels.listSortLabel}
                  >
                    <option value="asc">{labels.listSortAsc}</option>
                    <option value="desc">{labels.listSortDesc}</option>
                  </select>
                </label>
              </div>
              {filteredListEntries && filteredListEntries.length === 0 ? (
                <p className="quran-mode-note">{searchLabels.noResults}</p>
              ) : null}
            <ol className="quran-range-list">
              {(filteredListEntries ?? []).map((entry) => (
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
            </>
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
            {displayPage !== null ? (
              <button
                type="button"
                className="quran-bookmark-btn"
                onClick={() =>
                  toggleBookmark({
                    id: pageBookmarkId(
                      displayPage,
                      viewMode === 'page' ? mushafKey : DEFAULT_SVG_MUSHAF,
                    ),
                    kind: 'page',
                    surah: surah.number,
                    ayah: null,
                    page: displayPage,
                    mushaf: viewMode === 'page' ? mushafKey : DEFAULT_SVG_MUSHAF,
                    label: labels.pageCurrent.replace('%n%', String(displayPage)),
                    favorite: false,
                    createdAt: Date.now(),
                  })
                }
                aria-label={
                  bookmarkIds.has(
                    pageBookmarkId(
                      displayPage,
                      viewMode === 'page' ? mushafKey : DEFAULT_SVG_MUSHAF,
                    ),
                  )
                    ? labels.bookmarkRemove
                    : labels.bookmarkPage
                }
                title={
                  bookmarkIds.has(
                    pageBookmarkId(
                      displayPage,
                      viewMode === 'page' ? mushafKey : DEFAULT_SVG_MUSHAF,
                    ),
                  )
                    ? labels.bookmarkRemove
                    : labels.bookmarkPage
                }
              >
                {bookmarkIds.has(
                  pageBookmarkId(
                    displayPage,
                    viewMode === 'page' ? mushafKey : DEFAULT_SVG_MUSHAF,
                  ),
                )
                  ? '★'
                  : '☆'}
              </button>
            ) : null}
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
          {viewMode === 'page' && mushafKey !== DEFAULT_SVG_MUSHAF ? (
            <>
              {/* Round 6, non-Hafs page: the page is its OWN mushaf's
              SVG — the Hafs pipeline (boundaries, exact lines, API
              text) is never consulted for it, so no Hafs content can
              leak under another key. The header's surah comes from
              the page's own ayah list; juz/hizb are omitted (this
              mushaf's per-page juz/hizb is not in the data used). */}
              <QuranMushafPage
                groups={[]}
                exactLines={null}
                pageNumber={rangeTarget}
                juz={null}
                hizb={null}
                headerSurah=""
                headerSurahTemplate={labels.mushafHeaderSurah}
                pageCurrent={labels.pageCurrent}
                juzCurrent={labels.juzCurrent}
                hizbCurrent={labels.hizbCurrent}
                bismillah={labels.bismillah}
                scriptClass={scriptClass}
                playingKey={null}
                highlightKey={svgSelectedKey}
                onPlayAyah={() => {}}
                svgPage
                mushafKey={mushafKey}
                resolveSurahName={surahNameAr}
                onSelectAyah={handleNonHafsTap}
                svgFallbackNote={labels.svgFallbackNote}
                svgUnavailableNote={labels.svgUnavailableNote}
                svgCredit={labels.svgCredit}
              />
              {nonHafsSelected ? (
                <div className="quran-svg-refpanel">
                  <p className="quran-svg-refpanel-ref" lang="ar" dir="rtl">
                    {mushafLabelFor(mushafKey)} · {surahNameAr(nonHafsSelected.surah)} ·{' '}
                    {nonHafsSelected.ayah}
                  </p>
                  {nonHafsText === undefined ? (
                    <p className="quran-mode-note">{labels.rangeLoading}</p>
                  ) : nonHafsText ? (
                    <div className="quran-svg-refpanel-text">
                      <span className="ayah-sub-label">{labels.svgEditionTextLabel}</span>
                      <p lang="ar" dir="rtl">
                        {nonHafsText}
                      </p>
                    </div>
                  ) : null}
                  <p className="quran-svg-refpanel-note">{labels.svgRefPanelNote}</p>
                  <button
                    type="button"
                    className="quran-bookmark-btn"
                    onClick={() =>
                      toggleBookmark({
                        id: ayahBookmarkId(
                          nonHafsSelected.surah,
                          nonHafsSelected.ayah,
                          mushafKey,
                        ),
                        kind: 'ayah',
                        surah: nonHafsSelected.surah,
                        ayah: nonHafsSelected.ayah,
                        page: nonHafsSelected.page,
                        mushaf: mushafKey,
                        label: `${mushafLabelFor(mushafKey)} · ${surahNameAr(nonHafsSelected.surah)} · ${nonHafsSelected.ayah}`,
                        favorite: false,
                        createdAt: Date.now(),
                      })
                    }
                    aria-label={
                      bookmarkIds.has(
                        ayahBookmarkId(nonHafsSelected.surah, nonHafsSelected.ayah, mushafKey),
                      )
                        ? labels.bookmarkRemove
                        : labels.bookmarkAyah
                    }
                    title={
                      bookmarkIds.has(
                        ayahBookmarkId(nonHafsSelected.surah, nonHafsSelected.ayah, mushafKey),
                      )
                        ? labels.bookmarkRemove
                        : labels.bookmarkAyah
                    }
                  >
                    {bookmarkIds.has(
                      ayahBookmarkId(nonHafsSelected.surah, nonHafsSelected.ayah, mushafKey),
                    )
                      ? '★'
                      : '☆'}
                  </button>
                </div>
              ) : null}
            </>
          ) : rangeLoading || !rangeGroups || (viewMode === 'juz' && (displayPage === null || !displayPageGroups)) ? (
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
                // Round 6: page mode shows the real printed SVG page;
                // juz mode stays text-lines (20 scrolling SVG pages is
                // the documented mobile performance trap).
                svgPage={viewMode === 'page'}
                mushafKey={mushafKey}
                resolveSurahName={surahNameAr}
                highlightKey={svgSelectedKey ?? playingKey}
                onSelectAyah={playSvgAyah}
                svgFallbackNote={labels.svgFallbackNote}
                svgUnavailableNote={labels.svgUnavailableNote}
                svgCredit={labels.svgCredit}
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
                            <>
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
                              <button
                                type="button"
                                className="quran-bookmark-btn"
                                onClick={() =>
                                  toggleBookmark({
                                    id: ayahBookmarkId(group.surahNumber, d.standardNumber),
                                    kind: 'ayah',
                                    surah: group.surahNumber,
                                    ayah: d.standardNumber,
                                    page: null,
                                    mushaf: DEFAULT_SVG_MUSHAF,
                                    label: `${group.surahNameAr} · ${d.standardNumber}`,
                                    favorite: false,
                                    createdAt: Date.now(),
                                  })
                                }
                                aria-label={
                                  bookmarkIds.has(ayahBookmarkId(group.surahNumber, d.standardNumber))
                                    ? labels.bookmarkRemove
                                    : labels.bookmarkAyah
                                }
                                title={
                                  bookmarkIds.has(ayahBookmarkId(group.surahNumber, d.standardNumber))
                                    ? labels.bookmarkRemove
                                    : labels.bookmarkAyah
                                }
                              >
                                {bookmarkIds.has(ayahBookmarkId(group.surahNumber, d.standardNumber))
                                  ? '★'
                                  : '☆'}
                              </button>
                            </>
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
                className="quran-bookmark-btn"
                onClick={() =>
                  toggleBookmark({
                    id: ayahBookmarkId(surah.number, visible[clampedFocused].standardNumber),
                    kind: 'ayah',
                    surah: surah.number,
                    ayah: visible[clampedFocused].standardNumber,
                    page: null,
                    mushaf: DEFAULT_SVG_MUSHAF,
                    label: `${surah.nameAr} · ${visible[clampedFocused].standardNumber}`,
                    favorite: false,
                    createdAt: Date.now(),
                  })
                }
                aria-label={
                  bookmarkIds.has(ayahBookmarkId(surah.number, visible[clampedFocused].standardNumber))
                    ? labels.bookmarkRemove
                    : labels.bookmarkAyah
                }
                title={
                  bookmarkIds.has(ayahBookmarkId(surah.number, visible[clampedFocused].standardNumber))
                    ? labels.bookmarkRemove
                    : labels.bookmarkAyah
                }
              >
                {bookmarkIds.has(ayahBookmarkId(surah.number, visible[clampedFocused].standardNumber))
                  ? '★'
                  : '☆'}
              </button>
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
            ) : mushafKey !== DEFAULT_SVG_MUSHAF ? (
              // Round 6: the ayah view is a Hafs-text view (focused
              // ayah + its page). Under a non-Hafs key, the page
              // containing a Hafs ayah needs the ayah-number map,
              // which is not wired yet — so NO page is shown here
              // rather than a Hafs page under another key. The
              // printed-page views (page + reading) carry the key.
              <p className="quran-svg-fallback-note" role="note">
                {labels.svgNonHafsAyahNote}
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
                  // Round 6: the ayah view's page is the real printed
                  // SVG page; tapping a polygon moves the focus (and
                  // the translation/tafsir panel below) to that ayah
                  // when it belongs to the entry surah.
                  svgPage
                  mushafKey={mushafKey}
                  resolveSurahName={surahNameAr}
                  onSelectAyah={(sn, an) => {
                    if (sn !== surah.number) return;
                    const idx = visible.findIndex((d) => d.standardNumber === an);
                    if (idx >= 0) setFocusedDisplayIdx(idx);
                  }}
                  svgFallbackNote={labels.svgFallbackNote}
                  svgUnavailableNote={labels.svgUnavailableNote}
                  svgCredit={labels.svgCredit}
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
                    <>
                      <AyahNotes
                        surah={surah.number}
                        ayahNumber={d.standardNumber}
                        locale={locale}
                        labels={labels}
                        onPlayAyah={() => playIndex(d.standardIndex)}
                        canPlay={Boolean(d.ayah.audioUrl)}
                      />
                      <button
                        type="button"
                        className="quran-bookmark-btn"
                        onClick={() =>
                          toggleBookmark({
                            id: ayahBookmarkId(surah.number, d.standardNumber),
                            kind: 'ayah',
                            surah: surah.number,
                            ayah: d.standardNumber,
                            page: null,
                            mushaf: DEFAULT_SVG_MUSHAF,
                            label: `${surah.nameAr} · ${d.standardNumber}`,
                            favorite: false,
                            createdAt: Date.now(),
                          })
                        }
                        aria-label={
                          bookmarkIds.has(ayahBookmarkId(surah.number, d.standardNumber))
                            ? labels.bookmarkRemove
                            : labels.bookmarkAyah
                        }
                        title={
                          bookmarkIds.has(ayahBookmarkId(surah.number, d.standardNumber))
                            ? labels.bookmarkRemove
                            : labels.bookmarkAyah
                        }
                      >
                        {bookmarkIds.has(ayahBookmarkId(surah.number, d.standardNumber)) ? '★' : '☆'}
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ---- Round 5: fullscreen reading view ---- */}
      {readingOpen
        ? createPortal(
            <div
              ref={readingRef}
              className="quran-reading"
              role="dialog"
              aria-modal="true"
              aria-label={labels.readingLabel}
            >
              <div className="quran-reading-top">
                <span className="quran-reading-top-page" lang="ar" dir="rtl">
                  {readingPage !== null
                    ? labels.pageCurrent.replace('%n%', toArabicIndicDigits(readingPage))
                    : ''}
                </span>
                <span className="quran-reading-top-surah" lang="ar" dir="rtl">
                  {readingSurahName}
                </span>
                <span className="quran-reading-top-range">
                  <span lang="ar" dir="rtl">
                    {[
                      readingMeta.juz !== null
                        ? labels.juzCurrent.replace('%n%', toArabicIndicDigits(readingMeta.juz))
                        : null,
                      readingMeta.hizb !== null
                        ? labels.hizbCurrent.replace('%n%', toArabicIndicDigits(readingMeta.hizb))
                        : null,
                    ]
                      .filter((x): x is string => x !== null)
                      .join(' · ')}
                  </span>
                  <button
                    type="button"
                    className="quran-reading-exit"
                    onClick={closeReading}
                    aria-label={labels.exitReadingLabel}
                  >
                    ✕ <span className="quran-reading-exit-text">{labels.exitReadingLabel}</span>
                  </button>
                </span>
              </div>
              <div className="quran-reading-scroll">
                <div className="quran-reading-pagenav">
                  <button
                    type="button"
                    onClick={() =>
                      readingPage !== null && setReadingPage(Math.max(1, readingPage - 1))
                    }
                    disabled={readingPage === null || readingPage <= 1}
                    aria-label={labels.prevPage}
                  >
                    {labels.prevPage}
                  </button>
                  <span>
                    {readingPage !== null
                      ? labels.readingPageOf
                          .replace('%current%', toArabicIndicDigits(readingPage))
                          .replace('%total%', toArabicIndicDigits(RANGE_COUNTS.page))
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="quran-reading-bookmark"
                    onClick={() => {
                      if (readingPage === null) return;
                      toggleBookmark({
                        id: pageBookmarkId(readingPage, mushafKey),
                        kind: 'page',
                        surah: surah.number,
                        ayah: null,
                        page: readingPage,
                        mushaf: mushafKey,
                        label: labels.pageCurrent.replace('%n%', String(readingPage)),
                        favorite: false,
                        createdAt: Date.now(),
                      });
                    }}
                    aria-label={
                      readingPage !== null && bookmarkIds.has(pageBookmarkId(readingPage, mushafKey))
                        ? labels.bookmarkRemove
                        : labels.bookmarkPage
                    }
                    title={
                      readingPage !== null && bookmarkIds.has(pageBookmarkId(readingPage, mushafKey))
                        ? labels.bookmarkRemove
                        : labels.bookmarkPage
                    }
                  >
                    {readingPage !== null && bookmarkIds.has(pageBookmarkId(readingPage, mushafKey))
                      ? '★'
                      : '☆'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      readingPage !== null &&
                      setReadingPage(Math.min(RANGE_COUNTS.page, readingPage + 1))
                    }
                    disabled={readingPage === null || readingPage >= RANGE_COUNTS.page}
                    aria-label={labels.nextPage}
                  >
                    {labels.nextPage}
                  </button>
                </div>
                {readingLoading || !readingGroups ? (
                  <p className="quran-mode-note">
                    {readingError ? labels.rangeFailed : labels.rangeLoading}
                  </p>
                ) : (
                  <QuranMushafPage
                    groups={readingGroups}
                    exactLines={readingLines}
                    pageNumber={readingPage ?? 1}
                    juz={readingMeta.juz}
                    hizb={readingMeta.hizb}
                    headerSurah={readingSurahName}
                    headerSurahTemplate={labels.mushafHeaderSurah}
                    pageCurrent={labels.pageCurrent}
                    juzCurrent={labels.juzCurrent}
                    hizbCurrent={labels.hizbCurrent}
                    bismillah={labels.bismillah}
                    scriptClass={scriptClass}
                    playingKey={playingKey}
                    linesClickable={false}
                    hideMeta
                    onPlayAyah={() => {}}
                    // Round 6: the reading view shows the real printed
                    // SVG page of the CURRENT mushaf; tapping a
                    // polygon plays that ayah for Hafs, and only
                    // highlights it otherwise (no Hafs audio under
                    // another key).
                    svgPage
                    mushafKey={mushafKey}
                    resolveSurahName={surahNameAr}
                    highlightKey={mushafKey === DEFAULT_SVG_MUSHAF ? playingKey : svgSelectedKey}
                    onSelectAyah={(sn, an) => {
                      if (mushafKey !== DEFAULT_SVG_MUSHAF) {
                        setSvgSelectedKey(`${sn}:${an}`);
                        return;
                      }
                      const idx = playMap.get(`${sn}:${an}`);
                      if (idx !== undefined) playIndex(idx);
                    }}
                    svgFallbackNote={labels.svgFallbackNote}
                    svgUnavailableNote={labels.svgUnavailableNote}
                    svgCredit={labels.svgCredit}
                  />
                )}
              </div>
              <div className="quran-reading-bottom" role="toolbar" aria-label={labels.readingLabel}>
                <button
                  type="button"
                  className="quran-reading-bar-btn quran-reading-play"
                  onClick={readingPlayToggle}
                  disabled={!canPlay}
                  aria-label={
                    statusKey === 'playing' || statusKey === 'loading'
                      ? labels.pause
                      : statusKey === 'paused'
                        ? labels.resume
                        : labels.playSurah
                  }
                >
                  {statusKey === 'playing' || statusKey === 'loading' ? '❚❚' : '▶'}
                </button>
                <button
                  type="button"
                  className="quran-reading-bar-btn"
                  onClick={() => setSheet('picker')}
                  aria-haspopup="dialog"
                >
                  {labels.pickerLabel}
                </button>
                <button
                  type="button"
                  className="quran-reading-bar-btn"
                  onClick={() => setSheet('mushaf')}
                  aria-haspopup="dialog"
                >
                  {labels.mushafLabel}
                </button>
                <button
                  type="button"
                  className="quran-reading-bar-btn"
                  onClick={() => setSheet('bookmarks')}
                  aria-haspopup="dialog"
                >
                  {labels.bookmarksLabel}
                  {bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}
                </button>
                <button
                  type="button"
                  className="quran-reading-bar-btn"
                  onClick={() => setSheet('settings')}
                  aria-haspopup="dialog"
                >
                  {labels.readingSettingsLabel}
                </button>
                <button
                  type="button"
                  className="quran-reading-bar-btn quran-reading-bar-exit"
                  onClick={closeReading}
                >
                  {labels.exitReadingLabel}
                </button>
              </div>
              {sheetNodes}
            </div>,
            document.body,
          )
        : null}
      {readingOpen || !sheet ? null : createPortal(sheetNodes, document.body)}
    </div>
  );
}
