'use client';

/**
 * MiniPlayer — fixed bottom bar, site-wide, collapsible.
 *
 * Code-split (ssr: false) from AudioPlayerProvider: this chunk only loads
 * once an audio track is active. Pure presentation: all playback truth
 * comes from the audio-player context.
 */
import { useState } from 'react';
import type { AudioTrack, MiniPlayerLabels } from '@/lib/audio-player-context';
import type { AudioEngineState } from '@/lib/hooks/useAudioEngine';
import { formatDuration } from '@/lib/library';

function fmt(sec: number, locale: string): string {
  const s = Math.max(0, Math.floor(sec));
  const nf = new Intl.NumberFormat(locale, { useGrouping: false });
  const p2 = (n: number) => nf.format(n).padStart(2, nf.format(0));
  return `${nf.format(Math.floor(s / 60))}:${p2(s % 60)}`;
}

export interface MiniPlayerProps {
  track: AudioTrack;
  engine: AudioEngineState;
  labels: MiniPlayerLabels;
  onToggle: () => void;
  onClose: () => void;
  onSeek: (seconds: number) => void;
}

export function MiniPlayer({ track, engine, labels, onToggle, onClose, onSeek }: MiniPlayerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const locale = typeof document !== 'undefined' ? document.documentElement.lang : 'fa';
  const playing = engine.status === 'playing';
  const progress = engine.duration > 0 ? Math.min(1, engine.currentTime / engine.duration) : 0;

  return (
    <div
      className={`lib-miniplayer${collapsed ? ' lib-miniplayer-collapsed' : ''}`}
      role="region"
      aria-label={labels.nowPlaying}
      dir={document?.documentElement?.dir ?? 'rtl'}
    >
      {!collapsed && (
        <div className="lib-miniplayer-main">
          {track.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.coverUrl} alt="" className="lib-miniplayer-cover" />
          ) : (
            <span className="lib-miniplayer-cover lib-miniplayer-cover-fallback" aria-hidden="true">
              ♪
            </span>
          )}
          <div className="lib-miniplayer-meta">
            <p className="lib-miniplayer-title">{track.title}</p>
            {track.scholarName ? <p className="lib-miniplayer-scholar">{track.scholarName}</p> : null}
          </div>
          <button
            type="button"
            className="lib-icon-btn"
            onClick={onToggle}
            aria-label={playing ? labels.pause : labels.play}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            className="lib-icon-btn lib-icon-btn-quiet"
            onClick={() => setCollapsed(true)}
            aria-label={labels.collapseAria}
          >
            ▾
          </button>
          <button
            type="button"
            className="lib-icon-btn lib-icon-btn-quiet"
            onClick={onClose}
            aria-label={labels.close}
          >
            ✕
          </button>
        </div>
      )}
      {collapsed && (
        <button
          type="button"
          className="lib-miniplayer-collapsed-btn"
          onClick={() => setCollapsed(false)}
          aria-label={labels.expandAria}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
          <span className="lib-miniplayer-collapsed-title">{track.title}</span>
          <span aria-hidden="true">▴</span>
        </button>
      )}
      <div className="lib-miniplayer-progress" aria-hidden="true">
        <div className="lib-miniplayer-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      {/* Keyboard-accessible seek (visually the thin progress bar above). */}
      <input
        type="range"
        className="lib-sr-only-focusable"
        min={0}
        max={Math.max(1, Math.floor(engine.duration))}
        step={1}
        value={Math.floor(engine.currentTime)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={`${labels.nowPlaying} — ${fmt(engine.currentTime, locale)} / ${formatDuration(engine.duration, locale)}`}
      />
      {engine.status === 'error' && (
        <p className="lib-miniplayer-error" role="alert">
          {labels.audioFailed}
        </p>
      )}
    </div>
  );
}
