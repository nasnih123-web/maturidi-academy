/**
 * CompactList — dense rows: title + metadata, highest information density.
 * Ported from turbo `compact-list`; upgraded with visible metadata and
 * focus-visible states so keyboard users get the same affordances as
 * pointer users.
 */
import { VariantShell } from './VariantShell';
import type { SectionVariantProps } from './types';

export function CompactList(props: SectionVariantProps) {
  return (
    <VariantShell variant="compact-list" {...props}>
      <ul className="compact-list">
        {props.items.slice(0, 8).map((it) => (
          <li key={it.id} className="compact-row">
            {it.href ? (
              <a href={it.href} className="compact-link">
                <span className="compact-title">{it.title}</span>
                {(it.category || it.duration || it.author) && (
                  <span className="compact-meta">
                    {[it.author, it.category, it.duration].filter(Boolean).join(' · ')}
                  </span>
                )}
              </a>
            ) : (
              <span className="compact-link" aria-disabled="true">
                <span className="compact-title">{it.title}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </VariantShell>
  );
}
