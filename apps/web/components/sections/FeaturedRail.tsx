/**
 * FeaturedRail — lead story card up front, the rest in a wide rail slider.
 * Ported from turbo `featured-rail` layout. The lead uses the section's
 * default card template; the rail uses wider slides for a magazine feel.
 */
import { Slider } from '../Slider';
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function FeaturedRail(props: SectionVariantProps) {
  const [lead, ...rest] = props.items;
  return (
    <VariantShell variant="featured-rail" {...props}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="featured-lead">{variantCards(props, lead ? [lead] : [])}</div>
        {rest.length > 0 ? (
          <Slider
            config={{
              slideWidth: 'clamp(13rem, 20vw, 17rem)',
              labels: { prev: props.labels.sliderPrev, next: props.labels.sliderNext, region: props.title },
            }}
          >
            {variantCards(props, rest)}
          </Slider>
        ) : null}
      </div>
    </VariantShell>
  );
}
