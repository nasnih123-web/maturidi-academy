/**
 * VideoCard — presentational card for one video (videos section).
 *
 * Receives already-localized strings via props; renders only. The cover
 * falls back to a brand gradient with the kind label when the API gave
 * no signed cover URL — never a placeholder image.
 */
import Link from 'next/link';

export interface VideoCardItem {
  id: string;
  title: string;
  scholarName: string;
  /** «تاریخ انتشار» قالب‌بندی‌شده (شمسی در fa) — خط متای کارت. */
  dateLabel: string;
  coverUrl: string | null;
  durationLabel: string;
  kindLabel: string;
  /** «لیست پخش» tag — shown when the video belongs to a published playlist. */
  playlistLabel: string | null;
  /** «یوتیوب» badge — shown for external (YouTube) videos. */
  externalLabel: string | null;
  href: string;
}

export function VideoCard({ item }: { item: VideoCardItem }) {
  return (
    <article className="vid-card">
      <Link href={item.href} className="vid-card-link">
        <div className="vid-thumb">
          {item.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.coverUrl} alt="" loading="lazy" className="vid-thumb-img" />
          ) : (
            <span className="vid-thumb-fallback" aria-hidden="true">
              {item.kindLabel}
            </span>
          )}
          <span className="vid-thumb-play" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#e5c07b">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          {item.playlistLabel ? (
            <span className="vid-thumb-pltag">{item.playlistLabel}</span>
          ) : null}
          {item.externalLabel ? (
            <span className="vid-thumb-ext">{item.externalLabel}</span>
          ) : null}
          {item.durationLabel ? (
            <span className="vid-thumb-dur" dir="ltr">
              {item.durationLabel}
            </span>
          ) : null}
        </div>
        <h3 className="vid-card-title">{item.title}</h3>
        {item.scholarName || item.dateLabel ? (
          <p className="vid-card-meta">
            {[item.scholarName, item.dateLabel].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </Link>
    </article>
  );
}
