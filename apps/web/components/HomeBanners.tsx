/**
 * HomeBanners — active homepage banners by placement, in priority order.
 * Server-rendered; the CTA button is a plain link (no JS). Banners with no
 * usable title are skipped — the API decides visibility/scheduling.
 */
import type { BannerWire } from "@/lib/types";
import { getBannerView, type BannerView } from "@/lib/section-data";

/** Localized, presentation-ready banner. Exported for tests. */
export type { BannerView };

export function HomeBanners({
  banners,
  locale,
}: {
  banners: BannerWire[];
  locale: string;
}) {
  const views = banners
    .map((b) => getBannerView(b, locale))
    .filter((v): v is BannerView => v !== null);
  if (!views.length) return null;
  return (
    <div className="home-banners" role="region">
      {views.map((v) => (
        <section key={v.id} className="home-banner" aria-label={v.title}>
          {v.image ? (
            <div className="home-banner-media" aria-hidden={v.title ? true : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.image} alt="" loading="lazy" />
            </div>
          ) : null}
          <div className="home-banner-body">
            <h2>{v.title}</h2>
            {v.subtitle ? <p>{v.subtitle}</p> : null}
            {v.cta ? (
              <a className="cms-cta-btn" href={v.cta.href}>
                {v.cta.label}
              </a>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
