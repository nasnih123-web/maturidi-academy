/**
 * ContentSection — one API home section rendered in the imperial section
 * language: geometric anchor, title/subtitle, CTA, and cards in the
 * configured layout (slider / grid / featured-rail / shelf / mosaic).
 * Pure presentation; items and specs arrive as props.
 */
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";
import type { ContentType } from "@maturidi/design-tokens/content-registry";
import { ContentCard, type ContentCardLabels, type TemplateItem } from "./ContentCard";
import { EmptyState } from "./EmptyState";
import { ExperienceBackground } from "./ExperienceBackground";
import { Slider } from "./Slider";
import type { SectionLayout } from "@/lib/section-data";

export interface SectionCta {
  label: string;
  href: string;
}

export interface ContentSectionLabels extends ContentCardLabels {
  sliderPrev: string;
  sliderNext: string;
}

const SLIDE_W: Record<SectionLayout, string> = {
  slider: "clamp(15rem, 22vw, 19rem)",
  "featured-rail": "clamp(17rem, 30vw, 26rem)",
  shelf: "clamp(11rem, 18vw, 15rem)",
  grid: "clamp(15rem, 22vw, 19rem)",
  mosaic: "clamp(15rem, 22vw, 19rem)",
};

export function ContentSection({
  sectionId,
  title,
  subtitle,
  cta,
  type,
  template,
  layout,
  items,
  locale,
  labels,
  emptyTitle,
  emptyHint,
}: {
  sectionId: string;
  title: string;
  subtitle?: string;
  cta: SectionCta | null;
  type: ContentType;
  template: string;
  layout: SectionLayout;
  items: TemplateItem[];
  locale: string;
  labels: ContentSectionLabels;
  emptyTitle: string;
  emptyHint?: string;
}) {
  const anchor = GEOMETRY_RENDERERS.divider({ size: 170, color: "currentColor" });
  const dir = locale === "en" ? "ltr" : "rtl";
  // "View all" points in the reading direction: ← in RTL, → in LTR.
  const ctaArrow = locale === "en" ? "→" : "←";
  const cards = items
    .slice(0, 10)
    .map((it) => <ContentCard key={it.id} type={type} template={template} item={it} dir={dir} labels={labels} />);

  return (
    <section className="home-section" aria-labelledby={sectionId} data-layout={layout}>
      <ExperienceBackground
        config={{ geometry_variant: "star8", pattern_opacity: 0.035, particle_density: 0, glow_strength: 0.3 }}
      />
      <div className="section-head">
        <span className="section-anchor" aria-hidden dangerouslySetInnerHTML={{ __html: anchor }} />
        <div>
          <h2 id={sectionId}>{title}</h2>
          {subtitle ? <span className="section-sub">{subtitle}</span> : null}
        </div>
        {cta ? (
          <a className="section-cta" href={cta.href}>
            {cta.label} {ctaArrow}
          </a>
        ) : null}
      </div>
      <div className="section-inner">
        {items.length === 0 ? (
          <EmptyState title={emptyTitle} hint={emptyHint} />
        ) : layout === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{cards}</div>
        ) : layout === "mosaic" ? (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 row-span-2">{cards[0]}</div>
            {cards.slice(1, 5)}
          </div>
        ) : (
          <Slider
            config={{
              slideWidth: SLIDE_W[layout],
              labels: { prev: labels.sliderPrev, next: labels.sliderNext, region: title },
              className: layout === "shelf" ? "items-end" : "",
            }}
          >
            {cards}
          </Slider>
        )}
      </div>
    </section>
  );
}
