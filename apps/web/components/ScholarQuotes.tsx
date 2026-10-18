/**
 * ScholarQuotes — scholar-quote section from GET /api/v1/content/public/quotes.
 * Server-rendered; renders nothing when the API returns no quotes
 * (honest empty state — never a hardcoded quote).
 */
import type { ScholarQuoteView } from "@/lib/section-data";

export function ScholarQuotes({
  quotes,
  heading,
  ariaLabel,
}: {
  quotes: ScholarQuoteView[];
  heading: string;
  ariaLabel: string;
}) {
  if (!quotes.length) return null;
  return (
    <section className="home-section scholar-quotes" aria-label={ariaLabel}>
      <div className="section-inner">
        <h2>{heading}</h2>
        <div className="scholar-quotes-list">
          {quotes.map((q) => (
            <figure key={q.id} className="scholar-quote">
              <blockquote>{q.text}</blockquote>
              {(q.scholar || q.source) && (
                <figcaption>
                  {q.scholar ? <span className="scholar-quote-author">— {q.scholar}</span> : null}
                  {q.source ? <span className="scholar-quote-source">{q.source}</span> : null}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
