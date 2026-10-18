/**
 * EditorialSplit — newspaper split: one large lead story beside a stacked
 * column of minimal headlines. Ported from turbo `editorial-split`.
 */
import { VariantShell } from './VariantShell';
import { variantCards } from './cards';
import type { SectionVariantProps } from './types';

export function EditorialSplit(props: SectionVariantProps) {
  const [lead, ...rest] = props.items;
  return (
    <VariantShell variant="editorial-split" {...props}>
      <div className="grid gap-6 sm:grid-cols-5">
        <div className="sm:col-span-3">{variantCards(props, lead ? [lead] : [])}</div>
        <ul className="flex flex-col gap-3 sm:col-span-2">
          {rest.slice(0, 4).map((it) => (
            <li key={it.id} className="editorial-mini">
              {it.href ? (
                <a href={it.href} className="editorial-mini-link">
                  <span className="editorial-mini-title">{it.title}</span>
                  {it.subtitle ? <span className="editorial-mini-sub">{it.subtitle}</span> : null}
                </a>
              ) : (
                <span className="editorial-mini-link" aria-disabled="true">
                  <span className="editorial-mini-title">{it.title}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </VariantShell>
  );
}
