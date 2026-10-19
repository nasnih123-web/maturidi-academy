'use client';

/**
 * LibraryVideoViewer — HTML5 player with a clickable chapter timeline.
 *
 * The video src is the signed stream URL resolved via lib/library-client.ts
 * (the stream endpoint 302s; fetch follows it). Chapter markers seek the
 * element; everything is real <button>s for keyboard access.
 */
import { useEffect, useRef, useState } from 'react';
import { resolveStreamUrl, LibraryClientError } from '@/lib/library-client';
import { formatDuration } from '@/lib/library';

export interface VideoViewerChapter {
  title: string;
  startSeconds: number | null;
}

export interface LibraryVideoViewerLabels {
  loadingVideo: string;
  videoFailed: string;
  retry: string;
  chaptersTitle: string;
  captionsNote: string;
  seekToChapter: string;
}

interface Props {
  itemId: string;
  title: string;
  posterUrl: string | null;
  chapters: VideoViewerChapter[];
  captionsUrl: string | null;
  locale: string;
  labels: LibraryVideoViewerLabels;
}

export function LibraryVideoViewer({
  itemId,
  title,
  posterUrl,
  chapters,
  captionsUrl,
  locale,
  labels,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    resolveStreamUrl(itemId)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch((err) => {
        if (!cancelled && err instanceof LibraryClientError) setFailed(true);
        else if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onDur);
    el.addEventListener('durationchange', onDur);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onDur);
      el.removeEventListener('durationchange', onDur);
    };
  }, [src]);

  const seekTo = (seconds: number | null) => {
    const el = videoRef.current;
    if (el && seconds != null && Number.isFinite(seconds)) {
      el.currentTime = Math.max(0, seconds);
      el.focus();
    }
  };

  const timedChapters = chapters.filter((c) => c.startSeconds != null);

  return (
    <div className="lib-video">
      <div className="lib-video-frame">
        {failed ? (
          <div className="lib-error" role="alert">
            <p>{labels.videoFailed}</p>
            <button
              type="button"
              className="lib-btn"
              onClick={() => {
                setFailed(false);
                setSrc(null);
                resolveStreamUrl(itemId)
                  .then(setSrc)
                  .catch(() => setFailed(true));
              }}
            >
              {labels.retry}
            </button>
          </div>
        ) : src ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            className="lib-video-el"
            src={src}
            poster={posterUrl ?? undefined}
            controls
            preload="metadata"
            playsInline
            aria-label={title}
          >
            {captionsUrl ? <track kind="captions" src={captionsUrl} default /> : null}
          </video>
        ) : (
          <p className="lib-status" role="status">
            {labels.loadingVideo}
          </p>
        )}
      </div>

      {timedChapters.length > 0 && duration > 0 && (
        <div className="lib-chapters">
          <h3 className="lib-chapters-title">{labels.chaptersTitle}</h3>
          <div className="lib-chapters-timeline" role="group" aria-label={labels.chaptersTitle}>
            {timedChapters.map((c, i) => {
              const left = Math.min(100, Math.max(0, ((c.startSeconds ?? 0) / duration) * 100));
              const active =
                currentTime >= (c.startSeconds ?? 0) &&
                (i === timedChapters.length - 1 || currentTime < (timedChapters[i + 1].startSeconds ?? Infinity));
              return (
                <button
                  key={i}
                  type="button"
                  className={`lib-chapter-marker${active ? ' lib-chapter-marker-active' : ''}`}
                  style={{ insetInlineStart: `${left}%` }}
                  onClick={() => seekTo(c.startSeconds)}
                  aria-label={`${labels.seekToChapter}: ${c.title} (${formatDuration(c.startSeconds, locale)})`}
                  title={`${c.title} — ${formatDuration(c.startSeconds, locale)}`}
                />
              );
            })}
            <div className="lib-chapters-track" aria-hidden="true" />
          </div>
          <ol className="lib-chapters-list">
            {timedChapters.map((c, i) => (
              <li key={i}>
                <button type="button" className="lib-chapter-item" onClick={() => seekTo(c.startSeconds)}>
                  <span className="lib-chapter-time" dir="ltr">
                    {formatDuration(c.startSeconds, locale)}
                  </span>
                  <span>{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!captionsUrl && <p className="lib-video-note">{labels.captionsNote}</p>}
    </div>
  );
}
