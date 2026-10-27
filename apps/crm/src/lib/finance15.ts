import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiUrl, getAccessToken } from "./api";
import { EMPTY_L10N, type LocalizedText } from "./contentApi";
import type { Locale } from "./i18n";

/**
 * Phase 15 — Track 3 (CRM): finance service layer.
 *
 * All business logic / API access for the Finance section lives here
 * (ADR-001: no domain logic inside components). `pages/Finance.tsx` only
 * renders and delegates.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ API CONTRACT (Track 1 — backend — reconcile on delivery)        │
 * │ Base: /api/v1/admin/finance · auth: Bearer <redacted> · errors: §1  │
 * │ Permission: finance.manage (seeded) — server enforces           │
 * │ Idempotency-Key REQUIRED on POST/DELETE (contract §1; §4 note   │
 * │ on payments: the header de-dupes the REQUEST, event_id de-dupes │
 * │ the EVENT — donation.completed consumers must check event_id)   │
 * │                                                                 │
 * │  GET  /campaigns                            → {items: Campaign[]} │
 * │  POST /campaigns {title(L10n), description(L10n),               │
 * │       goal_amount, currency, active}         → Campaign          │
 * │  PATCH /campaigns/{id} {…same fields}       → Campaign          │
 * │  GET  /donations?cursor=&limit=              → {items, next_cursor}│
 * │  GET  /ledger?cursor=&limit=                → {items, next_cursor} │
 * │  GET  /reconcile                            → {items: Mismatch[]}  │
 * │  POST /reconcile/{id}/resolve {resolution, note} → Mismatch      │
 * │  GET  /gateways                             → {zarinpal:{configured},│
 * │       idpay:{configured}}  — NEVER secret values (contract §3)   │
 * │  GET  /receipts/{donation_id}               → PDF download        │
 * │                                                                 │
 * │ donation.completed domain event (contract §4) via the Phase-2   │
 * │ /ws/events feed: {donation_id, campaign_id, amount, currency,    │
 * │  gateway, gateway_reference, donor_name?, created_at}            │
 * │ Metabase revenue dashboards (Phase 14 BI): linked from the CRM,  │
 * │ never rebuilt (lib/ops14 useMetabaseUrl).                        │
 * └─────────────────────────────────────────────────────────────────┘
 */

