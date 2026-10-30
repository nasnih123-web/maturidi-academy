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
import { Fragment, type ReactNode } from 'react';
import type { HomeSection } from '@/lib/types';
import type { HomeSlotSetting, HeroSettings } from '@/lib/settings';
import { HomeSectionRenderer, type FatwaSliderItem, type HomeSectionsLabels } from '../HomeSections';
import type { PlaceView } from '@/lib/places-view';
import { isVariantEligibleSection } from './specs';
import { VariantRenderer, isVariantId } from './VariantRenderer';

export function SectionSlot({
  section,
  slot,
  locale,
  labels,
  heroOverride,
  fatwaSliderItems,
  places,
}: {
  section: HomeSection;
  slot: HomeSlotSetting;
  locale: string;
  labels: HomeSectionsLabels;
  heroOverride: HeroSettings | null;
  fatwaSliderItems?: FatwaSliderItem[] | null;
  places?: PlaceView[] | null;
}) {
  // The fatwa slider always comes from the public published-topics
  // endpoint — a variant must not silently revert it to section JSON.
  if (section.key === 'latest_fatwas') {
    return (
      <HomeSectionRenderer
        section={section}
        locale={locale}
        labels={labels}
        heroOverride={heroOverride}
        fatwaSliderItems={fatwaSliderItems}
        places={places}
      />
    );
  }
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
      fatwaSliderItems={fatwaSliderItems}
      places={places}
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
  fatwaSliderItems,
  places,
  afterCommunity,
}: {
  sections: HomeSection[];
  slots: HomeSlotSetting[];
  locale: string;
  labels: HomeSectionsLabels;
  heroOverride: HeroSettings | null;
  fatwaSliderItems?: FatwaSliderItem[] | null;
  places?: PlaceView[] | null;
  /**
   * Block rendered immediately after the community section (in slots
   * order), e.g. the recent-articles slider. When no community slot
   * renders (disabled, invisible, or absent), it is appended at the end
   * so it still appears exactly once.
   */
  afterCommunity?: ReactNode;
}) {
  const byKey = new Map<string, HomeSection>();
  for (const s of sections) {
    if (s.visible !== false && !byKey.has(s.key)) byKey.set(s.key, s);
  }
  // The hero is rendered separately by the page (with the
  // hero.<locale> override); a "hero" slot here would duplicate it.
  const renderedSlots = slots.filter((slot) => slot.enabled !== false && slot.id !== "hero");
  const communityRendered = renderedSlots.some(
    (slot) => slot.id === "community" && byKey.has("community"),
  );
  return (
    <>
      {renderedSlots.map((slot) => {
        const section = byKey.get(slot.id);
        if (!section) return null;
        return (
          <Fragment key={slot.id}>
            <SectionSlot
              section={section}
              slot={slot}
              locale={locale}
              labels={labels}
              heroOverride={heroOverride}
              fatwaSliderItems={fatwaSliderItems}
              places={places}
            />
            {slot.id === "community" ? afterCommunity : null}
          </Fragment>
        );
      })}
      {!communityRendered ? afterCommunity : null}
    </>
  );
}
