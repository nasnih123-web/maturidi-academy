/**
 * VideoWatchSidebar — watch-page sidebar: the current playlist panel
 * (ordered items, current highlighted) followed by «ویدیوهای مشابه».
 * Presentational server component — all strings arrive via props.
 */
import Link from 'next/link';

export interface SidebarVideoRow {
  id: string;
  title: string;
  scholarName: string;
  coverUrl: string | null;
  durationLabel: string;
  href: string;
  current: boolean;
}

export interface VideoWatchSidebarLabels {
  playlistTitle: string;
  relatedTitle: string;
  nowPlaying: string;
}

function Row({ row, nowPlaying }: { row: SidebarVideoRow; nowPlaying: string }) {
  const body = (
    <>
      <span className="vid-side-thumb">
        {row.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.coverUrl} alt="" loading="lazy" className="vid-thumb-img" />
        ) : (
          <span className="vid-side-thumb-fallback" aria-hidden="true">
            ▶
          </span>
        )}
        {row.durationLabel ? (
          <span className="vid-thumb-dur" dir="ltr">
            {row.durationLabel}
          </span>
        ) : null}
      </span>
      <span className="vid-side-info">
        <span className="vid-side-title">{row.title}</span>
        {row.scholarName ? <span className="vid-side-meta">{row.scholarName}</span> : null}
        {row.current ? <span className="vid-side-now">{nowPlaying}</span> : null}
      </span>
    </>
  );
  if (row.current) {
    return (
      <li className="vid-side-row current" aria-current="true">
        {body}
      </li>
    );
  }
  return (
    <li className="vid-side-row">
      <Link href={row.href} className="vid-side-link">
        {body}
      </Link>
    </li>
  );
}

export function VideoWatchSidebar({
  playlistTitle,
  positionLabel,
  playlistItems,
  related,
  labels,
}: {
  playlistTitle: string | null;
  positionLabel: string | null;
  playlistItems: SidebarVideoRow[];
  related: SidebarVideoRow[];
  labels: VideoWatchSidebarLabels;
}) {
  return (
    <div className="vid-side">
      {playlistTitle && playlistItems.length > 0 ? (
        <section className="vid-side-panel" aria-label={labels.playlistTitle}>
          <header className="vid-side-head">
            <h2>
              {labels.playlistTitle}: {playlistTitle}
            </h2>
            {positionLabel ? <p>{positionLabel}</p> : null}
          </header>
          <ol className="vid-side-list">
            {playlistItems.map((row) => (
              <Row key={row.id} row={row} nowPlaying={labels.nowPlaying} />
            ))}
          </ol>
        </section>
      ) : null}
      {related.length > 0 ? (
        <section className="vid-side-panel" aria-label={labels.relatedTitle}>
          <header className="vid-side-head">
            <h2>{labels.relatedTitle}</h2>
          </header>
          <ol className="vid-side-list">
            {related.map((row) => (
              <Row key={row.id} row={row} nowPlaying={labels.nowPlaying} />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
