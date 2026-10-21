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

/** Localized fraction display ("7/12" → "۷/۱۲"). Presentation only. */
export function formatFraction(share: string, locale: string): string {
  const nf = new Intl.NumberFormat(intlLocale(locale), { useGrouping: false });
  return share
    .split('/')
    .map((part) => {
      const n = Number(part);
      return Number.isFinite(n) ? nf.format(n) : part;
    })
    .join('/');
}

/* ------------------------------------------------------------------ */
/* Phase 4 — source calculators (extended zakat / miras / mosaref)      */
/*                                                                      */
/* All three endpoints are stateless: the backend never persists the    */
/* financial/family inputs. Zakat-extended and miras sit behind the     */
/* same scholar-review gate as Phase 7 (rules_not_approved → pending    */
/* state). Mosaref is linguistics, fully public.                        */
/* ------------------------------------------------------------------ */

export interface ZakatExtendedRequest {
  money?: { amount: number; coin_price: number };
  gold_grams?: number;
  silver_grams?: number;
  sheep?: number;
  cows?: { count: number; musinna_price?: number };
  camels?: number;
  horses?: { count: number; total_value?: number };
  oshr?: { amount_kg: number; irrigation: 'rain_fed' | 'irrigated' };
  khoms?: { amount: number };
}

export interface ZakatDueItem {
  kind: string;
  count: number;
  age_years?: number;
}

export interface ZakatExtendedSections {
  money?: {
    nisab_met: boolean;
    total_coins: string;
    zakat_coins: string;
    zakat_amount: string;
  };
  gold?: { nisab_met: boolean; zakat_grams: string };
  silver?: { nisab_met: boolean; zakat_grams: string };
  sheep?: { due: ZakatDueItem[] };
  cows?: { due: ZakatDueItem[]; musinna_fortieths: number; extra_money?: string };
  camels?: { due: ZakatDueItem[] };
  horses?: {
    rule_note: string;
    dinar_per_head: number;
    total_dinar: number;
    value_zakat?: string;
  };
  oshr?: { oshr_kg: string };
  khoms?: { khoms: string };
}

export interface ZakatExtendedResult {
  sections: ZakatExtendedSections;
  applied_rule_version: string;
}

export async function calculateZakatExtended(
  request: ZakatExtendedRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<ZakatExtendedResult> {
  const body = await postJson<unknown>('/api/v1/calculators/zakat/extended', request, {
    signal: opts.signal,
  });
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    sections: (o.sections ?? {}) as ZakatExtendedSections,
    applied_rule_version: String(o.applied_rule_version ?? ''),
  };
}

export interface MirasRequest {
  gender: 'male' | 'female';
  husband?: boolean;
  father?: boolean;
  mother?: boolean;
  grandfather?: boolean;
  mgm?: boolean;
  pgm?: boolean;
  wives?: number;
  sons?: number;
  daughters?: number;
  son_sons?: number;
  son_daughters?: number;
  brothers?: number;
  sisters?: number;
  paternal_brothers?: number;
  paternal_sisters?: number;
  uterine_brothers?: number;
  uterine_sisters?: number;
  full_brother_sons?: number;
  paternal_brother_sons?: number;
  full_uncles?: number;
  paternal_uncles?: number;
  full_uncle_sons?: number;
  paternal_uncle_sons?: number;
  daughter_sons?: number;
  daughter_daughters?: number;
  son_daughter_sons?: number;
  son_daughter_daughters?: number;
  maternal_grandfather?: number;
  remote_grandmothers?: number;
  sister_sons?: number;
  sister_daughters?: number;
  full_brother_daughters?: number;
  paternal_brother_daughters?: number;
  uterine_brother_children?: number;
  uterine_sister_children?: number;
  maternal_uncles?: number;
  maternal_aunts?: number;
  maternal_paternal_uncles?: number;
  paternal_aunts?: number;
  paternal_uncle_daughters?: number;
  estate_value: number;
  funeral?: number;
  debt?: number;
  will?: number;
  will_for_heir?: boolean;
  will_approved?: boolean;
  impediments?: {
    religion_mixed?: boolean;
    killer?: boolean;
    simultaneous_death?: boolean;
    slavery?: boolean;
  };
}

export interface MirasRow {
  key: string;
  count: number;
  share: string;
  amount: string;
  per_person_amount: string;
  asaba_part?: string | null;
}

export interface MirasResult {
  status: 'computed' | 'stopped';
  stop_code?: string | null;
  estate_value?: string | null;
  funeral?: string | null;
  debt?: string | null;
  will_applied?: string | null;
  net_estate?: string | null;
  awl: boolean;
  radd: boolean;
  rows: MirasRow[];
  blocked: string[];
  notes: string[];
  applied_rule_version: string;
}

export async function calculateMiras(
  request: MirasRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<MirasResult> {
  const body = await postJson<unknown>('/api/v1/calculators/inheritance/miras', request, {
    signal: opts.signal,
  });
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    status: o.status === 'stopped' ? 'stopped' : 'computed',
    stop_code: typeof o.stop_code === 'string' ? o.stop_code : null,
    estate_value: typeof o.estate_value === 'string' ? o.estate_value : null,
    funeral: typeof o.funeral === 'string' ? o.funeral : null,
    debt: typeof o.debt === 'string' ? o.debt : null,
    will_applied: typeof o.will_applied === 'string' ? o.will_applied : null,
    net_estate: typeof o.net_estate === 'string' ? o.net_estate : null,
    awl: o.awl === true,
    radd: o.radd === true,
    rows: Array.isArray(o.rows) ? (o.rows as MirasRow[]) : [],
    blocked: Array.isArray(o.blocked) ? (o.blocked as string[]) : [],
    notes: Array.isArray(o.notes) ? (o.notes as string[]) : [],
    applied_rule_version: String(o.applied_rule_version ?? ''),
  };
}

export const MOSAREF_BABS = [
  'faala',
  'faala2',
  'faala3',
  'faala4',
  'faala5',
  'faala6',
  'afala',
  'faala_m',
  'faaala',
  "tafa''ala",
  'tafaaala',
  'infaala',
  'iftaala',
  'istafala',
  'rubaai_mujarrad',
  "rubaai_tafa'lala",
] as const;

export type MosarefBab = (typeof MOSAREF_BABS)[number];
export type MosarefTransitivity = 'mutaadi' | 'laazim';
export type HarfJar = 'bi' | 'li' | 'an' | 'min' | 'ila' | 'ala' | 'fi';

export interface MosarefTable {
  key: string;
  columns: Record<string, string[]>;
}

export interface MosarefResult {
  root: string;
  bab: string;
  transitivity: string;
  harf_jar: string;
  verb_class: string;
  tables: MosarefTable[];
  flags: Record<string, boolean>;
}

export async function conjugateMosaref(
  root: string,
  bab: MosarefBab,
  transitivity: MosarefTransitivity,
  harfJar: HarfJar,
  opts: { signal?: AbortSignal } = {},
): Promise<MosarefResult> {
  const body = await postJson<unknown>(
    '/api/v1/calculators/mosaref',
    { root, bab, transitivity, harf_jar: harfJar },
    { signal: opts.signal },
  );
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    root: asString(o.root),
    bab: asString(o.bab),
    transitivity: asString(o.transitivity),
    harf_jar: asString(o.harf_jar),
    verb_class: asString(o.verb_class),
    tables: Array.isArray(o.tables) ? (o.tables as MosarefTable[]) : [],
    flags: (o.flags ?? {}) as Record<string, boolean>,
  };
}
