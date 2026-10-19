'use client';

/**
 * MadhabCompare — four-madhab comparison view (Phase 6).
 *
 * Pure presentation: the server page fetches via lib/fatwa-server.ts and
 * passes the parsed comparison + localized labels. No business logic here.
 */
import type { MadhabComparison } from '@/lib/fatwa';

export interface MadhabCompareLabels {
  evidenceLabel: string;
  /** Localized madhab names, e.g. {hanafi: 'حنفی', …}. Unknown keys fall back to the raw key. */
  madhabNames: Record<string, string>;
  emptyLabel: string;
}

const MADHAB_ORDER = ['hanafi', 'maliki', 'shafi', 'hanbali'];

export function MadhabCompare({
  comparison,
  labels,
}: {
  comparison: MadhabComparison;
  labels: MadhabCompareLabels;
}) {
  const byKey = new Map(comparison.positions.map((p) => [p.madhab.toLowerCase(), p]));
  const ordered = MADHAB_ORDER.map((k) => byKey.get(k)).filter(
    (p): p is NonNullable<typeof p> => !!p,
  );
  const rest = comparison.positions.filter((p) => !MADHAB_ORDER.includes(p.madhab.toLowerCase()));
  const positions = [...ordered, ...rest];

  if (positions.length === 0) {
    return (
      <div className="empty-state" role="status">
        <h3>{labels.emptyLabel}</h3>
      </div>
    );
  }

  return (
    <div className="ftw-compare-grid">
      {positions.map((p) => (
        <article key={p.madhab} className="ftw-madhab-card">
          <h2>{labels.madhabNames[p.madhab.toLowerCase()] ?? p.madhab}</h2>
          <p className="ftw-position">{p.position_text}</p>
          {p.evidence_refs.length > 0 && (
            <div className="ftw-evidence">
              <h3>{labels.evidenceLabel}</h3>
              <ul>
                {p.evidence_refs.map((ref, i) => (
                  <li key={i}>{ref}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
