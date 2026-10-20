/**
 * sync-runner.ts — Phase 13 client sync engine (web).
 *
 * Drives the IndexedDB outbox (offline-db.ts) against the REAL backend
 * contract (Track 1, apps/api/app/modules/sync, ADR-0010):
 *
 *   push: POST /api/v1/sync/push
 *           ← {device_id, ops:[{client_op_id, entity_type, entity_id,
 *               op_type: "upsert"|"delete", payload, base_version}]}
 *           → {device_id, results:[{client_op_id, status, entity_type,
 *               entity_id, version, conflict_id, detail}]}
 *         status: applied → drop op · conflicted → drop op, count conflict
 *         (server keeps BOTH versions; user resolves in CRM) · rejected →
 *         fail op with detail · pending → stays queued
 *
 *   pull: GET /api/v1/sync/pull?cursor=<int>&device_id=<id>&limit=200
 *           → {device_id, changes:[{seq, entity_type, entity_id,
 *               op_type: "upsert"|"delete", payload, version, device_id,
 *               created_at}], new_cursor}
 *         "delete" changes become local tombstones; "upsert" changes are
 *         broadcast on `window` as `ma:sync-change` for the app layer.
 *
 * Conflict policy mirrors the spec: simple counters/progress → the server
 * applies last-write-wins; user-authored content (ayah notes) is NEVER
 * silently dropped — both versions survive as a conflict the user resolves
 * via POST /api/v1/sync/conflicts/{id}/resolve.
 *
 * Retry/backoff: exponential 1s → 16s per round, max 5 rounds; a failed
 * round releases stuck "sending" rows back to pending. The runner emits
 * state changes the OfflineIndicator subscribes to.
 *
 * No business logic: pure transport + state machine.
 */

"use client";

import {
  ackOps,
  applyTombstone,
  countPendingOps,
  failOps,
  getDeviceId,
  getSyncCursor,
  listPendingOps,
  markOpsSending,
  releaseSending,
  setLastPullAt,
  setSyncCursor,
  type OutboxRow,
} from "./offline-db";

import { apiBaseUrl } from "./api-base";

const API_BASE = apiBaseUrl();

const ACCESS_KEY = "ma.access_token";

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncSnapshot {
  state: SyncState;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  conflicts: number;
}

/** Backend OpStatus vocabulary (ADR-0010). */
export type OpResultStatus = "pending" | "applied" | "conflicted" | "rejected";

export interface OpResult {
  client_op_id: string;
  status: OpResultStatus;
  entity_type: string;
  entity_id: string;
  version: number | null;
  conflict_id: string | null;
  detail: string | null;
}

export interface PullChange {
  seq: number;
  entity_type: string;
  entity_id: string;
  op_type: "upsert" | "delete";
  payload: Record<string, unknown> | null;
  version: number;
  device_id: string | null;
  created_at: string;
}

function authHeader(): Record<string, string> {
  try {
    const token = window.localStorage.getItem(ACCESS_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function readJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) detail = err.error.message;
    } catch {
      /* keep status text */
    }
    const e = new Error(detail) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return res.json();
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
  });
  return readJson(res);
}

async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
  const q = new URLSearchParams(params);
  const res = await fetch(`${API_BASE}/api/v1${path}?${q.toString()}`, {
    headers: authHeader(),
  });
  return readJson(res);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Listener = (snap: SyncSnapshot) => void;

