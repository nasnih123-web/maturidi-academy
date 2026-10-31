'use client';

/**
 * QuranReader — client shell for the surah view.
 *
 * Owns the audio player state (via useQuranPlayback), the reciter selector
 * and per-ayah play buttons. All data (surah, ayahs, reciters, settings)
 * arrives as props from the RSC page; all user-visible strings arrive via
 * `labels`. Highlight rendering is delegated to AyahCard.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuranPlayback, type PlaybackStatus } from '@/lib/hooks/useQuranPlayback';
import type { Ayah, Reciter, SurahDetail } from '@/lib/quran';
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
  groupByJuz,
  groupByPage,
  VIEW_MODE_ORDER,
  type QuranViewMode,
} from '@/lib/quran-view-modes';
import type { QuranSettings } from '@/lib/settings';
import { AyahCard, type AyahCardLabels } from './AyahCard';
import { AyahNotes, type AyahNotesLabels } from './AyahNotes';
import { QuranWaveform } from './QuranWaveform';

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
  tabsLabel: string;
  tabGeneral: string;
  tabHifz: string;
  tabChildren: string;
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
  /** View-mode switcher (order: ayah, page, surah, juz — user-locked). */
  modeLabel: string;
  modeAyah: string;
  modePage: string;
  modeSurah: string;
  modeJuz: string;
  prevPage: string;
  nextPage: string;
  prevJuz: string;
  nextJuz: string;
  /** Template with %n% (page / juz number). */
  pageCurrent: string;
  juzCurrent: string;
  pageDataMissing: string;
  juzDataMissing: string;
  /** Template with %current% and %total%. */
  ayahOf: string;
  surahTotalLabel: string;
  waveformLabel: string;
}

type QuranTab = 'general' | 'hifz' | 'children';

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

