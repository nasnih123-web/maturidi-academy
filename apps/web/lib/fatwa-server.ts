/**
 * Server-side fatwa client (RSC only — never imported from client code).
 *
 * Mirrors the defensive parsing of lib/fatwa.ts for server-rendered pages
 * (madhab comparison). Per ADR-0002 all data access goes through this
 * layer; components only render.
 */
import { API_BASE_URL, ApiError } from './api';
import type { MadhabComparison, MadhabPosition } from './fatwa';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function localizedText(v: unknown, locale = 'fa'): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const m = v as Record<string, unknown>;
    for (const k of [locale, 'en', 'fa']) {
      if (typeof m[k] === 'string' && (m[k] as string).trim() !== '') return m[k] as string;
    }
    const first = Object.values(m).find((x): x is string => typeof x === 'string');
    if (first) return first;
  }
  return '';
}

/**
 * GET /api/v1/fatwa/compare/{topic_id} — server-rendered.
 * Throws ApiError on unreachable API / non-2xx.
 */
export async function getMadhabComparisonServer(
  topicId: string,
  locale = 'fa',
): Promise<MadhabComparison> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/v1/fatwa/compare/${encodeURIComponent(topicId)}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });
  } catch (err) {
    throw new ApiError(`API unreachable at ${API_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  if (!res.ok) throw new ApiError(`GET /api/v1/fatwa/compare/${topicId} → ${res.status}`, res.status);
  const o = ((await res.json()) ?? {}) as Record<string, unknown>;
  const positions: MadhabPosition[] = Array.isArray(o.positions)
    ? o.positions
        .map((raw): MadhabPosition | null => {
          if (!raw || typeof raw !== 'object') return null;
          const p = raw as Record<string, unknown>;
          return {
            madhab: asString(p.madhab),
            position_text: localizedText(p.position_text, locale),
            evidence_refs: Array.isArray(p.evidence_refs)
              ? p.evidence_refs.filter((x): x is string => typeof x === 'string')
              : [],
          };
        })
        .filter((p): p is MadhabPosition => p !== null)
    : [];
  return {
    topic: localizedText(o.title ?? o.topic, locale),
    description: localizedText(o.description, locale),
    positions,
  };
}
