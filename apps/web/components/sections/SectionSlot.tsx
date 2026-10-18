/**
 * SectionSlot — one `home.sections` settings slot ({ id, variant, enabled })
 * composed with the section's real API data.
 *
 * - `enabled: false` → renders nothing (respected here and by the caller).
 * - `variant` is a registry id AND the section is variant-eligible
 *   (content-list style) → the chosen variant renderer.
 * - otherwise → the legacy bespoke renderer (HomeSectionRenderer), i.e.
 *   today's behavior for hero / live_status / quran_of_day / nearby_map /
 *   donation_banner / footer.
 *
 * Slot enable/disable is the settings-level switch; the API `visible` flag
 * is still honored when the section payload is selected.
 */
import type { HomeSection } from '@/lib/types';
import type { HomeSlotSetting, HeroSettings } from '@/lib/settings';
import { HomeSectionRenderer, type HomeSectionsLabels } from '../HomeSections';
import { isVariantEligibleSection } from './specs';
import { VariantRenderer, isVariantId } from './VariantRenderer';

export function SectionSlot({
  section,
  slot,
  locale,
  labels,
  heroOverride,
}: {
  section: HomeSection;
  slot: HomeSlotSetting;
  locale: string;
  labels: HomeSectionsLabels;
  heroOverride: HeroSettings | null;
}) {
  if (
    slot.variant &&
    isVariantId(slot.variant) &&
    isVariantEligibleSection(section.key)
  ) {
    return <VariantRenderer variant={slot.variant} section={section} locale={locale} labels={labels} />;
  }
  return (
    <HomeSectionRenderer
      section={section}
      locale={locale}
      labels={labels}
      heroOverride={heroOverride}
    />
  );
}

/**
 * ComposedSections — the homepage body when the `home.sections` settings
 * key is present: slots render in settings order, each pulling its live
 * section payload by key. Slots whose key has no live section render
 * nothing (never invented). When the key is absent/empty the caller falls
 * back to <HomeSections> (today's behavior).
 */
export function ComposedSections({
  sections,
  slots,
  locale,
  labels,
  heroOverride,
}: {
  sections: HomeSection[];
  slots: HomeSlotSetting[];
  locale: string;
  labels: HomeSectionsLabels;
  heroOverride: HeroSettings | null;
}) {
  const byKey = new Map<string, HomeSection>();
  for (const s of sections) {
    if (s.visible !== false && !byKey.has(s.key)) byKey.set(s.key, s);
  }
  return (
    <>
      {slots
        // The hero is rendered separately by the page (with the
        // hero.<locale> override); a "hero" slot here would duplicate it.
        .filter((slot) => slot.enabled !== false && slot.id !== "hero")
        .map((slot) => {
          const section = byKey.get(slot.id);
          if (!section) return null;
          return (
            <SectionSlot
              key={slot.id}
              section={section}
              slot={slot}
              locale={locale}
              labels={labels}
              heroOverride={heroOverride}
            />
          );
        })}
    </>
  );
}
