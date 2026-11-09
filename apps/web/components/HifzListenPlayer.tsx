'use client';

/**
 * HifzListenPlayer — the listen-mode player surface for the hifz
 * study page (Phase 5).
 *
 * It reuses the reader's glass mini-player visual language
 * (`.quran-player-mini`: frosted-glass pill, reciter photo, thin
 * progress line — PR #99/#101) and does NOT redesign it. It is the
 * transport surface only: prev / play-pause / next, speed badge
 * (cycles the six Tarteel speeds), repeat badge (cycles off → ayah →
 * range → surah, with the remaining count when finite), position,
 * and the honest loading / buffering / error states (with retry).
 * Configuration lives above it (reciter picker, repeat-mode select,
 * stop, resume chip) — no control is duplicated.
 *
 * The listen-mode page itself was NOT observed in the videos (spec
 * §14.11); only its settings were. This player is the academy's own
 * surface, not a claim about Tarteel's listen page.
 *
 * Long-press on the play button switches back to practice mode
 * (the mirror of the green-button long-press in practice mode, spec
 * §6 — the gesture itself was only seen as banner text, never
 * performed in the videos). The mode-toggle buttons stay the
 * keyboard / discoverable path.
 */
import { useRef } from 'react';
import { formatArabicIndicDecimal, formatArabicIndicDuration, toArabicIndic } from '@/lib/quran-print-lines';
import {
  HIFZ_LISTEN_LONG_PRESS_MS,
  type ListenErrorKind,
  type ListenRepeatMode,
  type ListenStatus,
} from '@/lib/hifz-player';

export interface HifzListenPlayerLabels {
  play: string;
  pause: string;
  resume: string;
  prevAyah: string;
  nextAyah: string;
  repeat: string;
  repeatOff: string;
  repeatAyah: string;
  repeatRange: string;
  repeatSurah: string;
  speed: string;
  progress: string;
  retry: string;
  loading: string;
  buffering: string;
  offline: string;
  audioFailed: string;
  longPressSwitch: string;
}

export interface HifzListenPlayerProps {
  /** Kept for future locale-aware strings; the digits on this
      surface are deliberately locale-independent: Phase 6 unifies
      them on Eastern Arabic digits (٠-٩), the Tarteel frames'
      convention (spec §2) and the study page's own convention. */
  locale: string;
  reciterName: string;
  reciterPhotoUrl: string | null;
  /** Surah name (title line). */
  title: string;
  currentAyah: number;
  ayahCount: number;
  progressMs: number;
  durationMs: number;
  speed: number;
  repeatMode: ListenRepeatMode;
  repeatRemaining: number | null;
  status: ListenStatus;
  errorKind: ListenErrorKind | null;
  labels: HifzListenPlayerLabels;
  onPlayPause: () => void;
  onPrevAyah: () => void;
  onNextAyah: () => void;
  onSeek: (ms: number) => void;
  onSpeedCycle: () => void;
  onRepeatCycle: () => void;
  onRetry: () => void;
  onLongPressSwitch: () => void;
}

/**
 * Phase 6 — one digit convention for the hifz surfaces: Eastern
 * Arabic digits (٠-٩) regardless of UI locale, as in the Tarteel
 * frames (spec §2). Before this, the status used the locale's
 * digits (Persian ۰-۹ for fa) while the title used Latin digits —
 * three scripts in one pill.
 */
function fmtMs(ms: number): string {
  // Phase 7: shared duration helper (was a local duplicate of the
  // study page's session-timer format).
  return formatArabicIndicDuration(Math.floor(ms / 1000));
}

