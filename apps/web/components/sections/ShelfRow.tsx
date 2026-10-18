/**
 * ShelfRow — books-on-a-shelf row with a gentle 3D perspective tilt.
 * Ported from turbo `shelf-3d` composition (books lean back like on a real
 * shelf). The tilt is decorative: disabled under prefers-reduced-motion via
 * the global motion policy, and cards stay fully keyboard-focusable.
 */
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function ShelfRow(props: SectionVariantProps) {
  return (
    <VariantShell variant="shelf-row" {...props}>
      <div className="[perspective:900px]">
        <div className="shelf-row flex items-end gap-5 overflow-x-auto pb-6 pt-2 [scrollbar-width:thin]">
          {variantCards(props).map((card, i) => (
            <div key={props.items[i]?.id ?? i} className="shelf-book w-40 shrink-0 sm:w-48">
              {card}
            </div>
          ))}
        </div>
        <div className="shelf-plank" aria-hidden />
      </div>
    </VariantShell>
  );
}
