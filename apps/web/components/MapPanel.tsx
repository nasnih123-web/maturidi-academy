import Link from 'next/link';

import { MiniGlobe } from './MiniGlobeLazy';
import type { PlaceView } from '@/lib/places-view';

/**
 * Homepage nearby_map slot — batch 2: a small live globe instead of
 * the old preview card + link.
 *
 * Layout: the section head carries the title only; the description
 * (subtitle) sits beside the globe, not under the title — the layout
 * complaint from the 14:41 batch. The body lives inside
 * .section-inner, the single width container every homepage section
 * body uses, so this section can never exceed the other sections'
 * width. The globe itself is lazy (MiniGlobeLazy) and the link beside
 * it leads to the full experience on /places.
 */
export function MapPanel({
  sectionId,
  locale,
  title,
  subtitle,
  linkLabel,
  places,
}: {
  sectionId: string;
  locale: string;
  title?: string | null;
  subtitle?: string | null;
  linkLabel: string;
  places?: PlaceView[] | null;
}) {
  return (
    <section id={sectionId} className="home-section map-preview">
      <div className="section-head">
        {title ? <h2>{title}</h2> : null}
      </div>
      <div className="section-inner">
        <div className="map-places-layout">
          <MiniGlobe places={places ?? []} />
          <div className="map-places-text">
            {subtitle ? <p className="map-places-desc">{subtitle}</p> : null}
            <Link className="btn-primary" href={`/${locale}/places`}>
              {linkLabel}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
