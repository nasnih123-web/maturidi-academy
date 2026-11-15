/**
 * Browser-safe finance client (client components / hooks only).
 * Never imported from RSC — uses NEXT_PUBLIC_API_URL.
 *
 * The donate POST carries a client-generated `Idempotency-Key` header
 * (contract §1). The key is generated once per form session and REUSED on
 * every retry/resubmit of the same attempt — a double-click on «پرداخت»
 * therefore creates exactly one payment intent server-side.
 */

import { apiBaseUrl } from './api-base';
export class DonateApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'DonateApiError';
    this.status = status;
  }
}

function apiBase(): string {
  return apiBaseUrl();
}

export interface DonateIntent {
  intentId: string;
  authority: string;
  payUrl: string;
}

export interface DonateRequest {
  campaignId: string;
  /** Whole TOMAN, integer — converted to rials (×10) for the API. */
  amountToman: number;
  donorName?: string;
  /** Where the gateway returns the user after payment. */
  callbackUrl: string;
  idempotencyKey: string;
}

function parseIntent(body: unknown): DonateIntent | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const intentId = typeof o.intent_id === 'string' ? o.intent_id : '';
  const authority = typeof o.authority === 'string' ? o.authority : '';
  const payUrl = typeof o.pay_url === 'string' ? o.pay_url : '';
  if (!intentId || !authority || !payUrl) return null;
  return { intentId, authority, payUrl };
}

/**
 * Create a payment intent. Idempotent server-side via the Idempotency-Key
 * header — safe to call again with the SAME key after a network failure.
 * Amounts go to the API in RIALS (IRR), converted from the UI's toman.
 * Throws DonateApiError on unreachable API or non-2xx.
 */
