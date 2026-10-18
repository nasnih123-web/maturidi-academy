/**
 * SectionEmbed — renders a `section-*` CMS block as a live homepage section.
 * Split into its own module so the CMS page route only pays for the
 * homepage-section bundle when a page actually embeds sections
 * (performance budget: First Load JS ≤ 100KB).
 */
import { HomeSectionRenderer, type HomeSectionsLabels } from "./HomeSections";
import type { HomeSection } from "@/lib/types";

export function SectionEmbed({
  sectionKey,
  sections,
  locale,
  labels,
}: {
  sectionKey: string;
  sections: HomeSection[];
  locale: string;
  labels: HomeSectionsLabels;
}) {
  const section = sections.find((s) => s.key === sectionKey);
  if (!section) {
    // eslint-disable-next-line no-console
    console.warn(`[cms] section embed "${sectionKey}" skipped: key not in home sections`);
    return null;
  }
  return <HomeSectionRenderer section={section} locale={locale} labels={labels} />;
}