const BASE = "/api/v1/admin/finance";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Campaign {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  goal_amount: number;
  raised_amount: number;
  currency: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type DonationGateway = "zarinpal" | "idpay" | "manual";
export type DonationStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface Donation {
  id: string;
  donor_id: string | null;
  donor_name: string | null;
  campaign_id: string | null;
  campaign_title: LocalizedText | null;
  amount: number;
  currency: string;
  gateway: DonationGateway;
  gateway_reference: string | null;
  status: DonationStatus;
  created_at: string;
}

export type LedgerKind = "donation_in" | "refund_out" | "adjustment";

export interface LedgerEntry {
  id: string;
  donation_id: string | null;
  kind: LedgerKind;
  amount: number;
  currency: string;
  description: string;
  created_at: string;
}

export type MismatchStatus = "open" | "resolved";
export type MismatchResolution = "acknowledged" | "adjusted";

export interface ReconcileMismatch {
  id: string;
  donation_id: string;
  gateway_reference: string | null;
  internal_amount: number;
  gateway_amount: number | null;
  currency: string;
  reason: string;
  status: MismatchStatus;
  created_at: string;
}

export interface GatewayStatus {
  zarinpal: { configured: boolean };
  idpay: { configured: boolean };
}

export interface CampaignInput {
  title: LocalizedText;
  description: LocalizedText;
  goal_amount: number;
  currency: string;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Small pure helpers (no components)                                  */
/* ------------------------------------------------------------------ */

/** Render a LocalizedText for the active CRM locale (fa → fa, ar → ar …). */
export function l10nText(l: LocalizedText | null | undefined, locale: Locale): string {
  if (!l) return "";
  return l[locale] || l.fa || l.en || l.ar || "";
}

/** Minor units → display string, e.g. 250000 IRR. Never a formatter — plain text. */
export function money(amount: number, currency: string): string {
  const code = (currency || "").toUpperCase();
  return `${amount.toLocaleString("en-US")}${code ? ` ${code}` : ""}`;
}

/** Raised/goal percentage, clamped 0–100 (pure display math). */
export function raisedPct(c: Campaign): number {
  if (c.goal_amount <= 0) return 0;
  const p = (c.raised_amount / c.goal_amount) * 100;
  return Math.max(0, Math.min(100, p));
}

/** Receipt PDF download URL (public path; Bearer-required, owner-or-admin).
 *  Plain <a> cannot send the Bearer <redacted> — use downloadReceipt() instead. */
export function receiptUrl(donationId: string): string {
  return `${apiUrl()}/api/v1/finance/receipts/${encodeURIComponent(donationId)}`;
}

/** Download a receipt PDF with the CRM access token (blob → object URL). */
export async function downloadReceipt(donationId: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(receiptUrl(donationId), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`receipt_download_failed_${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${donationId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Extract a readable message from any thrown error. */
export function errText(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Fresh Idempotency-Key for sensitive writes (contract §1). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `crm-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/* ------------------------------------------------------------------ */
/* Defensive parsers (API shape → typed)                               */
/* ------------------------------------------------------------------ */

function asL10n(raw: unknown): LocalizedText {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const s = (v: unknown): string => (typeof v === "string" ? v : "");
    return { fa: s(r.fa), ar: s(r.ar), en: s(r.en) };
  }
  return EMPTY_L10N;
}

function asStr(raw: unknown, fallback = ""): string {
  return typeof raw === "string" ? raw : fallback;
}

function asNum(raw: unknown, fallback = 0): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function parseCampaign(raw: unknown): Campaign {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asStr(r.id),
    title: asL10n(r.title),
    description: asL10n(r.description),
    goal_amount: asNum(r.goal_amount),
    raised_amount: asNum(r.raised_amount),
    currency: asStr(r.currency, "IRR").toUpperCase(),
    active: r.active !== false,
    created_at: asStr(r.created_at),
    updated_at: asStr(r.updated_at),
  };
}

function parseDonation(raw: unknown): Donation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const gw = asStr(r.gateway);
  const st = asStr(r.status);
  return {
    id: asStr(r.id),
    donor_id: typeof r.donor_id === "string" ? r.donor_id : null,
    donor_name: typeof r.donor_name === "string" ? r.donor_name : null,
    campaign_id: typeof r.campaign_id === "string" ? r.campaign_id : null,
    campaign_title: r.campaign_title ? asL10n(r.campaign_title) : null,
    amount: asNum(r.amount),
    currency: asStr(r.currency, "IRR").toUpperCase(),
    gateway: gw === "idpay" || gw === "manual" ? gw : "zarinpal",
    gateway_reference: typeof r.gateway_reference === "string" ? r.gateway_reference : null,
    status:
      st === "pending" || st === "failed" || st === "refunded" ? st : "succeeded",
    created_at: asStr(r.created_at),
  };
}

function parseLedgerEntry(raw: unknown): LedgerEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = asStr(r.kind);
  return {
    id: asStr(r.id),
    donation_id: typeof r.donation_id === "string" ? r.donation_id : null,
    kind: kind === "refund_out" || kind === "adjustment" ? kind : "donation_in",
    amount: asNum(r.amount),
    currency: asStr(r.currency, "IRR").toUpperCase(),
    description: asStr(r.description),
    created_at: asStr(r.created_at),
  };
}

function parseMismatch(raw: unknown): ReconcileMismatch {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asStr(r.id),
    donation_id: asStr(r.donation_id),
    gateway_reference: typeof r.gateway_reference === "string" ? r.gateway_reference : null,
    internal_amount: asNum(r.internal_amount),
    gateway_amount: typeof r.gateway_amount === "number" ? r.gateway_amount : null,
    currency: asStr(r.currency, "IRR").toUpperCase(),
    reason: asStr(r.reason),
    status: asStr(r.status) === "resolved" ? "resolved" : "open",
    created_at: asStr(r.created_at),
  };
}

function parseGatewayStatus(raw: unknown): GatewayStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const one = (v: unknown): { configured: boolean } => {
    const o = (v ?? {}) as Record<string, unknown>;
    return { configured: o.configured === true };
  };
  return { zarinpal: one(r.zarinpal), idpay: one(r.idpay) };
}

function itemsOf<T>(raw: unknown, parse: (v: unknown) => T): T[] {
  // The admin finance list endpoints return a bare array (e.g. GET
  // /campaigns -> list[CampaignOut]); other lists return {items, ...}.
  // Accept both: previously a bare array was read as {items: undefined}
  // and every list rendered empty even when rows existed.
  if (Array.isArray(raw)) return raw.map(parse);
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  return items.map(parse);
}

function cursorOf(raw: unknown): string | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  return typeof r.next_cursor === "string" && r.next_cursor !== "" ? r.next_cursor : null;
}

/* ------------------------------------------------------------------ */
/* Queries / mutations                                                 */
/* ------------------------------------------------------------------ */

