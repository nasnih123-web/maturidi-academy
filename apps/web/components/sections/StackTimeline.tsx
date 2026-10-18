/**
 * StackTimeline — vertical timeline with a guide rail and marker dots.
 * Ported from turbo `stack-timeline`; uses logical properties (ms-/ps-/
 * -start) so the rail mirrors correctly in LTR locales.
 */
import { VariantShell } from './VariantShell';
import type { SectionVariantProps } from './types';

export function StackTimeline(props: SectionVariantProps) {
  return (
    <VariantShell variant="stack-timeline" {...props}>
      <ol className="timeline-stack">
        {props.items.slice(0, 6).map((it) => (
          <li key={it.id} className="timeline-item">
            <span className="timeline-dot" aria-hidden />
            <div className="timeline-body">
              {it.href ? (
                <a href={it.href} className="timeline-title">{it.title}</a>
              ) : (
                <span className="timeline-title">{it.title}</span>
              )}
              {it.subtitle ? <p className="timeline-sub">{it.subtitle}</p> : null}
              {(it.category || it.duration) && (
                <p className="timeline-meta">
                  {[it.category, it.duration].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </VariantShell>
  );
}
