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
}

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

  // Reciter switching is a data concern: the page would refetch with a new
  // reciter param. We reload the route so the RSC refetches with ?reciter=.
  const { state, canPlay, playIndex, pause, resume, stop } = useQuranPlayback(ayahs, {
    surahAudioUrl: surah.audioUrl,
  });

  const [highlightAyah, setHighlightAyah] = useState<number | null>(initialAyah);

  useEffect(() => {
    if (initialAyah) {
      const el = document.getElementById(`ayah-${initialAyah}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [initialAyah]);

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
    document
      .getElementById(`ayah-${ayah.number}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.ayahIndex, playing, ayahs]);

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
            <div className="quran-player-controls">
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
            {state.status === 'error' ? (
              <p className="quran-player-note" role="alert">
                {state.error === 'audio_missing' ? labels.audioUnavailable : labels.audioFailed}
              </p>
            ) : null}
          </>
        )}
      </div>

      {surah.bismillahPre && surah.number !== 1 && surah.number !== 9 ? (
        <p className="quran-bismillah" lang="ar" dir="rtl">
          {labels.bismillah}
        </p>
      ) : null}

      <div className="ayah-list">
        {ayahs.map((ayah, i) => (
          <AyahCard
            key={ayah.number}
            ayah={ayah}
            surahNumber={surah.number}
            highlighted={state.ayahIndex === i || highlightAyah === ayah.number}
            wordIndex={state.ayahIndex === i ? state.wordIndex : -1}
            showTranslation={showTranslation}
            showTafsir={showTafsir}
            isCurrent={state.ayahIndex === i && playing}
            labels={labels}
            ayahHref={ayahLink(ayah.number)}
            notes={
              <AyahNotes
                surah={surah.number}
                ayahNumber={ayah.number}
                locale={locale}
                labels={labels}
                onPlayAyah={() => playIndex(i)}
                canPlay={Boolean(ayah.audioUrl)}
              />
            }
          />
        ))}
      </div>

      <div className="quran-ayah-jump">
        <span>{labels.ayahLink}</span>
      </div>
    </div>
  );
}
