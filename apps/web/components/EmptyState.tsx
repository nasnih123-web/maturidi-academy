/**
 * EmptyState — API-driven empty state (turbo `.empty-state` language).
 * Title/hint come from the section's API `empty` payload; the caller
 * supplies a next-intl fallback for sections without one.
 */
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const icon = GEOMETRY_RENDERERS.rosette({ size: 44, color: "currentColor", opacity: 0.8 });
  return (
    <div className="empty-state" role="status">
      <span className="es-icon" aria-hidden dangerouslySetInnerHTML={{ __html: icon }} />
      <h2>{title}</h2>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}
