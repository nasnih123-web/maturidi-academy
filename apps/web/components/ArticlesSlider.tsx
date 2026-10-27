/**
 * Homepage "recent articles" slider — server component.
 *
 * Items come ONLY from the public published-articles endpoint (passed in
 * by the homepage page); there is no seed.py section key for articles.
 * Renders nothing when there is nothing to show — this is not a
 * configured CMS section, so an empty list means no slider at all.
 */
import Link from 'next/link';
import type { ArticleItem } from '@/lib/articles';

export function ArticlesSlider({
  locale,
  items,
  title,
  showAllLabel,
}: {
  locale: string;
  items: ArticleItem[];
  title: string;
  showAllLabel: string;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section className="ftw-page" aria-label={title}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <Link href={`/${locale}/articles`}>{showAllLabel}</Link>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          overflowX: 'auto',
          padding: '0.5rem 0 1rem',
        }}
      >
        {items.map((item) => (
          <article
            key={item.slug}
            className="ftw-card"
            style={{ flex: '0 0 clamp(15rem, 22vw, 19rem)' }}
          >
            <Link href={`/${locale}/articles/${encodeURIComponent(item.slug)}`} className="ftw-card-link">
              {item.featuredImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.featuredImageUrl}
                  alt=""
                  className="ftw-card-img"
                  loading="lazy"
                />
              ) : (
                <div className="ftw-card-img ftw-card-img-empty" aria-hidden />
              )}
              <h3>{item.title}</h3>
            </Link>
            {item.category ? <p className="ftw-card-cat">{item.category.title}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
