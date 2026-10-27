/**
 * VariantRenderer — maps a registry variant id to its component and builds
 * its props from a HomeSection (title/subtitle via pickText, items via
 * getContentItems, CTA via getCta, type/template via specs). Server-side
 * composition only; no business logic in components (ADR-0002).
 */
import type { ComponentType } from 'react';
import type { HomeSection } from '@/lib/types';
import { pickText } from '@/lib/localize';
import { getContentItems, getSectionCta } from '@/lib/section-data';
import type { TemplateItem } from '../ContentCard';import type { HomeSectionsLabels } from '../HomeSections';
import { isVariantId, type SectionVariantId } from './registry';
import { specForSection } from './specs';
import type { SectionVariantProps } from './types';
import { SliderClassic } from './SliderClassic';
import { GridCards } from './GridCards';
import { FeaturedRail } from './FeaturedRail';
import { ShelfRow } from './ShelfRow';
import { MosaicWall } from './MosaicWall';
import { EditorialSplit } from './EditorialSplit';
import { FeaturedList } from './FeaturedList';
import { MagazineColumns } from './MagazineColumns';
import { StackTimeline } from './StackTimeline';
import { CompactList } from './CompactList';

const RENDERERS: Record<SectionVariantId, ComponentType<SectionVariantProps>> = {
  'slider-classic': SliderClassic,
  'grid-cards': GridCards,
  'featured-rail': FeaturedRail,
  'shelf-row': ShelfRow,
  'mosaic-wall': MosaicWall,
  'editorial-split': EditorialSplit,
  'featured-list': FeaturedList,
  'magazine-columns': MagazineColumns,
  'stack-timeline': StackTimeline,
  'compact-list': CompactList,
};

export function buildVariantProps(
  section: HomeSection,
  locale: string,
  labels: HomeSectionsLabels,
  emptyFallback: string,
): SectionVariantProps {
  const spec = specForSection(section.key);
  const sectionId = `home-section-${section.key}`;
  const title = pickText(section.title, locale);
  const subtitle = pickText(section.subtitle, locale) || undefined;
  // CMS CTA wins; latest_fatwas falls back to the full listing page.
  const ctaRecord = getSectionCta(section.key, section.data, locale, labels.viewAllLabel);
  const items: TemplateItem[] = getContentItems(section.data, locale).map((it) => ({
    id: it.id,
    title: it.title,
    subtitle: it.subtitle || null,
    author: it.author || null,
    category: it.category || null,
    duration: it.duration || null,
    badge: it.badge || null,
    image: it.image,
    href: it.href,
  }));
  return {
    sectionId,
    title,
    subtitle,
    cta: ctaRecord ? { label: ctaRecord.label, href: ctaRecord.href } : null,
    items,
    locale,
    labels: labels.card,
    emptyTitle: pickText(section.empty?.title, locale) || title || emptyFallback,
    emptyHint: pickText(section.empty?.hint, locale) || undefined,
    contentType: spec.type,
    template: spec.template,
  };
}

export function VariantRenderer({
  variant,
  section,
  locale,
  labels,
}: {
  variant: SectionVariantId;
  section: HomeSection;
  locale: string;
  labels: HomeSectionsLabels;
}) {
  const Renderer = RENDERERS[variant];
  return <Renderer {...buildVariantProps(section, locale, labels, labels.emptyFallback)} />;
}

export { isVariantId };
