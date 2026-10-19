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
          <img
            src="/logo.jpg"
            alt=""
            width={40}
            height={40}
            style={{ borderRadius: 10, boxShadow: "0 0 14px rgba(212,175,55,.3)", marginBottom: "0.6rem" }}
          />
          <h2 style={{ margin: "0 0 0.5rem", fontWeight: 800 }}>{labels.brandName}</h2>
          <p style={{ fontSize: "0.85rem", color: "hsl(var(--text-muted))", maxWidth: "24rem" }}>{labels.tagline}</p>
        </div>
        {cols.map((c) => (
          <nav key={c.heading} aria-label={c.heading}>
            <h3>{c.heading}</h3>
            {c.links.map((l) => (
              <Link key={l.href} href={l.href.startsWith("/") ? `/${locale}${l.href}` : l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="footer-divider" aria-hidden dangerouslySetInnerHTML={{ __html: divider }} />
      <div className="footer-bottom">{labels.rights}</div>
    </footer>
  );
}
