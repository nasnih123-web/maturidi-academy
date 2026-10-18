/**
 * Hero — two-column imperial hero: copy + mihrab search on one side,
 * rotating logo orb (pure CSS) on the other. Server component; the only
 * client JS is the search autocomplete. Title/body arrive from the API
 * home section; chrome copy from next-intl via props.
 */
import { SearchAutocomplete, type SearchAutocompleteLabels } from "./SearchAutocomplete";

export interface HeroCta {
  label: string;
  href: string;
}

export function Hero({
  headingId,
  title,
  body,
  ctaPrimary,
  ctaSecondary,
  searchAction,
  searchEndpoint,
  locale,
  searchLabels,
}: {
  headingId: string;
  title: string;
  body?: string;
  ctaPrimary: HeroCta;
  ctaSecondary: HeroCta;
  searchAction: string;
  searchEndpoint: string;
  locale: string;
  searchLabels: SearchAutocompleteLabels;
}) {
  return (
    <section className="hero-root" aria-labelledby={headingId}>
      <div className="hero-grid">
        <div className="hero-right">
          <h1 id={headingId} className="hero-title">
            {title}
          </h1>
          {body ? <p className="hero-body">{body}</p> : null}

          <SearchAutocomplete
            endpoint={searchEndpoint}
            action={searchAction}
            locale={locale}
            labels={searchLabels}
          />

          <div className="hero-cta-row">
            <a className="btn-primary" href={ctaPrimary.href}>
              {ctaPrimary.label}
            </a>
            <a className="btn-secondary" href={ctaSecondary.href}>
              {ctaSecondary.label}
            </a>
          </div>
        </div>

        <div className="hero-left" aria-hidden>
          <div className="hero-logo-orb">
            <span className="hero-ring" />
            <span className="hero-ring r2" />
            <div className="hero-logo-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="" className="hero-logo-img" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="" className="hero-logo-img hero-logo-back" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
