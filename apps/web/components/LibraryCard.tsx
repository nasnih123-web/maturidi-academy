/**
 * LibraryCard — presentational card for a library item.
 *
 * Receives already-localized strings (title/scholar/duration/kind label)
 * via props; renders only. No data fetching, no business logic.
 */
import Link from 'next/link';
import type { LibraryKind } from '@/lib/library';

export interface LibraryCardLabels {
  openItem: string;
  kindLabel: string;
}

export interface LibraryCardItem {
  id: string;
  kind: LibraryKind;
  title: string;
  scholarName: string;
  coverUrl: string | null;
  durationLabel: string;
  href: string;
}

export function LibraryCard({ item, labels }: { item: LibraryCardItem; labels: LibraryCardLabels }) {
  return (
    <article className="lib-card">
      <Link href={item.href} className="lib-card-link" aria-label={`${labels.openItem}: ${item.title}`}>
        <div className="lib-card-cover">
          {item.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.coverUrl} alt="" loading="lazy" className="lib-card-img" />
          ) : (
            <span className="lib-card-cover-fallback" aria-hidden="true">
              {kindGlyph(item.kind)}
            </span>
          )}
          <span className="lib-card-kind">{labels.kindLabel}</span>
          {item.durationLabel ? (
            <span className="lib-card-duration" dir="ltr">
              {item.durationLabel}
            </span>
          ) : null}
        </div>
        <div className="lib-card-body">
          <h3 className="lib-card-title">{item.title}</h3>
          {item.scholarName ? <p className="lib-card-scholar">{item.scholarName}</p> : null}
        </div>
      </Link>
    </article>
  );
}

function kindGlyph(kind: LibraryKind): string {
  switch (kind) {
    case 'video':
      return '▶';
    case 'video_360':
      return '◉';
    case 'pdf':
      return '▤';
    case 'audio':
      return '♪';
    case 'mindmap':
      return '✦';
    default:
      return '◈';
  }
}
