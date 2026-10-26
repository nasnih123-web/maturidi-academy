/**
 * QuoteSection — featured single-item section (Quran of the day):
 * scholarly quote anchor in the imperial language. Renders the API
 * empty state when the backend has no item yet — never hardcoded verse.
 */
import { EmptyState } from "./EmptyState";

export function QuoteSection({
  sectionId,
  ariaLabel,
  title,
  subtitle,
  text,
  cite,
  emptyTitle,
  emptyHint,
}: {
  sectionId: string;
  ariaLabel: string;
  /** Visible section title (e.g. «آیهٔ روز») — previously only the
   *  aria-label carried it, so the empty state rendered untitled. */
  title: string;
  subtitle?: string;
  text: string | null;
  cite?: string;
  emptyTitle: string;
  emptyHint?: string;
}) {
  return (
    <section className="home-section quote-section" aria-label={ariaLabel}>
      {title ? (
        <div className="section-head">
          <div>
            <h2 id={`${sectionId}-title`}>{title}</h2>
            {subtitle ? <span className="section-sub">{subtitle}</span> : null}
          </div>
        </div>
      ) : null}
      {text ? (
        <blockquote>
          <span id={sectionId}>{text}</span>
          {cite ? <cite>{cite}</cite> : null}
        </blockquote>
      ) : (
        <div className="section-inner">
          <EmptyState title={emptyTitle} hint={emptyHint} />
        </div>
      )}
    </section>
  );
}