const QK = "finance15";

export function useCampaigns() {
  return useQuery({
    queryKey: [QK, "campaigns"],
    queryFn: async (): Promise<Campaign[]> => {
      const raw = await apiFetch<unknown>(`${BASE}/campaigns`);
      return itemsOf(raw, parseCampaign);
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CampaignInput): Promise<Campaign> => {
      const raw = await apiFetch<unknown>(`${BASE}/campaigns`, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: {
          title: input.title,
          description: input.description,
          goal_amount: input.goal_amount,
          currency: input.currency,
          active: input.active,
        },
      });
      return parseCampaign(raw);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [QK, "campaigns"] });
    },
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CampaignInput & { id: string }): Promise<Campaign> => {
      const raw = await apiFetch<unknown>(`${BASE}/campaigns/${encodeURIComponent(input.id)}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: {
          title: input.title,
          description: input.description,
          goal_amount: input.goal_amount,
          currency: input.currency,
          active: input.active,
        },
      });
      return parseCampaign(raw);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [QK, "campaigns"] });
    },
  });
}

/** Cursor-paginated donations list (contract §1 — cursor, not offset). */
export function useDonations(cursor: string | null, limit = 25) {
  return useQuery({
    queryKey: [QK, "donations", cursor, limit],
    queryFn: async (): Promise<{ items: Donation[]; nextCursor: string | null }> => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      const raw = await apiFetch<unknown>(`${BASE}/donations?${params.toString()}`);
      return { items: itemsOf(raw, parseDonation), nextCursor: cursorOf(raw) };
    },
    retry: false,
    staleTime: 15_000,
  });
}

export function useLedger(cursor: string | null, limit = 25) {
  return useQuery({
    queryKey: [QK, "ledger", cursor, limit],
    queryFn: async (): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      const raw = await apiFetch<unknown>(`${BASE}/ledger?${params.toString()}`);
      return { items: itemsOf(raw, parseLedgerEntry), nextCursor: cursorOf(raw) };
    },
    retry: false,
    staleTime: 15_000,
  });
}

export function useReconcile() {
  return useQuery({
    queryKey: [QK, "reconcile"],
    queryFn: async (): Promise<ReconcileMismatch[]> => {
      const raw = await apiFetch<unknown>(`${BASE}/reconcile`);
      return itemsOf(raw, parseMismatch);
    },
    retry: false,
    staleTime: 15_000,
  });
}

export function useResolveMismatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      resolution: MismatchResolution;
      note: string;
    }): Promise<ReconcileMismatch> => {
      const raw = await apiFetch<unknown>(
        `${BASE}/reconcile/${encodeURIComponent(input.id)}/resolve`,
        {
          method: "POST",
          headers: { "Idempotency-Key": newIdempotencyKey() },
          body: { resolution: input.resolution, note: input.note },
        },
      );
      return parseMismatch(raw);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [QK, "reconcile"] });
      void qc.invalidateQueries({ queryKey: [QK, "donations"] });
      void qc.invalidateQueries({ queryKey: [QK, "ledger"] });
    },
  });
}

/**
 * Gateway configuration status — configured/not only (§3: NEVER values).
 * The values live in platform_settings `payment.zarinpal_key` /
 * `payment.idpay_key` (encrypted, server-side only).
 */
export function useGatewayStatus() {
  return useQuery({
    queryKey: [QK, "gateways"],
    queryFn: async (): Promise<GatewayStatus> => {
      const raw = await apiFetch<unknown>(`${BASE}/gateways`);
      return parseGatewayStatus(raw);
    },
    retry: false,
    staleTime: 60_000,
  });
}

/** Payload shape of the donation.completed domain event (contract §4). */
export interface DonationCompletedPayload {
  donation_id: string;
  campaign_id: string | null;
  amount: number;
  currency: string;
  gateway: string;
  gateway_reference: string | null;
  donor_name: string | null;
  created_at: string;
}

export function parseDonationEvent(
  payload: Record<string, unknown>,
): DonationCompletedPayload | null {
  const r = payload;
  if (typeof r.donation_id !== "string") return null;
  return {
    donation_id: r.donation_id,
    campaign_id: typeof r.campaign_id === "string" ? r.campaign_id : null,
    amount: typeof r.amount === "number" ? r.amount : 0,
    currency: typeof r.currency === "string" ? r.currency.toUpperCase() : "IRR",
    gateway: typeof r.gateway === "string" ? r.gateway : "",
    gateway_reference: typeof r.gateway_reference === "string" ? r.gateway_reference : null,
    donor_name: typeof r.donor_name === "string" ? r.donor_name : null,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}
