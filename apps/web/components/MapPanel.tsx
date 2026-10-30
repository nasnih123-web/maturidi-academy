import Link from 'next/link';

import { GlobeAnimation } from './GlobeAnimation';

/**
 * Homepage nearby_map slot — countries + frame revision: a small
 * code-drawn animated globe (real country polygons, no graticule)
 * and the WHOLE section inside a frame that mirrors the donation
 * banner (.donation-banner: gold border, large radius, padding,
 * soft gold shadow) but with a TRANSPARENT background (no fill, no
 * backdrop blur), per the owner's order.
 *
 * The section head carries the title only; the description
 * (subtitle) sits beside the globe, and the body lives inside
 * .section-inner, the single width container every homepage section
 * body uses. The link beside it leads to the full experience on
 * /places.
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
      <div className="section-inner">
        <div className="map-places-frame">
          <div className="section-head">
            {title ? <h2>{title}</h2> : null}
          </div>
          <div className="map-places-layout">
            <GlobeAnimation />
            <div className="map-places-text">
              {subtitle ? <p className="map-places-desc">{subtitle}</p> : null}
              <Link className="btn-primary" href={`/${locale}/places`}>
                {linkLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
