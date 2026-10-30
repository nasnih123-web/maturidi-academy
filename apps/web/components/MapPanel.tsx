import Link from 'next/link';

import { GlobeAnimation } from './GlobeAnimation';

/**
 * Homepage nearby_map slot — countries + frame revision: a small
 * code-drawn animated globe (real country polygons, no graticule)
 * and the body inside a frame that mirrors the donation banner
 * (.donation-banner: gold border, large radius, padding, soft gold
 * shadow) but with a TRANSPARENT background (no fill, no backdrop
 * blur), per the owner's order.
 *
 * Like every other homepage section, the section head (title) sits
 * OUTSIDE the content box: section > .section-inner > section-head +
 * .map-places-frame. The frame holds ONLY the globe, the description
 * (subtitle) beside it, and the link to the full experience on
 * /places. The body lives inside .section-inner, the single width
 * container every homepage section body uses.
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
        <div className="section-head">
          {title ? <h2>{title}</h2> : null}
        </div>
        <div className="map-places-frame">
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