export function QuranReader({
  locale,
  surah,
  ayahs,
  reciters,
  settings,
  initialAyah,
  initialTab,
  labels,
}: {
  locale: string;
  surah: SurahDetail;
  ayahs: Ayah[];
  reciters: Reciter[];
  settings: QuranSettings;
  /** Deep-link: highlight + scroll to this ayah number (1-based). */
  initialAyah: number | null;
  /** Deep-link from the index cards (?tab=hifz|children). */
  initialTab?: QuranTab;
  labels: QuranReaderLabels;
}) {
  const [reciterId, setReciterId] = useState<string>(settings.defaultReciter ?? reciters[0]?.id ?? '');
  const [showTranslation, setShowTranslation] = useState(settings.showTranslation);
  const [showTafsir, setShowTafsir] = useState(settings.showTafsir);
  const [madhhab, setMadhhab] = useState<MadhhabId>(() => parseMadhhabId(settings.madhhabDefault));
  const [activeTab, setActiveTab] = useState<QuranTab>(initialTab ?? 'general');

  // View mode (general tab only). Initial mode is سوره — the historical
  // full-surah behavior. Mode-specific selections reset per surah;
  // madhhab/reciter selections survive surah navigation.
  const [viewMode, setViewMode] = useState<QuranViewMode>('surah');
  const [focusedDisplayIdx, setFocusedDisplayIdx] = useState(0);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [selectedJuz, setSelectedJuz] = useState<number | null>(null);
  useEffect(() => {
    setViewMode('surah');
    setFocusedDisplayIdx(0);
    setSelectedPage(null);
    setSelectedJuz(null);
  }, [surah.number]);

  // Display mapping (madhhab): Fatiha split, sajda markers, fawasil
  // school. Playback itself keeps working on the STANDARD ayahs array —
  // the hook never sees display numbers.
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

  // Reciter switching is a data concern: the page would refetch with a new
  // reciter param. We reload the route so the RSC refetches with ?reciter=.
  const {
    state,
    canPlay,
    playIndex,
    pause,
    resume,
    stop,
    rate,
    volume,
    setRate,
    setVolume,
    surahDuration,
    getAudioElement,
  } = useQuranPlayback(ayahs, {
    surahAudioUrl: surah.audioUrl,
    initialRate: settings.playerDefaultSpeed,
  });

  const [highlightAyah, setHighlightAyah] = useState<number | null>(initialAyah);

  useEffect(() => {
    if (!initialAyah) return;
    // Deep-link numbers are STANDARD; scroll to the first display card
    // with that standard number (the first pair card for Fatiha 7).
    const target = visible.find((d) => d.standardNumber === initialAyah);
    if (!target) return;
    document
      .getElementById(`ayah-${target.displayNumber}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [initialAyah, visible]);

  // Focused ayah follows the deep-link on mount / surah change.
  useEffect(() => {
    if (!initialAyah) return;
    const idx = visible.findIndex((d) => d.standardNumber === initialAyah);
    if (idx >= 0) setFocusedDisplayIdx(idx);
  }, [initialAyah, visible]);

  const statusKey = STATUS_KEY[state.status];
  const playing = statusKey === 'playing' || statusKey === 'loading';

  // Auto-follow playback: when the playing ayah changes — auto-advance to
  // the next ayah, or time-driven advance in whole-surah mode — keep its
  // card in view. 'nearest' scrolls only when the card is out of view, so
  // reading ahead while paused is never yanked back (paused => playing
  // is false, and this effect exits early).
  useEffect(() => {
    if (state.ayahIndex < 0 || !playing) return;
    const ayah = ayahs[state.ayahIndex];
    if (!ayah) return;
    const target = visible.find((d) => d.standardIndex === state.ayahIndex);
    document
      .getElementById(`ayah-${target ? target.displayNumber : ayah.number}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.ayahIndex, playing, ayahs, visible]);

  // Step through DISPLAY cards (Fatiha pair = two steps, one audio file:
  // stepping 6→7 or 7→6 replays standard 1:7 — the documented Phase 1
  // simplification; a pair-as-one-step refinement is future work).
  const currentDisplayIndex = visible.findIndex((d) => d.standardIndex === state.ayahIndex);
  const stepAyah = (dir: 1 | -1): void => {
    if (currentDisplayIndex < 0) {
      if (dir === 1) playIndex(0);
      return;
    }
    const next = visible[currentDisplayIndex + dir];
    if (next) playIndex(next.standardIndex);
  };

  const progressPct = useMemo(() => {
    if (!state.duration || state.duration <= 0) return 0;
    return Math.min(100, (state.currentTime / state.duration) * 100);
  }, [state.currentTime, state.duration]);

  // ---- View modes (general tab) ----
  const pageGroups = useMemo(() => groupByPage(visible), [visible]);
  const juzGroups = useMemo(() => groupByJuz(visible), [visible]);
  const activePage =
    pageGroups.some((g) => g.key === selectedPage) ? selectedPage : (pageGroups[0]?.key ?? null);
  const activeJuz =
    juzGroups.some((g) => g.key === selectedJuz) ? selectedJuz : (juzGroups[0]?.key ?? null);
  const clampedFocused =
    visible.length === 0 ? 0 : Math.min(Math.max(0, focusedDisplayIdx), visible.length - 1);

  // While playing, the focused view follows playback: the ayah view
  // tracks the playing ayah, the page/juz views track its page/juz.
  // Paused navigation is never yanked (playing is false then).
  useEffect(() => {
    if (!playing || state.ayahIndex < 0) return;
    const card = visible.find((d) => d.standardIndex === state.ayahIndex);
    if (!card) return;
    if (viewMode === 'ayah') {
      const idx = visible.findIndex((d) => d.standardIndex === state.ayahIndex);
      if (idx >= 0) setFocusedDisplayIdx(idx);
    } else if (viewMode === 'page') {
      if (card.ayah.page !== null && pageGroups.some((g) => g.key === card.ayah.page)) {
        setSelectedPage(card.ayah.page);
      }
    } else if (viewMode === 'juz') {
      if (card.ayah.juz !== null && juzGroups.some((g) => g.key === card.ayah.juz)) {
        setSelectedJuz(card.ayah.juz);
      }
    }
  }, [state.ayahIndex, playing, viewMode, visible, pageGroups, juzGroups]);

  const modeAyahs =
    viewMode === 'ayah'
      ? visible.length > 0
        ? [visible[clampedFocused]]
        : []
      : viewMode === 'page'
        ? (pageGroups.find((g) => g.key === activePage)?.ayahs ?? [])
        : viewMode === 'juz'
          ? (juzGroups.find((g) => g.key === activeJuz)?.ayahs ?? [])
          : visible;

  const MODE_LABELS: Record<(typeof VIEW_MODE_ORDER)[number], string> = {
    ayah: labels.modeAyah,
    page: labels.modePage,
    surah: labels.modeSurah,
    juz: labels.modeJuz,
  };
  const stepGroup = (groups: { key: number }[], active: number | null, dir: 1 | -1): number | null => {
    if (groups.length === 0 || active === null) return null;
    const idx = groups.findIndex((g) => g.key === active);
    if (idx < 0) return groups[0].key;
    const next = groups[idx + dir];
    return next ? next.key : active;
  };

  const ayahLink = (n: number): string =>
    `/${locale}/quran/${surah.number}?ayah=${n}${reciterId ? `&reciter=${encodeURIComponent(reciterId)}` : ''}`;

  return (
    <div className="quran-reader">
      <header className="quran-surah-head">
        <div>
          <p className="quran-surah-kicker">
            {labels.surahOf} {surah.number} · {surah.ayahCount} · {surah.revelationType}
          </p>
          <h1 className="quran-surah-title" lang="ar" dir="rtl">
            {surah.nameAr}
          </h1>
          <p className="quran-surah-sub">
            {surah.name} · {surah.englishName}
          </p>
          <p className="quran-fawasil-note">
            {fawasilLine}
            {fawasilFallbackLine ? ` · ${fawasilFallbackLine}` : ''}
          </p>
        </div>
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
      </header>

      <div className="quran-tabs" role="tablist" aria-label={labels.tabsLabel}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'general'}
          className={activeTab === 'general' ? 'quran-tab quran-tab-active' : 'quran-tab'}
          onClick={() => setActiveTab('general')}
        >
          {labels.tabGeneral}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'hifz'}
          className={activeTab === 'hifz' ? 'quran-tab quran-tab-active' : 'quran-tab'}
          onClick={() => setActiveTab('hifz')}
        >
          {labels.tabHifz}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'children'}
          className={activeTab === 'children' ? 'quran-tab quran-tab-active' : 'quran-tab'}
          onClick={() => setActiveTab('children')}
        >
          {labels.tabChildren}
        </button>
      </div>

      {activeTab === 'general' ? (
        <>
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
      </div>

      {/* Audio player bar */}
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
                {surah.nameAr}
              </span>
            </div>
            <div className="quran-player-controls">
              <button
                type="button"
                className="quran-step-btn"
                onClick={() => stepAyah(-1)}
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
                  onClick={() => playIndex(highlightAyah ? highlightAyah - 1 : 0)}
                  aria-label={labels.playSurah}
                >
                  ▶
                </button>
              )}
              <button
                type="button"
                className="quran-step-btn"
                onClick={() => stepAyah(1)}
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
              >
                <div className="quran-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <div className="quran-player-times" dir="ltr">
              <span>
                {formatTime(state.currentTime)} / {state.duration > 0 ? formatTime(state.duration) : '–'}
              </span>
              {surahDuration !== null ? (
                <span>
                  {labels.surahTotalLabel}: {formatTime(surahDuration)}
                </span>
              ) : null}
            </div>
            <QuranWaveform
              getAudioElement={getAudioElement}
              playing={playing}
              progressPct={progressPct}
              label={labels.waveformLabel}
            />
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

      {showBismillahHeader ? (
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
            onClick={() => setViewMode(mode)}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>

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

      {viewMode === 'page' ? (
        pageGroups.length === 0 ? (
          <p className="quran-mode-note">{labels.pageDataMissing}</p>
        ) : (
          <div className="quran-mode-nav">
            <button
              type="button"
              onClick={() => {
                const next = stepGroup(pageGroups, activePage, -1);
                if (next !== null) setSelectedPage(next);
              }}
              disabled={activePage === pageGroups[0]?.key}
              aria-label={labels.prevPage}
            >
              {labels.prevPage}
            </button>
            <span>
              {activePage !== null ? labels.pageCurrent.replace('%n%', String(activePage)) : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = stepGroup(pageGroups, activePage, 1);
                if (next !== null) setSelectedPage(next);
              }}
              disabled={activePage === pageGroups[pageGroups.length - 1]?.key}
              aria-label={labels.nextPage}
            >
              {labels.nextPage}
            </button>
          </div>
        )
      ) : null}

      {viewMode === 'juz' ? (
        juzGroups.length === 0 ? (
          <p className="quran-mode-note">{labels.juzDataMissing}</p>
        ) : (
          <div className="quran-mode-nav">
            <button
              type="button"
              onClick={() => {
                const next = stepGroup(juzGroups, activeJuz, -1);
                if (next !== null) setSelectedJuz(next);
              }}
              disabled={activeJuz === juzGroups[0]?.key}
              aria-label={labels.prevJuz}
            >
              {labels.prevJuz}
            </button>
            <span>
              {activeJuz !== null ? labels.juzCurrent.replace('%n%', String(activeJuz)) : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = stepGroup(juzGroups, activeJuz, 1);
                if (next !== null) setSelectedJuz(next);
              }}
              disabled={activeJuz === juzGroups[juzGroups.length - 1]?.key}
              aria-label={labels.nextJuz}
            >
              {labels.nextJuz}
            </button>
          </div>
        )
      ) : null}

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
            ayahHref={ayahLink(d.standardNumber)}
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

      <div className="quran-ayah-jump">
        <span>{labels.ayahLink}</span>
      </div>
        </>
      ) : (
        <div className="quran-placeholder" role="tabpanel">
          <p>{activeTab === 'hifz' ? labels.hifzPlaceholder : labels.childrenPlaceholder}</p>
        </div>
      )}
    </div>
  );
}
