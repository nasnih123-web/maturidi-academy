/**
 * Verify domain client (Phase 6 — web track).
 *
 * Typed client for the content-verification API. Components never call
 * fetch directly (ADR-001).
 *
 * Wire contract (source of truth: backend track, apps/api/app/modules/verify):
 * - POST /api/v1/verify/check {text}
 *     → {verdict: verified|not_found|conflicting, sources:[...], nearest}
 *
 * Source entries: {title?, citation?, url?}. nearest: the closest match
 * text/excerpt when no exact verification exists.
 */

export type VerifyVerdict = 'verified' | 'not_found' | 'conflicting';

export interface VerifySource {
  title: string;
  citation: string;
  url: string | null;
}

export interface VerifyResult {
  verdict: VerifyVerdict;
  sources: VerifySource[];
  /** Nearest match text — backend currently returns none; kept for forward compatibility. */
  nearest: string | null;
  /** Backend note about the verdict (already localized server-side). */
  note: string | null;
}

export class VerifyApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'VerifyApiError';
    this.status = status;
  }
}

function apiBase(): string {
  const base =
    typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : undefined;
  return (base ?? 'http://localhost:8000').replace(/\/+$/, '');
}

function asVerdict(v: unknown): VerifyVerdict {
  return v === 'verified' || v === 'conflicting' ? v : 'not_found';
}

/** POST /api/v1/verify/check. Throws VerifyApiError on failure. */
export async function checkText(
  text: string,
  opts: { locale?: string; signal?: AbortSignal } = {},
): Promise<VerifyResult> {
  const locale = opts.locale ?? 'fa';
  const signal = opts.signal;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/verify/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new VerifyApiError(`API unreachable at ${apiBase()}`, 0);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message ?? '';
    } catch {
      /* ignore */
    }
    throw new VerifyApiError(detail || `POST /api/v1/verify/check → ${res.status}`, res.status);
  }
  const o = ((await res.json()) ?? {}) as Record<string, unknown>;
  // Backend VerifyOut: {verdict, matched: [CitationOut], note}.
  const matched = Array.isArray(o.matched) ? o.matched : Array.isArray(o.sources) ? o.sources : [];
  const sources = matched
    .map((raw): VerifySource | null => {
      if (!raw || typeof raw !== 'object') return null;
      const s = raw as Record<string, unknown>;
      const title = localizeSource(s.source_citation, locale);
      const excerpt = typeof s.excerpt === 'string' ? s.excerpt : '';
      if (!title && !excerpt) return null;
      return {
        title,
        citation: typeof s.citation === 'string' ? s.citation : excerpt,
        url: typeof s.url === 'string' ? s.url : null,
      };
    })
    .filter((s): s is VerifySource => s !== null);
  return {
    verdict: asVerdict(o.verdict),
    sources,
    nearest: typeof o.nearest === 'string' ? o.nearest : null,
    note: typeof o.note === 'string' && o.note.trim() !== '' ? o.note : null,
  };
}

function localizeSource(v: unknown, locale: string): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const m = v as Record<string, unknown>;
    for (const k of [locale, 'en', 'fa']) {
      if (typeof m[k] === 'string' && (m[k] as string).trim() !== '') return m[k] as string;
    }
    const first = Object.values(m).find(
      (x): x is string => typeof x === 'string' && x.trim() !== '',
    );
    if (first) return first;
  }
  return '';
}
