import { getApiBaseUrl, ApiError } from './api';
import { pickText } from './localize';

/**
 * Server-side finance client (RSC only — never imported from client
 * components). All Phase-15 campaign data access goes through this layer;
 * components render view models (ADR-001).
 *
 * Backend contract (Track 1, /api/v1/finance):
 *   GET  /api/v1/finance/campaigns      → CampaignOut[] (bare array)
 *   GET  /api/v1/finance/campaigns/{id} → CampaignOut (id is UUID)
 *   POST /api/v1/finance/donate         → {intent_id, authority, pay_url}
 *   GET  /api/v1/finance/callback?Authority=&Status= → verify + finalize
 *   GET  /api/v1/finance/receipts/{donation_id} → PDF bytes (auth required)
 *
 * Money: the backend speaks RIALS (IRR). The UI speaks TOMAN (per product
 * requirement). The rial/toman conversion lives ONLY here and in
 * finance-client.ts — never in components.
 */

export const RIALS_PER_TOMAN = 10;

export interface FinanceCampaign {
  id: string;
  title: string;
  description: string;
  cover: string | null;
  /** Rials, as the API returns. */
  goalAmount: number;
  /** Rials, as the API returns. */
  raisedAmount: number;
  /** Backend-computed progress (0–100). */
  progress: number;
  status: string;
}

export interface CampaignView extends FinanceCampaign {
  /** 0–100, clamped. Pure derived value — components must not recompute. */
  progressPct: number;
  /** Locale-formatted goal, e.g. «۱۰٬۰۰۰٬۰۰۰ تومان». */
  goalLabel: string;
  /** Locale-formatted raised amount. */
  raisedLabel: string;
  /** progressPct as a locale-formatted percent string. */
  progressLabel: string;
}

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}`;
}

async function fetchJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      next: { revalidate: 120 },
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable at ${getApiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new ApiError(`GET ${path} → ${res.status}`, res.status);
  }
  return res.json();
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Normalize one campaign from the wire contract. Unknown shapes → null. */
export function normalizeCampaign(body: unknown, locale: string): FinanceCampaign | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const id = asString(o.id);
  if (!id) return null;
  const progress = asNumber(o.progress);
  return {
    id,
    title: pickText(o.title as never, locale),
    description: pickText(o.description as never, locale),
    cover: typeof o.cover === 'string' ? o.cover : null,
    goalAmount: asNumber(o.goal_amount ?? o.goal),
    raisedAmount: asNumber(o.raised_amount ?? o.raised),
    progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0,
    status: asString(o.status) || 'active',
  };
}

/**
 * Campaign list. Accepts either a bare array or {items: [...]} envelope.
 * Throws ApiError on unreachable API or non-2xx — callers render an honest
 * loading/empty/error state (contract §15: no mock data in the production
 * path).
 */
export async function getCampaigns(locale: string): Promise<FinanceCampaign[]> {
  const body = await fetchJson('/api/v1/finance/campaigns');
  const raw: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>)?.items)
      ? ((body as Record<string, unknown>).items as unknown[])
      : [];
  return raw
    .map((c) => normalizeCampaign(c, locale))
    .filter((c): c is FinanceCampaign => c !== null);
}

/** Single campaign detail. 404 → ApiError(404). */
export async function getCampaign(id: string, locale: string): Promise<FinanceCampaign> {
  const body = await fetchJson(`/api/v1/finance/campaigns/${encodeURIComponent(id)}`);
  const campaign = normalizeCampaign(body, locale);
  if (!campaign) throw new ApiError(`GET /api/v1/finance/campaigns/${id} → unparseable`, 502);
  return campaign;
}

/** Format a whole-toman amount for the locale. Pure. */
export function formatToman(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar' : 'en').format(
      Math.round(amount),
    );
  } catch {
    return String(Math.round(amount));
  }
}

/** Format a percent value for the locale. Pure. */
export function formatPercent(pct: number, locale: string): string {
  const digits = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar' : 'en', {
    maximumFractionDigits: 1,
  }).format(pct);
  return locale === 'en' ? `${digits}%` : `${digits}٪`;
}

/** Rials → whole toman. Pure. */
export function tomanFromRial(rials: number): number {
  return Math.round(rials / RIALS_PER_TOMAN);
}

/** Pure view-model builder — the only place progress/rial math lives. */
export function toCampaignView(c: FinanceCampaign, locale: string, currencyLabel: string): CampaignView {
  const pct = c.goalAmount > 0 ? (c.raisedAmount / c.goalAmount) * 100 : c.progress;
  const pctClamped = Math.min(100, Math.max(0, pct));
  const goalLabel = `${formatToman(tomanFromRial(c.goalAmount), locale)} ${currencyLabel}`;
  const raisedLabel = `${formatToman(tomanFromRial(c.raisedAmount), locale)} ${currencyLabel}`;
  return {
    ...c,
    progressPct: Math.round(pctClamped * 10) / 10,
    goalLabel,
    raisedLabel,
    progressLabel: formatPercent(pctClamped, locale),
  };
}

/** Suggested whole-toman presets for the donate form. Pure. */
export function donatePresets(): number[] {
  return [50_000, 100_000, 250_000, 500_000, 1_000_000];
}

/** Minimum whole-toman donation — below this the gateway fee dominates. */
export const MIN_DONATE_AMOUNT = 10_000;
