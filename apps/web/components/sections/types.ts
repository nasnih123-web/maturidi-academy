/**
 * Shared types for the below-hero section variants (issue #8).
 * Variants are server components: pure presentation, all values arrive via
 * props from the service layer (ADR-0002).
 */
import type { TemplateItem } from '../ContentCard';
import type { ContentType } from '@maturidi/design-tokens/content-registry';
import type { ContentSectionLabels } from '../ContentSection';

export interface SectionVariantCta {
  label: string;
  href: string;
}

export interface SectionVariantProps {
  sectionId: string;
  title: string;
  subtitle?: string;
  cta: SectionVariantCta | null;
  items: TemplateItem[];
  locale: string;
  labels: ContentSectionLabels;
  emptyTitle: string;
  emptyHint?: string;
  /** Content-type + card template resolved from the section key (SPECS). */
  contentType: ContentType;
  template: string;
}
