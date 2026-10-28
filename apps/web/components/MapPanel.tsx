import Link from 'next/link';

/**
 * Homepage nearby_map slot — globe phase.
 *
 * A preview card + link to the full 3D globe at /places. The globe is
 * deliberately NOT embedded here: three.js is heavy, and the previous
 * live-map slot fetched up to 500 places on every homepage load. The
 * full experience (markers, legend, search, qibla) lives on /places.
 */
export function MapPanel({
  sectionId,
  locale,
  title,
  subtitle,
  linkLabel,
}: {
  sectionId: string;
  locale: string;
  title?: string | null;
  subtitle?: string | null;
  linkLabel: string;
}) {
  return (
    <section id={sectionId} className="home-section map-preview">
      <div className="section-head">
        {title ? <h2>{title}</h2> : null}
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
      </div>
      <div className="map-preview-card">
        <span className="map-preview-globe" aria-hidden>
          🌍
        </span>
        <Link className="btn-primary" href={`/${locale}/places`}>
          {linkLabel}
        </Link>
      </div>
    </section>
  );
}
