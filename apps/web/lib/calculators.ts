/**
 * Calculators domain client (Phase 7 — web track).
 *
 * Typed client for the inheritance (fara'id) and zakat calculators.
 * ALL fetch logic for /api/v1/calculators/* lives here — components and
 * hooks never call fetch directly (ADR-0002). Components hold only form
 * state; every number on screen comes from the backend, which enforces
 * the scholar-approved rule-config gate (engineering-contract §15.5:
 * no fiqh rule is hardcoded or inferred client-side).
 *
 * Wire contract (source of truth: backend track, apps/api/app/modules/calculators):
 * - POST /api/v1/calculators/inheritance
 *     {estate_value, madhab, heirs:[{type, count}], save_case?}
 *     → 200 {shares:[{heir_type, count, share_fraction, amount}],
 *              applied_rule_version, notes: LocalizedText[]}
 *     → 409 {error:{code:"rules_not_approved",…}} when no scholar-approved
 *            rule config is active for the madhab — the UI renders the
 *            honest pending state, never a raw error.
 * - POST /api/v1/calculators/zakat
 *     {assets:{gold_grams, silver_grams, cash, bank_deposits, trade_goods,
 *              receivables, investments}, debts, madhab}
 *     → 200 {zakat_due, zakatable_total, nisab:{threshold, price_per_gram,
 *              fetched_at, stale, currency}, applied_rule_version}
 *     → 409 as above.
 * - GET /api/v1/calculators/zakat/nisab-rate
 *     → 200 {threshold, price_per_gram, fetched_at, stale, currency}
 *            (also 409 rules_not_approved — the badge then shows "pending").
 *
 * Base URL: NEXT_PUBLIC_API_URL (browser-safe) falling back to localhost.
 */

import { apiBaseUrl } from './api-base';
export type MadhabKey = 'hanafi' | 'maliki' | 'shafi' | 'hanbali';

export const MADHABS: MadhabKey[] = ['hanafi', 'maliki', 'shafi', 'hanbali'];

/**
 * Canonical heir-type wire keys sent to the backend. Labels are localized
 * via the `calculators.heirTypes` i18n namespace; the keys themselves are
 * the backend's contract (not translated).
 */
export const HEIR_TYPES = [
  'husband',
  'wife',
  'father',
  'mother',
  'son',
  'daughter',
  'sons_son',
  'sons_daughter',
  'paternal_grandfather',
  'paternal_grandmother',
  'maternal_grandmother',
  'full_brother',
  'full_sister',
  'paternal_brother',
  'paternal_sister',
  'maternal_brother',
  'maternal_sister',
] as const;

export type HeirType = (typeof HEIR_TYPES)[number];

export interface HeirRow {
  type: HeirType;
  count: number;
}

export interface InheritanceShare {
  heir_type: string;
  count: number;
  /** Backend renders this as a localized fraction string, e.g. "⅛" or "1/8". */
  share_fraction: string;
  amount: number;
}

export interface InheritanceResult {
  shares: InheritanceShare[];
  applied_rule_version: string;
  notes: string[];
  /** Present when the caller asked to persist the case (save_case=true). */
  case_id?: string | null;
}

export const ZAKAT_ASSET_KEYS = [
  'gold_grams',
  'silver_grams',
  'cash',
  'bank_deposits',
  'trade_goods',
  'receivables',
  'investments',
] as const;

export type ZakatAssetKey = (typeof ZAKAT_ASSET_KEYS)[number];

export type ZakatAssets = Record<ZakatAssetKey, number>;

export interface NisabRate {
  threshold: number;
  price_per_gram: number;
  fetched_at: string;
  stale: boolean;
  currency: string;
  /** 'ok' | 'price_unavailable' — mirrors the backend nisab-rate status. */
  status: string;
}

export interface ZakatResult {
  zakat_due: number;
  zakatable_total: number;
  debts: number;
  nisab: NisabRate;
  applied_rule_version: string;
  /** The rate the backend used, e.g. "2.5% — per approved rule config". */
  rate_note: string;
}

/* ------------------------------------------------------------------ */
/* Error                                                                */
/* ------------------------------------------------------------------ */

export class CalculatorsApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = 'CalculatorsApiError';
    this.status = status;
    this.code = code;
  }
  /** True when the backend has no scholar-approved rules for this madhab. */
  get rulesNotApproved(): boolean {
    return (
      (this.status === 409 || this.status === 422) &&
      this.code === 'rules_not_approved'
    );
  }
}

function apiBase(): string {
  return apiBaseUrl();
}

async function throwForStatus(res: Response, path: string): Promise<never> {
  let code: string | null = null;
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = typeof j?.error?.code === 'string' ? j.error.code : null;
    detail = typeof j?.error?.message === 'string' ? j.error.message : '';
  } catch {
    /* non-JSON error body */
  }
  throw new CalculatorsApiError(detail || `${path} → ${res.status}`, res.status, code);
}

