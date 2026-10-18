/**
 * specs — section-key → content-type/template/layout spec mapping.
 * Extracted from HomeSections: the same specs drive both the legacy
 * renderer and the variant-based slot composer, so the two can never drift.
 * Pure data — no business logic (ADR-0002).
 */
import type { ContentType } from '@maturidi/design-tokens/content-registry';
import type { SectionLayout } from '@/lib/section-data';

export interface SectionSpec {
  type: ContentType;
  template: string;
  layout: SectionLayout;
}

export const SPECS: Record<string, SectionSpec> = {
  latest_fatwas: { type: 'fatwa', template: 'typographic', layout: 'slider' },
  suggested_lessons: { type: 'course', template: 'academy', layout: 'slider' },
  fresh_library: { type: 'book', template: 'shelf', layout: 'shelf' },
  community: { type: 'community', template: 'discussion', layout: 'grid' },
};

export const GENERIC_SPEC: SectionSpec = { type: 'article', template: 'magazine', layout: 'slider' };

export function specForSection(key: string): SectionSpec {
  return SPECS[key] ?? GENERIC_SPEC;
}

/**
 * Section keys whose rendering is "content-list" style (title + items) and
 * can therefore take any of the 10 registry variants. Dedicated sections
 * (hero, live_status, quran_of_day, nearby_map, donation_banner, footer)
 * keep their bespoke renderers and ignore slot variants.
 */
const DEDICATED_KEYS = new Set([
  'hero',
  'live_status',
  'quran_of_day',
  'nearby_map',
  'donation_banner',
  'footer',
]);

export function isVariantEligibleSection(key: string): boolean {
  return !DEDICATED_KEYS.has(key);
}
