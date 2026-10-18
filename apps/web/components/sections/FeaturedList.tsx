/**
 * FeaturedList — featured card beside a star-bulleted headline list.
 * Ported from turbo `featured-list`; the star bullet uses the design-token
 * geometry renderer (no inline SVG duplication).
 */
import { GEOMETRY_RENDERERS } from '@maturidi/design-tokens/geometry';
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function FeaturedList(props: SectionVariantProps) {
  const [lead, ...rest] = props.items;
  const star = GEOMETRY_RENDERERS.star8({ size: 16, color: 'currentColor', opacity: 0.8 });
  return (
    <VariantShell variant="featured-list" {...props}>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>{variantCards(props, lead ? [lead] : [])}</div>
        <ul className="featured-list">
          {rest.slice(0, 5).map((it) => (
            <li key={it.id} className="featured-list-item">
              <span className="featured-list-star" aria-hidden dangerouslySetInnerHTML={{ __html: star }} />
              {it.href ? (
                <a href={it.href} className="featured-list-link">{it.title}</a>
              ) : (
                <span className="featured-list-link">{it.title}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </VariantShell>
  );
}