async function postJson<T>(
  path: string,
  body: unknown,
  init: { token?: string | null; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new CalculatorsApiError(`API unreachable at ${apiBase()}`, 0);
  }
  if (!res.ok) await throwForStatus(res, `POST ${path}`);
  return (await res.json()) as T;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new CalculatorsApiError(`API unreachable at ${apiBase()}`, 0);
  }
  if (!res.ok) await throwForStatus(res, `GET ${path}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Wire-shape normalization (defensive — never fabricate values)        */
/* ------------------------------------------------------------------ */

function asNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asShare(raw: unknown): InheritanceShare | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.heir_type !== 'string') return null;
  return {
    heir_type: o.heir_type,
    count: Math.max(1, Math.floor(asNumber(o.count)) || 1),
    share_fraction: asString(o.share_fraction),
    amount: asNumber(o.amount),
  };
}

function asNisab(o: Record<string, unknown>): NisabRate {
  return {
    threshold: asNumber(o.threshold),
    price_per_gram: asNumber(o.price_per_gram),
    fetched_at: asString(o.fetched_at),
    stale: o.stale === true,
    currency: asString(o.currency),
    status: asString(o.status) || 'ok',
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * POST /api/v1/calculators/inheritance.
 * Throws CalculatorsApiError — check `err.rulesNotApproved` for the
 * honest pending state.
 */
export async function calculateInheritance(
  estateValue: number,
  madhab: MadhabKey,
  heirs: HeirRow[],
  opts: { signal?: AbortSignal } = {},
): Promise<InheritanceResult> {
  const body = await postJson<unknown>(
    '/api/v1/calculators/inheritance',
    {
      estate_value: estateValue,
      madhab,
      heirs: heirs.map((h) => ({ type: h.type, count: h.count })),
    },
    { signal: opts.signal },
  );
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    shares: Array.isArray(o.shares)
      ? o.shares.map(asShare).filter((s): s is InheritanceShare => s !== null)
      : [],
    applied_rule_version: asString(o.applied_rule_version),
    notes: Array.isArray(o.notes)
      ? o.notes.filter((n): n is string => typeof n === 'string')
      : [],
  };
}

/**
 * POST /api/v1/calculators/zakat.
 */
export async function calculateZakat(
  assets: ZakatAssets,
  debts: number,
  madhab: MadhabKey,
  opts: { signal?: AbortSignal } = {},
): Promise<ZakatResult> {
  const body = await postJson<unknown>(
    '/api/v1/calculators/zakat',
    { assets, debts, madhab },
    { signal: opts.signal },
  );
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    zakat_due: asNumber(o.zakat_due),
    zakatable_total: asNumber(o.zakatable_total),
    debts: asNumber(o.debts ?? debts),
    nisab: asNisab((o.nisab ?? {}) as Record<string, unknown>),
    applied_rule_version: asString(o.applied_rule_version),
    rate_note: asString(o.rate_note),
  };
}

/**
 * GET /api/v1/calculators/zakat/nisab-rate — cached rate + staleness.
 * Throws CalculatorsApiError (409 rules_not_approved → pending badge).
 */
export async function getNisabRate(signal?: AbortSignal): Promise<NisabRate> {
  const body = await getJson<unknown>('/api/v1/calculators/zakat/nisab-rate', signal);
  return asNisab((body ?? {}) as Record<string, unknown>);
}

/**
 * Persist a case for the logged-in user: same inheritance endpoint with
 * `save_case: true`, authenticated via the web session token.
 */
export async function saveInheritanceCase(
  token: string,
  estateValue: number,
  madhab: MadhabKey,
  heirs: HeirRow[],
  opts: { signal?: AbortSignal } = {},
): Promise<InheritanceResult> {
  const body = await postJson<unknown>(
    '/api/v1/calculators/inheritance',
    {
      estate_value: estateValue,
      madhab,
      heirs: heirs.map((h) => ({ type: h.type, count: h.count })),
      save_case: true,
    },
    { token, signal: opts.signal },
  );
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    shares: Array.isArray(o.shares)
      ? o.shares.map(asShare).filter((s): s is InheritanceShare => s !== null)
      : [],
    applied_rule_version: asString(o.applied_rule_version),
    notes: Array.isArray(o.notes)
      ? o.notes.filter((n): n is string => typeof n === 'string')
      : [],
    case_id: typeof o.case_id === 'string' ? o.case_id : null,
  };
}

/* ------------------------------------------------------------------ */
/* Pure formatting helpers (no business logic — presentation only)      */
/* ------------------------------------------------------------------ */

function intlLocale(locale: string): string {
  return locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fa-IR';
}

/** Grouped amount, e.g. ۱۲٬۵۰۰٬۰۰۰ in fa-IR. Pure presentation. */
export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 2,
  }).format(value);
}

/** Localized ISO-ish date for the nisab rate freshness badge. */
export function formatRateDate(iso: string, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/**
 * Parse the estate/number text fields: accepts Latin and Arabic-Indic
 * digits, strips grouping separators. Returns null when unparsable.
 */
export function parseDecimalInput(raw: string): number | null {
  if (!raw) return null;
  const normalized = raw
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
