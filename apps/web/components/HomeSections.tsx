/**
 * HomeSections — maps OUR API section contract (`GET /api/v1/home/sections`,
 * 10 keys in `order`, `visible` flags, trilingual title/subtitle) onto the
 * imperial section renderers. Data access (pickText / extractors) happens
 * here in the server layer; leaf components receive plain values only.
 *
 * Key → renderer:
 *  hero             → Hero (title/body + mihrab search + CTAs)
 *  live_status      → StatusStrip (dates + API status line)
 *  latest_fatwas    → ContentSection (fatwa / typographic / slider)
 *  quran_of_day     → QuoteSection (first item, or API empty state)
 *  suggested_lessons→ ContentSection (course / academy / slider)
 *  fresh_library    → ContentSection (book / shelf / shelf)
 *  community        → ContentSection (community / discussion / grid)
 *  nearby_map       → MapPanel (honest placeholder until the map phase)
 *  donation_banner  → DonateBanner (title/body/CTA from API)
 *  footer           → rendered by the page (outside <main>)
 * Any other key renders the generic ContentSection (article / magazine).
 */
import type { HomeSection } from "@/lib/types";
import { pickText } from "@/lib/localize";
import {
  getContentItems,
  getCta,
  getSectionLayout,
  getStatusLine,
  safeHref,
} from "@/lib/section-data";
import type { HeroSettings } from "@/lib/settings";
import { specForSection } from "./sections/specs";
import { Hero, type HeroCta } from "./Hero";
import { StatusStrip, type StatusStripLabels } from "./StatusStrip";
import { ContentSection, type ContentSectionLabels, type SectionCta } from "./ContentSection";
import { QuoteSection } from "./QuoteSection";
import { DonateBanner } from "./DonateBanner";
import { MapPanel } from "./MapPanel";
import type { SearchAutocompleteLabels } from "./SearchAutocomplete";

export interface HomeSectionsLabels {
  heroCtaPrimary: string;
  heroCtaSecondary: string;
  status: StatusStripLabels;
  card: ContentSectionLabels;
  quoteAria: string;
  mapNote: string;
  search: SearchAutocompleteLabels;
  /** next-intl fallback when a section has no API `empty` payload. */
  emptyFallback: string;
  /** next-intl label used only when the API provides a CTA url without a label. */
  donateCtaLabel: string;
  /** next-intl label for a section "view all" CTA without an API label. */
  viewAllLabel: string;
}

export interface HomeSectionsProps {
  sections: HomeSection[];
  locale: string;
  labels: HomeSectionsLabels;
  /**
   * Hero copy from `platform_settings` (`hero.<locale>`). When set it
   * overrides the API section title/subtitle and the CTA labels/hrefs;
   * unset fields fall back to today's copy.
   */
  heroOverride?: HeroSettings | null;
}

export function HomeSectionRenderer({
  section,
  locale,
  labels,
  heroOverride,
}: {
  section: HomeSection;
  locale: string;
  labels: HomeSectionsLabels;
  heroOverride?: HeroSettings | null;
}) {
  const id = `home-section-${section.key}`;
  const title = pickText(section.title, locale);
  const subtitle = pickText(section.subtitle, locale) || undefined;
  const emptyTitle = pickText(section.empty?.title, locale) || title || labels.emptyFallback;
  const emptyHint = pickText(section.empty?.hint, locale) || undefined;

        switch (section.key) {
          case "hero": {
            // Settings override (hero.<locale>): title/subtitle/CTAs render
            // from platform_settings; anything unset falls back to the API
            // section copy + the next-intl CTA labels.
            const heroTitle = heroOverride?.title || title;
            const heroBody = heroOverride?.subtitle || subtitle;
            const primary: HeroCta = heroOverride?.primaryCta ?? {
              label: labels.heroCtaPrimary,
              href: `/${locale}/learn/courses`,
            };
            const secondary: HeroCta = heroOverride?.secondaryCta ?? {
              label: labels.heroCtaSecondary,
              href: `/${locale}/library`,
            };
            const safeCta = (cta: HeroCta, fallback: HeroCta): HeroCta => ({
              label: cta.label || fallback.label,
              href: safeHref(cta.href) ?? fallback.href,
            });
            return (
              <Hero
                key={section.key}
                headingId={id}
                title={heroTitle}
                body={heroBody}
                ctaPrimary={safeCta(primary, { label: labels.heroCtaPrimary, href: `/${locale}/learn/courses` })}
                ctaSecondary={safeCta(secondary, { label: labels.heroCtaSecondary, href: `/${locale}/library` })}
                searchAction={`/${locale}/search`}
                searchEndpoint="/api/search"
                locale={locale}
                searchLabels={labels.search}
              />
            );
          }
          case "live_status":
            return (
              <StatusStrip
                key={section.key}
                locale={locale}
                labels={labels.status}
                statusLine={getStatusLine(section.data, locale)}
              />
            );
          case "quran_of_day": {
            const items = getContentItems(section.data, locale);
            const first = items[0];
            return (
              <QuoteSection
                key={section.key}
                sectionId={id}
                ariaLabel={title}
                text={first ? first.title : null}
                cite={first?.subtitle || undefined}
                emptyTitle={emptyTitle}
                emptyHint={emptyHint}
              />
            );
          }
          case "nearby_map": {
            const hasData = getContentItems(section.data, locale).length > 0;
            return (
              <MapPanel
                key={section.key}
                sectionId={id}
                title={title}
                subtitle={subtitle}
                note={labels.mapNote}
                emptyTitle={emptyTitle}
                emptyHint={emptyHint}
                hasData={hasData}
              />
            );
          }
          case "donation_banner":
            return (
              <DonateBanner
                key={section.key}
                sectionId={id}
                title={title}
                body={subtitle}
                cta={getCta(section.data, locale, labels.donateCtaLabel)}
              />
            );
          case "footer":
            // Footer chrome is rendered by the page itself (outside <main>).
            return null;
          default: {
            // latest_fatwas, suggested_lessons, fresh_library, community —
            // and any future key: spec-driven module rendering.
            const spec = specForSection(section.key);
            const ctaRecord = getCta(section.data, locale, "");
            const cta: SectionCta | null = ctaRecord
              ? ctaRecord
              : null;
            return (
              <ContentSection
                key={section.key}
                sectionId={id}
                title={title}
                subtitle={subtitle}
                cta={cta}
                type={spec.type}
                template={spec.template}
                layout={getSectionLayout(section.data, spec.layout)}
                items={getContentItems(section.data, locale).map((it) => ({
                  id: it.id,
                  title: it.title,
                  subtitle: it.subtitle || null,
                  author: it.author || null,
                  category: it.category || null,
                  duration: it.duration || null,
                  badge: it.badge || null,
                  image: it.image,
                  href: it.href,
                }))}
                locale={locale}
                labels={labels.card}
                emptyTitle={emptyTitle}
                emptyHint={emptyHint}
              />
            );
          }
        }
}

export function HomeSections({ sections, locale, labels, heroOverride }: HomeSectionsProps) {
  const ordered = [...sections]
    .filter((s) => s.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <>
      {ordered.map((section) => (
        <HomeSectionRenderer
          key={section.key}
          section={section}
          locale={locale}
          labels={labels}
          heroOverride={heroOverride}
        />
      ))}
    </>
  );
}
