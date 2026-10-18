/**
 * MosaicWall — asymmetric mosaic: the lead card spans 2×2, the next four
 * fill the remaining cells. Ported from turbo `mosaic` layout; the grid
 * collapses to a single column on small screens so nothing overlaps.
 */
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function MosaicWall(props: SectionVariantProps) {
  const cards = variantCards(props);
  const [lead, ...rest] = cards;
  return (
    <VariantShell variant="mosaic-wall" {...props}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {lead ? <div className="sm:col-span-2 sm:row-span-2">{lead}</div> : null}
        {rest.slice(0, 4)}
      </div>
    </VariantShell>
  );
}