export function HifzListenPlayer(props: HifzListenPlayerProps) {
  const {
    locale,
    reciterName,
    reciterPhotoUrl,
    title,
    currentAyah,
    ayahCount,
    progressMs,
    durationMs,
    speed,
    repeatMode,
    repeatRemaining,
    status,
    errorKind,
    labels,
    onPlayPause,
    onPrevAyah,
    onNextAyah,
    onSeek,
    onSpeedCycle,
    onRepeatCycle,
    onRetry,
    onLongPressSwitch,
  } = props;
  const dir =
    typeof document !== 'undefined' ? document.documentElement.dir || 'rtl' : 'rtl';
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const playing = status === 'playing' || status === 'buffering';
  const progress = durationMs > 0 ? Math.min(1, progressMs / durationMs) : 0;

  const statusText =
    status === 'error'
      ? errorKind === 'offline'
        ? labels.offline
        : labels.audioFailed
      : status === 'loading'
        ? labels.loading
        : status === 'buffering'
          ? labels.buffering
          : durationMs > 0
            ? `${fmtMs(progressMs)} / ${fmtMs(durationMs)}`
            : labels.resume;

  const repeatLabel =
    repeatMode === 'ayah'
      ? labels.repeatAyah
      : repeatMode === 'range'
        ? labels.repeatRange
        : repeatMode === 'surah'
          ? labels.repeatSurah
          : labels.repeatOff;
  const repeatBadge =
    repeatMode === 'off'
      ? '🔁'
      : `${repeatLabel}${repeatRemaining !== null ? ` ×${toArabicIndic(repeatRemaining)}` : ''}`;

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const onPlayPointerDown = () => {
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPressSwitch();
    }, HIFZ_LISTEN_LONG_PRESS_MS);
  };

  const onPlayClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (status === 'error') {
      onRetry();
      return;
    }
    onPlayPause();
  };

  return (
    <div
      className="quran-player-mini hifz-listen-mini"
      role="region"
      aria-label={labels.progress}
      dir={dir}
      data-status={status}
    >
      <div className="quran-player-mini-progress" aria-hidden="true">
        <div
          className="quran-player-mini-progress-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {reciterPhotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={reciterPhotoUrl} alt={reciterName} className="quran-player-mini-photo" />
      ) : (
        <span className="quran-player-mini-photo quran-reciter-photo-empty" aria-hidden="true">
          ♪
        </span>
      )}
      <span className="quran-player-mini-text">
        <span className="quran-player-mini-reciter">{reciterName}</span>
        <span className="quran-player-mini-title" lang="ar" dir="rtl">
          {title}
          {ayahCount > 0 ? ` — ${toArabicIndic(currentAyah)}/${toArabicIndic(ayahCount)}` : ''}
        </span>
        <span className="quran-player-mini-status" role="status">
          {statusText}
        </span>
      </span>
      <span className="quran-player-mini-controls">
        <button
          type="button"
          className="quran-mini-btn"
          onClick={onPrevAyah}
          aria-label={labels.prevAyah}
          disabled={currentAyah <= 1}
        >
          ⏮
        </button>
        <button
          type="button"
          className="quran-mini-btn quran-mini-play"
          onClick={onPlayClick}
          onPointerDown={onPlayPointerDown}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
          onContextMenu={(e) => e.preventDefault()}
          title={labels.longPressSwitch}
          aria-label={
            status === 'error'
              ? labels.retry
              : playing
                ? labels.pause
                : status === 'paused'
                  ? labels.resume
                  : labels.play
          }
          disabled={status === 'loading'}
        >
          {status === 'error' ? '↻' : playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="quran-mini-btn"
          onClick={onNextAyah}
          aria-label={labels.nextAyah}
          disabled={ayahCount > 0 && currentAyah >= ayahCount}
        >
          ⏭
        </button>
        <button
          type="button"
          className="quran-mini-btn hifz-mini-badge"
          onClick={onSpeedCycle}
          aria-label={`${labels.speed}: ${formatArabicIndicDecimal(speed, 2)}×`}
          title={labels.speed}
        >
          {formatArabicIndicDecimal(speed, 2)}×
        </button>
        <button
          type="button"
          className="quran-mini-btn hifz-mini-badge"
          onClick={onRepeatCycle}
          aria-label={`${labels.repeat}: ${repeatLabel}`}
          aria-pressed={repeatMode !== 'off'}
          title={repeatLabel}
        >
          {repeatBadge}
        </button>
      </span>
      {/* Keyboard-accessible seek (visually the thin progress line above). */}
      <input
        type="range"
        className="lib-sr-only-focusable"
        min={0}
        max={Math.max(1, Math.floor(durationMs))}
        step={250}
        value={Math.min(Math.floor(progressMs), Math.max(1, Math.floor(durationMs)))}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={`${labels.progress} — ${statusText}`}
      />
    </div>
  );
}
