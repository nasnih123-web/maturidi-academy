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
  toDisplayAyahs,
  wordIndexForCard,
  type MadhhabId,
} from '@/lib/quran-madhhab';
import type { QuranSettings } from '@/lib/settings';
import { AyahCard, type AyahCardLabels } from './AyahCard';
import { AyahNotes, type AyahNotesLabels } from './AyahNotes';

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
}

type QuranTab = 'general' | 'hifz' | 'children';

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
  labels,
}: {
  locale: string;
  surah: SurahDetail;
  ayahs: Ayah[];
  reciters: Reciter[];
  settings: QuranSettings;
  /** Deep-link: highlight + scroll to this ayah number (1-based). */
  initialAyah: number | null;
  labels: QuranReaderLabels;
}) {
  const [reciterId, setReciterId] = useState<string>(settings.defaultReciter ?? reciters[0]?.id ?? '');
  const [showTranslation, setShowTranslation] = useState(settings.showTranslation);
  const [showTafsir, setShowTafsir] = useState(settings.showTafsir);
  const [madhhab, setMadhhab] = useState<MadhhabId>(() => parseMadhhabId(settings.madhhabDefault));
  const [activeTab, setActiveTab] = useState<QuranTab>('general');

  // Display mapping (madhhab): Fatiha split, sajda markers, fawasil
  // school. Playback itself keeps working on the STANDARD ayahs array —
  // the hook never sees display numbers.
  const display = useMemo(
    () => toDisplayAyahs(surah.number, ayahs, madhhab),
    [surah.number, ayahs, madhhab],
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

  // Reciter switching is a data concern: the page would refetch with a new
  // reciter param. We reload the route so the RSC refetches with ?reciter=.
  const { state, canPlay, playIndex, pause, resume, stop, rate, volume, setRate, setVolume } =
    useQuranPlayback(ayahs, {
      surahAudioUrl: surah.audioUrl,
      initialRate: settings.playerDefaultSpeed,
    });

  const [highlightAyah, setHighlightAyah] = useState<number | null>(initialAyah);

  useEffect(() => {
    if (!initialAyah) return;
    // Deep-link numbers are STANDARD; scroll to the first display card
    // with that standard number (the first pair card for Fatiha 7).
    const target = display.ayahs.find((d) => d.standardNumber === initialAyah);
    if (!target) return;
    document
      .getElementById(`ayah-${target.displayNumber}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [initialAyah, display]);

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
    const target = display.ayahs.find((d) => d.standardIndex === state.ayahIndex);
    document
      .getElementById(`ayah-${target ? target.displayNumber : ayah.number}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.ayahIndex, playing, ayahs, display]);

  // Step through DISPLAY cards (Fatiha pair = two steps, one audio file:
  // stepping 6→7 or 7→6 replays standard 1:7 — the documented Phase 1
  // simplification; a pair-as-one-step refinement is future work).
  const currentDisplayIndex = display.ayahs.findIndex((d) => d.standardIndex === state.ayahIndex);
  const stepAyah = (dir: 1 | -1): void => {
    if (currentDisplayIndex < 0) {
      if (dir === 1) playIndex(0);
      return;
    }
    const next = display.ayahs[currentDisplayIndex + dir];
    if (next) playIndex(next.standardIndex);
  };

  const progressPct = useMemo(() => {
    if (!state.duration || state.duration <= 0) return 0;
    return Math.min(100, (state.currentTime / state.duration) * 100);
  }, [state.currentTime, state.duration]);

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
                  {r.name}
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
                    alt={currentReciter.name}
                  />
                ) : (
                  <span className="quran-reciter-photo quran-reciter-photo-empty" aria-hidden="true">
                    ♪
                  </span>
                )
              ) : null}
              {currentReciter ? (
                <span className="quran-player-reciter">{currentReciter.name}</span>
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

      {surah.bismillahPre && surah.number !== 9 && (surah.number !== 1 || display.bismillahAsHeader) ? (
        <p className="quran-bismillah" lang="ar" dir="rtl">
          {labels.bismillah}
        </p>
      ) : null}

      <div className="ayah-list">
        {display.ayahs.map((d) => (
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
