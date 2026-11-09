/**
 * SiteFooter — imperial glass footer. Nav columns come from the API footer
 * section (`getNavColumns`); the caller supplies a localized fallback when
 * the API provides none. Brand copy arrives as props — nothing hardcoded.
 */
import Link from "next/link";
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";

export interface FooterColumn {
  heading: string;
  links: { label: string; href: string }[];
}

export interface FooterLabels {
  brandName: string;
  tagline: string;
  rights: string;
  navFallback: FooterColumn[];
}

export function SiteFooter({
  locale,
  labels,
  columns,
}: {
  locale: string;
  labels: FooterLabels;
  columns: FooterColumn[];
}) {
  const cols = columns.length > 0 ? columns : labels.navFallback;
  const divider = GEOMETRY_RENDERERS.divider({ size: 220, color: "currentColor" });
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* Performance (§8): 96px webp (4KB) instead of the 1024px
              / 204KB logo.jpg; lazy — the footer is below the fold. */}
          <img
            src="/logo-96.webp"
            alt=""
            width={40}
            height={40}
            loading="lazy"
            style={{ borderRadius: 10, boxShadow: "0 0 14px rgba(212,175,55,.3)", marginBottom: "0.6rem" }}
          />
          <h2 style={{ margin: "0 0 0.5rem", fontWeight: 800 }}>{labels.brandName}</h2>
          <p style={{ fontSize: "0.85rem", color: "hsl(var(--text-muted))", maxWidth: "24rem" }}>{labels.tagline}</p>
        </div>
        {cols.map((c) => (
          <nav key={c.heading} aria-label={c.heading}>
            <h3>{c.heading}</h3>
            {c.links.map((l) => {
              // Internal paths get the locale prefix — unless the admin
              // already entered a locale-prefixed path (no double prefix).
              // External http(s) links pass through untouched.
              const href =
                l.href.startsWith("/") &&
                l.href !== `/${locale}` &&
                !l.href.startsWith(`/${locale}/`)
                  ? `/${locale}${l.href}`
                  : l.href;
              return (
                // Round 2 §8: no prefetch — footer links are site
                // chrome; prefetching them on every page costs slow
                // connections for routes the user may never visit.
                <Link key={l.href} href={href} prefetch={false}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
        ))}
      </div>
      <div className="footer-divider" aria-hidden dangerouslySetInnerHTML={{ __html: divider }} />
      <div className="footer-bottom">{labels.rights}</div>
    </footer>
  );
}
