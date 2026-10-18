/**
 * EventBanner — the active Islamic event as a themed banner state.
 * Server-rendered from a presentation-ready view; renders nothing when
 * there is no active event (honest empty state).
 */
import type { IslamicEventView } from "@/lib/section-data";
import { formatUpdatedAt } from "@/lib/seo";

export function EventBanner({
  event,
  locale,
  ariaLabel,
  hijriDate,
}: {
  event: IslamicEventView | null;
  locale: string;
  ariaLabel: string;
  /** localized hijri date line, e.g. «۷ جمادی‌الاول هجری قمری» — null hides it */
  hijriDate: string | null;
}) {
  if (!event) return null;
  const from = event.startsAt ? formatUpdatedAt(event.startsAt, locale) : "";
  const to = event.endsAt ? formatUpdatedAt(event.endsAt, locale) : "";
  const range = from && to && from !== to ? `${from} — ${to}` : from || to;
  return (
    <section className="home-section event-banner" aria-label={ariaLabel}>
      <div className="section-inner event-banner-inner">
        {event.imageUrl ? (
          <div className="event-banner-media" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={event.imageUrl} alt="" loading="lazy" />
          </div>
        ) : null}
        <div>
          <h2>{event.title}</h2>
          {hijriDate ? <p className="event-hijri-date">{hijriDate}</p> : null}
        </div>
        {range ? (
          <p className="event-date-range">
            <time dateTime={event.startsAt ?? undefined}>{range}</time>
          </p>
        ) : null}
      </div>
    </section>
  );
}
