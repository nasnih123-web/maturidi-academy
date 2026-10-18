/**
 * SectionHead — shared imperial section header for the variant renderers:
 * geometric anchor, h2, subtitle, "view all" CTA. Pure presentation.
 * The CTA arrow follows the reading direction (← in RTL, → in LTR).
 */
import { GEOMETRY_RENDERERS } from '@maturidi/design-tokens/geometry';
import type { SectionVariantCta } from './types';

export function SectionHead({
  sectionId,
  title,
  subtitle,
  cta,
  locale,
}: {
  sectionId: string;
  title: string;
  subtitle?: string;
  cta: SectionVariantCta | null;
  locale: string;
}) {
  const anchor = GEOMETRY_RENDERERS.divider({ size: 170, color: 'currentColor' });
  const arrow = locale === 'en' ? '→' : '←';
  return (
    <div className="section-head">
      <span className="section-anchor" aria-hidden dangerouslySetInnerHTML={{ __html: anchor }} />
      <div>
        <h2 id={sectionId}>{title}</h2>
        {subtitle ? <span className="section-sub">{subtitle}</span> : null}
      </div>
      {cta ? (
        <a className="section-cta" href={cta.href}>
          {cta.label} {arrow}
        </a>
      ) : null}
    </div>
  );
}
