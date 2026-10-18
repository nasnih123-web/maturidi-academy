/**
 * MapPanel — nearby map section. The live map arrives in a later phase;
 * until then this is an honest static panel (imperial styling) with the
 * API empty state — never a fake map.
 */
import { EmptyState } from "./EmptyState";
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";

export function MapPanel({
  sectionId,
  title,
  subtitle,
  note,
  emptyTitle,
  emptyHint,
  hasData,
}: {
  sectionId: string;
  title: string;
  subtitle?: string;
  /** Localized note explaining the panel is a placeholder. */
  note: string;
  emptyTitle: string;
  emptyHint?: string;
  hasData: boolean;
}) {
  const anchor = GEOMETRY_RENDERERS.divider({ size: 170, color: "currentColor" });
  return (
    <section className="home-section" aria-labelledby={sectionId}>
      <div className="section-head">
        <span className="section-anchor" aria-hidden dangerouslySetInnerHTML={{ __html: anchor }} />
        <div>
          <h2 id={sectionId}>{title}</h2>
          {subtitle ? <span className="section-sub">{subtitle}</span> : null}
        </div>
      </div>
      <div className="section-inner">
        {hasData ? (
          <div className="map-panel">
            <p className="map-note">{note}</p>
          </div>
        ) : (
          <EmptyState title={emptyTitle} hint={emptyHint} />
        )}
      </div>
    </section>
  );
}
