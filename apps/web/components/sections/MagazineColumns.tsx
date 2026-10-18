/**
 * MagazineColumns — multi-column newspaper flow with editorial cards.
 * Ported from turbo `magazine`. CSS columns keep DOM order intact for
 * screen readers and keyboard tab order (visual reflow only).
 */
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function MagazineColumns(props: SectionVariantProps) {
  return (
    <VariantShell variant="magazine-columns" {...props}>
      <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {variantCards(props)}
      </div>
    </VariantShell>
  );
}
