/**
 * SliderClassic — horizontal card rail with prev/next buttons and page dots.
 * Ported from turbo `SectionLayout "slider"`: RTL/LTR-aware Slider primitive,
 * keyboard navigation, autoplay pause on hover/focus.
 */
import { Slider } from '../Slider';
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function SliderClassic(props: SectionVariantProps) {
  return (
    <VariantShell variant="slider-classic" {...props}>
      <Slider
        config={{
          slideWidth: 'clamp(15rem, 22vw, 19rem)',
          labels: { prev: props.labels.sliderPrev, next: props.labels.sliderNext, region: props.title },
        }}
      >
        {variantCards(props)}
      </Slider>
    </VariantShell>
  );
}
