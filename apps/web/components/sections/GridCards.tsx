/**
 * GridCards — responsive card grid (2 → 4 columns), no horizontal scroll.
 * Ported from turbo `grid-3` / `grid-4` compositions; breakpoints widened so
 * cards never squeeze below a readable width on mobile.
 */
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function GridCards(props: SectionVariantProps) {
  return (
    <VariantShell variant="grid-cards" {...props}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {variantCards(props)}
      </div>
    </VariantShell>
  );
}