export async function createDonateIntent(req: DonateRequest): Promise<DonateIntent> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/finance/donate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': req.idempotencyKey,
      },
      body: JSON.stringify({
        campaign_id: req.campaignId,
        amount: req.amountToman * 10, // toman → rials (backend speaks IRR)
        currency: 'IRR',
        donor_name: req.donorName?.trim() ? req.donorName.trim() : null,
        callback_url: req.callbackUrl,
      }),
    });
  } catch (err) {
    throw new DonateApiError(
      `donate unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      const b = (await res.json()) as Record<string, unknown>;
      const e = b.error as Record<string, unknown> | undefined;
      detail = typeof e?.message === 'string' ? e.message : typeof b.message === 'string' ? b.message : '';
    } catch {
      /* non-JSON error body */
    }
    throw new DonateApiError(`POST /api/v1/finance/donate → ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  const intent = parseIntent(await res.json());
  if (!intent) throw new DonateApiError('POST /api/v1/finance/donate → unparseable', 502);
  return intent;
}

export interface CallbackVerification {
  intentId: string;
  /** 'succeeded' | 'failed' | 'pending' — backend-verified with the gateway. */
  status: string;
  donationId: string | null;
  gatewayReference: string | null;
}

/**
 * Verify the gateway return server-side: GET /api/v1/finance/callback
 * re-verifies the payment with ZarinPal and finalizes the donation
 * (re-entrant — safe to call twice). This is the source of truth for the
 * result page, not the query params alone.
 * Throws DonateApiError (404 = unknown authority).
 */
export async function verifyCallback(authority: string, status: string): Promise<CallbackVerification> {
  const params = new URLSearchParams({ Authority: authority, Status: status });
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/finance/callback?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new DonateApiError(
      `callback unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new DonateApiError(`GET /api/v1/finance/callback → ${res.status}`, res.status);
  }
  const o = (await res.json()) as Record<string, unknown>;
  return {
    intentId: typeof o.intent_id === 'string' ? o.intent_id : '',
    status: typeof o.status === 'string' ? o.status : 'unknown',
    donationId: typeof o.donation_id === 'string' ? o.donation_id : null,
    gatewayReference: typeof o.gateway_reference === 'string' ? o.gateway_reference : null,
  };
}

/**
 * Download the trilingual receipt PDF. The endpoint requires auth
 * (donation owner or finance.manage) — the caller supplies the bearer token.
 * Returns a Blob the caller turns into a download; never a bare URL, because
 * a plain <a href> cannot carry the Authorization header.
 * Throws DonateApiError (401/403 when the viewer may not see the receipt).
 */
export async function downloadReceiptPdf(donationId: string, accessToken: string | null): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/finance/receipts/${encodeURIComponent(donationId)}`, {
      headers: {
        Accept: 'application/pdf',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  } catch (err) {
    throw new DonateApiError(
      `receipt unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new DonateApiError(`GET /api/v1/finance/receipts/${donationId} → ${res.status}`, res.status);
  }
  return res.blob();
}

/* ------------------------------------------------------------------ */
/* روش‌های حمایت + حمایت دستی (کارت‌به‌کارت / کریپتو / PayPal)          */
/* ------------------------------------------------------------------ */

export interface LocalizedText {
  fa: string;
  ar: string;
  en: string;
}

export interface CryptoWallet {
  currency: string;
  network: string;
  address: string;
}

export interface DonationMethod {
  method: 'online' | 'card' | 'crypto' | 'paypal';
  title: LocalizedText;
  instructions: LocalizedText | null;
  currency: string | null;
  gateways: string[];
  cardNumber: string | null;
  cardHolder: string | null;
  wallets: CryptoWallet[];
  paypalAccount: string | null;
}

/**
 * GET /api/v1/finance/donation-methods — only methods that are enabled
 * AND fully configured server-side are returned; a disabled method is
 * simply absent (never rendered, never submittable).
 */
export async function getDonationMethods(): Promise<DonationMethod[]> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/finance/donation-methods`, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new DonateApiError(
      `donation-methods unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new DonateApiError(`GET /api/v1/finance/donation-methods → ${res.status}`, res.status);
  }
  const body = (await res.json()) as { methods?: unknown[] };
  const list = Array.isArray(body.methods) ? body.methods : [];
  return list.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const lt = (v: unknown): LocalizedText | null =>
      v && typeof v === 'object'
        ? {
            fa: String((v as Record<string, unknown>).fa ?? ''),
            ar: String((v as Record<string, unknown>).ar ?? ''),
            en: String((v as Record<string, unknown>).en ?? ''),
          }
        : null;
    return {
      method: (typeof o.method === 'string' ? o.method : 'online') as DonationMethod['method'],
      title: lt(o.title) ?? { fa: '', ar: '', en: '' },
      instructions: lt(o.instructions),
      currency: typeof o.currency === 'string' ? o.currency : null,
      gateways: Array.isArray(o.gateways) ? (o.gateways as string[]) : [],
      cardNumber: typeof o.card_number === 'string' ? o.card_number : null,
      cardHolder: typeof o.card_holder === 'string' ? o.card_holder : null,
      wallets: Array.isArray(o.wallets)
        ? (o.wallets as Record<string, unknown>[]).map((w) => ({
            currency: String(w.currency ?? ''),
            network: String(w.network ?? ''),
            address: String(w.address ?? ''),
          }))
        : [],
      paypalAccount: typeof o.paypal_account === 'string' ? o.paypal_account : null,
    };
  });
}

export interface ManualDonationRequest {
  method: 'card' | 'crypto' | 'paypal';
  /** Whole units of the method currency (IRR for card — caller converts). */
  amount: number;
  campaignId?: string;
  donorName?: string;
  proofText?: string;
  walletCurrency?: string;
  walletNetwork?: string;
  receiptFile?: File | null;
}

export interface ManualDonationResult {
  id: string;
  status: string;
}

/**
 * POST /api/v1/finance/donate/manual (multipart) — records the donation
 * as PENDING; it is finalised only after an admin reviews the proof in
 * the CRM. Throws DonateApiError on non-2xx (403 = method disabled).
 */
export async function submitManualDonation(req: ManualDonationRequest): Promise<ManualDonationResult> {
  const fd = new FormData();
  fd.set('method', req.method);
  fd.set('amount', String(req.amount));
  if (req.campaignId) fd.set('campaign_id', req.campaignId);
  if (req.donorName?.trim()) fd.set('donor_name', req.donorName.trim());
  if (req.proofText?.trim()) fd.set('proof_text', req.proofText.trim());
  if (req.walletCurrency) fd.set('wallet_currency', req.walletCurrency);
  if (req.walletNetwork) fd.set('wallet_network', req.walletNetwork);
  if (req.receiptFile) fd.set('receipt', req.receiptFile);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/finance/donate/manual`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: fd,
    });
  } catch (err) {
    throw new DonateApiError(
      `manual donate unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      const b = (await res.json()) as Record<string, unknown>;
      const e = b.error as Record<string, unknown> | undefined;
      detail = typeof e?.message === 'string' ? e.message : '';
    } catch {
      /* non-JSON error body */
    }
    throw new DonateApiError(
      `POST /api/v1/finance/donate/manual → ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status,
    );
  }
  const o = (await res.json()) as Record<string, unknown>;
  return {
    id: typeof o.id === 'string' ? o.id : '',
    status: typeof o.status === 'string' ? o.status : 'pending',
  };
}

/** Generate a fresh idempotency key (UUID v4, crypto-backed). */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts — still unique enough for idempotency.
  const rnd = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().substring(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

/** Pending intent kept across the gateway redirect (same tab). */
export interface PendingDonation {
  campaignId: string;
  campaignTitle: string;
  /** Whole toman (UI unit). */
  amount: number;
  donorName: string | null;
  intentId: string;
  authority: string;
  idempotencyKey: string;
  createdAt: number;
}

const PENDING_KEY = 'ma.pendingDonations.v1';

function readPending(): PendingDonation[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as PendingDonation[]) : [];
  } catch {
    return [];
  }
}

export function savePendingDonation(p: PendingDonation): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const list = readPending().filter((x) => x.authority !== p.authority);
    list.push(p);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-10)));
  } catch {
    /* storage unavailable — flow still works, result page just won't prefill */
  }
}

/** Match the gateway's return Authority against the pending intent. */
export function findPendingDonation(authority: string): PendingDonation | null {
  return readPending().find((x) => x.authority === authority) ?? null;
}

/** The idempotency key of a pending intent for this campaign (if any) — lets a
 * reloaded form session keep reusing the same key instead of minting a new one. */
export function findPendingKeyForCampaign(campaignId: string): string | null {
  const hit = readPending().find((x) => x.campaignId === campaignId);
  return hit ? hit.idempotencyKey : null;
}

export function clearPendingDonation(authority: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify(readPending().filter((x) => x.authority !== authority)),
    );
  } catch {
    /* ignore */
  }
}
