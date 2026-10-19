'use client';

/**
 * LibraryAudioViewer — music-player-like card for audio items.
 *
 * The single global <audio> element is owned by AudioPlayerProvider; this
 * component is the "big" UI for it. It resolves the signed stream URL via
 * lib/library-client.ts, loads the track into the shared engine, and
 * renders cover / progress / play-pause / speed / seek. When the user
 * navigates away mid-playback, the fixed mini-player keeps playing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer } from '@/lib/audio-player-context';
import { resolveStreamUrl, LibraryClientError } from '@/lib/library-client';
import { formatDuration } from '@/lib/library';

export interface LibraryAudioViewerLabels {
  play: string;
  pause: string;
  seekBack: string;
  seekForward: string;
  speed: string;
  loadingAudio: string;
  audioFailed: string;
  retry: string;
  coverAlt: string;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

interface Props {
  itemId: string;
  title: string;
  scholarName: string;
  coverUrl: string | null;
  locale: string;
  labels: LibraryAudioViewerLabels;
}

export function LibraryAudioViewer({ itemId, title, scholarName, coverUrl, locale, labels }: Props) {
  const player = useAudioPlayer();
  const [streamState, setStreamState] = useState<'loading' | 'ready' | 'error'>('loading');
  const trackRef = useRef({ itemId, title, scholarName, coverUrl });

  useEffect(() => {
    let cancelled = false;
    setStreamState('loading');
    resolveStreamUrl(itemId)
      .then((url) => {
        if (cancelled) return;
        const t = trackRef.current;
        player.loadTrack({ id: itemId, title: t.title, coverUrl: t.coverUrl, scholarName: t.scholarName, streamUrl: url });
        setStreamState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof LibraryClientError) setStreamState('error');
        else setStreamState('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const { engine } = player;
  const playing = engine.status === 'playing';
  const progress = engine.duration > 0 ? Math.min(1, engine.currentTime / engine.duration) : 0;

  // Waveform-ish progress bar: decorative segment ticks; the fill is the
  // real playback position (never fabricated).
  const ticks = useMemo(() => Array.from({ length: 48 }, (_, i) => i), []);

  const retry = () => {
    setStreamState('loading');
    resolveStreamUrl(itemId)
      .then((url) => {
        const t = trackRef.current;
        player.loadTrack({ id: itemId, title: t.title, coverUrl: t.coverUrl, scholarName: t.scholarName, streamUrl: url });
        setStreamState('ready');
      })
      .catch(() => setStreamState('error'));
  };

  return (
    <div className="lib-audio-card" role="region" aria-label={title}>
      <div className="lib-audio-cover">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={labels.coverAlt} className="lib-audio-cover-img" />
        ) : (
          <span className="lib-audio-cover-fallback" aria-hidden="true">
            ♪
          </span>
        )}
        {streamState === 'loading' && (
          <span className="lib-audio-loading" role="status">
            {labels.loadingAudio}
          </span>
        )}
      </div>

      <div className="lib-audio-main">
        <h2 className="lib-audio-title">{title}</h2>
        {scholarName ? <p className="lib-audio-scholar">{scholarName}</p> : null}

        {streamState === 'error' ? (
          <div className="lib-error" role="alert">
            <p>{labels.audioFailed}</p>
            <button type="button" className="lib-btn" onClick={retry}>
              {labels.retry}
            </button>
          </div>
        ) : (
          <>
            <div className="lib-wave" aria-hidden="true">
              {ticks.map((i) => {
                const active = i / ticks.length <= progress;
                // Deterministic pseudo-heights (visual texture only).
                const h = 20 + ((i * 37) % 60);
                return (
                  <span
                    key={i}
                    className={`lib-wave-tick${active ? ' lib-wave-tick-active' : ''}`}
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              className="lib-seek"
              min={0}
              max={Math.max(1, Math.floor(engine.duration))}
              step={1}
              value={Math.floor(engine.currentTime)}
              onChange={(e) => player.seek(Number(e.target.value))}
              aria-label={title}
              disabled={streamState !== 'ready'}
            />
            <div className="lib-audio-times" dir="ltr" aria-hidden="true">
              <span>{formatDuration(engine.currentTime, locale)}</span>
              <span>{formatDuration(engine.duration, locale)}</span>
            </div>
            <div className="lib-audio-controls">
              <button
                type="button"
                className="lib-icon-btn"
                onClick={() => player.seekBy(-10)}
                aria-label={labels.seekBack}
                disabled={streamState !== 'ready'}
              >
                ↺<span className="lib-btn-sub">10</span>
              </button>
              <button
                type="button"
                className="lib-play-btn"
                onClick={player.toggle}
                aria-label={playing ? labels.pause : labels.play}
                disabled={streamState !== 'ready'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                className="lib-icon-btn"
                onClick={() => player.seekBy(10)}
                aria-label={labels.seekForward}
                disabled={streamState !== 'ready'}
              >
                ↻<span className="lib-btn-sub">10</span>
              </button>
              <div className="lib-rate-group" role="group" aria-label={labels.speed}>
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`lib-rate${engine.rate === r ? ' lib-rate-active' : ''}`}
                    onClick={() => player.setRate(r)}
                    aria-pressed={engine.rate === r}
                  >
                    <span dir="ltr">{r}×</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