class SyncRunner {
  private listeners = new Set<Listener>();
  private snapshot: SyncSnapshot = {
    state: "idle",
    pending: 0,
    lastSyncAt: null,
    lastError: null,
    conflicts: 0,
  };
  private running = false;
  private started = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): SyncSnapshot {
    return { ...this.snapshot };
  }

  private emit(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) {
      try {
        fn(this.getSnapshot());
      } catch {
        /* listener errors must not break sync */
      }
    }
  }

  /** Wire online/offline events + periodic trigger. Idempotent. */
  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.refreshPending();
    window.addEventListener("online", () => {
      this.emit({ state: "idle", lastError: null });
      void this.syncNow();
    });
    window.addEventListener("offline", () => this.emit({ state: "offline" }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) void this.syncNow();
    });
    this.timer = setInterval(() => {
      if (navigator.onLine) void this.syncNow();
    }, 60_000);
    if (!navigator.onLine) this.emit({ state: "offline" });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  async refreshPending(): Promise<void> {
    const pending = await countPendingOps();
    this.emit({ pending });
  }

  /**
   * One full sync round: push outbox, then pull changes. Safe to call
   * concurrently — overlapping calls collapse into the in-flight round.
   */
  async syncNow(): Promise<void> {
    if (this.running) return;
    if (typeof window === "undefined") return;
    if (!navigator.onLine) {
      this.emit({ state: "offline" });
      return;
    }
    this.running = true;
    this.emit({ state: "syncing", lastError: null });
    try {
      await this.pushWithBackoff();
      await this.pullOnce();
      await this.refreshPending();
      this.emit({ state: "idle", lastSyncAt: new Date().toISOString(), lastError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await releaseSending();
      await this.refreshPending();
      this.emit({
        state: navigator.onLine ? "error" : "offline",
        lastError: message,
      });
    } finally {
      this.running = false;
    }
  }

  private async pushWithBackoff(): Promise<void> {
    const MAX_ROUNDS = 5;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pending: OutboxRow[] = await listPendingOps();
      if (pending.length === 0) return;
      const ids = pending.map((r) => r.id).filter((i): i is number => i != null);
      await markOpsSending(ids);
      try {
        const device_id = await getDeviceId();
        const body = (await postJson("/sync/push", {
          device_id,
          ops: pending.map((r) => ({
            client_op_id: r.client_op_id,
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            op_type: r.op,
            payload: r.payload,
            base_version: r.base_version ?? 0,
          })),
        })) as { results?: OpResult[] };
        const results = body.results ?? [];
        const acked: string[] = [];
        let newConflicts = 0;
        for (const r of results) {
          if (r.status === "applied" || r.status === "conflicted") {
            // conflicted: server kept BOTH versions (user-authored content is
            // never silently dropped) — the conflict lives server-side for
            // manual resolution; the op leaves the queue either way.
            acked.push(r.client_op_id);
            if (r.status === "conflicted") newConflicts++;
          } else if (r.status === "rejected") {
            await failOps([r.client_op_id], r.detail ?? "rejected by server");
          }
          // "pending" → stays queued; releaseSending() returns it to pending.
        }
        await ackOps(acked);
        if (newConflicts > 0) {
          this.emit({ conflicts: this.snapshot.conflicts + newConflicts });
        }
        // Loop: a new op may have been enqueued mid-push.
      } catch (err) {
        await releaseSending();
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403 || status === 422) throw err; // not retryable
        if (round === MAX_ROUNDS - 1) throw err;
        await sleep(Math.min(1000 * 2 ** round, 16_000));
      }
    }
  }

  private async pullOnce(): Promise<void> {
    const device_id = await getDeviceId();
    const cursorRaw = await getSyncCursor();
    const cursor = cursorRaw != null && /^\d+$/.test(cursorRaw) ? cursorRaw : "0";
    const body = (await getJson("/sync/pull", {
      cursor,
      device_id,
      limit: "200",
    })) as { changes?: PullChange[]; new_cursor?: number };
    const changes = body.changes ?? [];
    for (const ch of changes) {
      if (ch.op_type === "delete") {
        await applyTombstone({
          entity_type: ch.entity_type,
          entity_id: ch.entity_id,
          version: ch.version,
          deleted_at: ch.created_at,
        });
      }
      // Upserts and deletes alike are broadcast — the app layer owns its
      // domain caches; this module owns transport only.
      try {
        window.dispatchEvent(new CustomEvent("ma:sync-change", { detail: ch }));
      } catch {
        /* noop */
      }
    }
    if (typeof body.new_cursor === "number") {
      await setSyncCursor(String(body.new_cursor));
    }
    await setLastPullAt(new Date().toISOString());
  }
}

export const syncRunner = new SyncRunner();
