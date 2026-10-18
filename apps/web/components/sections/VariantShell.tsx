/**
 * VariantShell — the common <section> wrapper for the 10 below-hero
 * variants: imperial background, shared head, empty state. Variants only
 * implement their body layout. Pure presentation.
 */
import type { ReactNode } from 'react';
import { ExperienceBackground } from '../ExperienceBackground';
import { EmptyState } from '../EmptyState';
import { SectionHead } from './SectionHead';
import type { SectionVariantProps } from './types';

export function VariantShell({
  variant,
  children,
  ...props
}: SectionVariantProps & { variant: string; children: ReactNode }) {
  const { sectionId, title, subtitle, cta, locale, items, emptyTitle, emptyHint } = props;
  return (
    <section className="home-section" aria-labelledby={sectionId} data-layout={variant}>
      <ExperienceBackground
        config={{ geometry_variant: 'star8', pattern_opacity: 0.035, particle_density: 0, glow_strength: 0.3 }}
      />
      <SectionHead sectionId={sectionId} title={title} subtitle={subtitle} cta={cta} locale={locale} />
      <div className="section-inner">
        {items.length === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : children}
      </div>
    </section>
  );
}
