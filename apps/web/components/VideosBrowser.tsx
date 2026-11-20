'use client';

/**
 * VideosBrowser — the /videos page body: filter chips + «همهٔ ویدیوها»
 * grid FIRST + playlist shelves after (approved design).
 *
 * Chips are a client-side view over the server-fetched data:
 * - همه: grid in API order, then shelves
 * - تازه‌ترین: grid re-sorted by created_at desc, then shelves
 * - لیست‌های پخش: shelves only
 * No «پربازدیدترین» chip — the API has no view counts; nothing is faked.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { VideoCard, type VideoCardItem } from './VideoCard';

export interface VideosBrowserItem extends VideoCardItem {
  createdAt: string;
}

export interface PlaylistShelf {
  id: string;
  title: string;
  scholarName: string;
  coverUrl: string | null;
  countLabel: string;
  totalLabel: string;
  items: VideoCardItem[];
}

export interface VideosBrowserLabels {
  chips: { all: string; newest: string; playlists: string };
  allVideos: string;
  newestFirst: string;
  playlistPrefix: string;
  viewPlaylist: string;
  noVideos: string;
  noVideosHint: string;
}

type Chip = 'all' | 'newest' | 'playlists';

export function VideosBrowser({
  videos,
  playlists,
  labels,
}: {
  videos: VideosBrowserItem[];
  playlists: PlaylistShelf[];
  labels: VideosBrowserLabels;
}) {
  const [chip, setChip] = useState<Chip>('all');

  const gridItems = useMemo(() => {
    if (chip !== 'newest') return videos;
    return [...videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [videos, chip]);

  const showGrid = chip !== 'playlists';
  const empty = videos.length === 0 && playlists.length === 0;

  return (
    <div className="vid-browser">
      <div className="vid-chips" role="tablist" aria-label={labels.allVideos}>
        {(
          [
            ['all', labels.chips.all],
            ['newest', labels.chips.newest],
            ['playlists', labels.chips.playlists],
          ] as [Chip, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={chip === key}
            className={chip === key ? 'vid-chip on' : 'vid-chip'}
            onClick={() => setChip(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {empty ? (
        <div className="vid-empty">
          <p className="vid-empty-title">{labels.noVideos}</p>
          <p>{labels.noVideosHint}</p>
        </div>
      ) : null}

      {showGrid && gridItems.length > 0 ? (
        <section className="vid-block">
          <div className="vid-block-head">
            <h2>{labels.allVideos}</h2>
            <span>{labels.newestFirst}</span>
          </div>
          <div className="vid-grid">
            {gridItems.map((item) => (
              <VideoCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {playlists.map((shelf) => {
        const leadHref = shelf.items[0]?.href;
        const lead = (
          <>
            <div className="vid-thumb">
              {shelf.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shelf.coverUrl} alt="" loading="lazy" className="vid-thumb-img" />
              ) : (
                <span className="vid-thumb-fallback" aria-hidden="true">
                  {shelf.title}
                </span>
              )}
              <span className="vid-thumb-play" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#e5c07b">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </span>
              <span className="vid-thumb-plcount">{shelf.countLabel}</span>
            </div>
            <h3 className="vid-card-title">{shelf.title}</h3>
            <p className="vid-card-meta">
              {shelf.scholarName ? `${shelf.scholarName} · ` : ''}
              {shelf.totalLabel}
            </p>
          </>
        );
        return (
          <section key={shelf.id} className="vid-block">
            <div className="vid-block-head">
              <h2>
                {labels.playlistPrefix}: {shelf.title}
              </h2>
              <span>{shelf.countLabel}</span>
              {leadHref ? (
                <Link className="vid-block-more" href={leadHref}>
                  {labels.viewPlaylist} ←
                </Link>
              ) : null}
            </div>
            <div className="vid-shelf-row">
              <article className="vid-card vid-plcard">
                {leadHref ? (
                  <Link href={leadHref} className="vid-card-link">
                    {lead}
                  </Link>
                ) : (
                  lead
                )}
              </article>
              {shelf.items.map((item) => (
                <VideoCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
