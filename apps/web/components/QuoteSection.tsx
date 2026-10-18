/**
 * QuoteSection — featured single-item section (Quran of the day):
 * scholarly quote anchor in the imperial language. Renders the API
 * empty state when the backend has no item yet — never hardcoded verse.
 */
import { EmptyState } from "./EmptyState";

export function QuoteSection({
  sectionId,
  ariaLabel,
  text,
  cite,
  emptyTitle,
  emptyHint,
}: {
  sectionId: string;
  ariaLabel: string;
  text: string | null;
  cite?: string;
  emptyTitle: string;
  emptyHint?: string;
}) {
  return (
    <section className="home-section quote-section" aria-label={ariaLabel}>
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
