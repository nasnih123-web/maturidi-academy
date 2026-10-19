/**
 * offline-db.ts — IndexedDB local layer (Phase 13, web).
 *
 * Mirrors the backend sync contract (Track 1, apps/api/app/modules/sync —
 * ADR-0010): every local mutation is an outbox row with a `client_op_id`
 * (idempotency key), `entity_type`, `entity_id`, `op` (`upsert`|`delete` —
 * the wire vocab), `payload`, `base_version` and a lifecycle `status`.
 * The sync runner (sync-runner.ts) pushes these to `POST /api/v1/sync/push`
 * with retry/backoff and pulls remote changes from
 * `GET /api/v1/sync/pull?cursor=&device_id=`; deletions arrive as
 * tombstones and are applied here — never silently dropped.
 *
 * Syncable entity types (backend Literal): user_ayah_note, user_progress,
 * dhikr_daily_count.
 *
 * Pure storage module: no React, no network, SSR-safe (every public function
 * no-ops gracefully when IndexedDB is unavailable, e.g. server render or
 * private-mode WebViews).
 */

export type OutboxOp = "upsert" | "delete";
export type OutboxStatus = "pending" | "sending" | "acked" | "failed";

export interface OutboxRow {
  id?: number;
  client_op_id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  op: OutboxOp;
  /** The mutation payload (JSON-serializable). */
  payload: Record<string, unknown>;
  /** Server version the mutation was based on (conflict detection). */
  base_version: number | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TombstoneRow {
  /** `${entity_type}:${entity_id}` */
  id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  deleted_at: string;
  applied_at: string;
}

export interface PackEntry {
  key: string;
  kind: "tier" | "item";
  ref: string;
  cached_at: string;
  etag: string | null;
}

const DB_NAME = "maturidi-offline";
const DB_VERSION = 1;

const KV_CURSOR = "sync.cursor";
const KV_DEVICE_ID = "sync.device_id";
const KV_LAST_PULL = "sync.last_pull_at";
const KV_PACK_PREFS = "offline-pack.prefs";

function supported(): boolean {
  return typeof indexedDB !== "undefined";
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!supported()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("outbox")) {
          const outbox = db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
          outbox.createIndex("client_op_id", "client_op_id", { unique: true });
          outbox.createIndex("status", "status", { unique: false });
          outbox.createIndex("entity_type", "entity_type", { unique: false });
        }
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
        if (!db.objectStoreNames.contains("tombstones")) db.createObjectStore("tombstones", { keyPath: "id" });
        if (!db.objectStoreNames.contains("pack")) db.createObjectStore("pack", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("indexeddb open failed"));
      };
    });
  }
  return dbPromise.catch(() => null);
}

function tx<T>(
  store: "outbox" | "kv" | "tombstones" | "pack",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) {
          reject(new Error("indexeddb unavailable"));
          return;
        }
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexeddb request failed"));
      }),
  );
}

function getAll<T>(store: "outbox" | "kv" | "tombstones" | "pack"): Promise<T[]> {
  return tx(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

/* ------------------------------------------------------------------ */
/* key/value                                                           */
/* ------------------------------------------------------------------ */

export async function getKv(key: string): Promise<string | null> {
  try {
    const row = await tx<{ key: string; value: string }>("kv", "readonly", (s) => s.get(key));
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setKv(key: string, value: string): Promise<void> {
  try {
    await tx("kv", "readwrite", (s) => s.put({ key, value }));
  } catch {
    /* storage unavailable — sync simply won't persist this value */
  }
}

export async function getDeviceId(): Promise<string> {
  let id = await getKv(KV_DEVICE_ID);
  if (!id) {
    id = uuid();
    await setKv(KV_DEVICE_ID, id);
  }
  return id;
}

export const getSyncCursor = (): Promise<string | null> => getKv(KV_CURSOR);
export const setSyncCursor = (cursor: string): Promise<void> => setKv(KV_CURSOR, cursor);
export const getLastPullAt = (): Promise<string | null> => getKv(KV_LAST_PULL);
export const setLastPullAt = (iso: string): Promise<void> => setKv(KV_LAST_PULL, iso);

/** Local offline-pack tier preferences: `{started: bool, followed: bool, popular: bool}`. */
export async function getPackPrefs(): Promise<Record<string, boolean>> {
  const raw = await getKv(KV_PACK_PREFS);
  if (!raw) return { started: true, followed: true, popular: false };
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return { started: true, followed: true, popular: false };
  }
}

export const setPackPrefs = (prefs: Record<string, boolean>): Promise<void> =>
  setKv(KV_PACK_PREFS, JSON.stringify(prefs));

/* ------------------------------------------------------------------ */
/* outbox                                                              */
/* ------------------------------------------------------------------ */

export async function enqueueOp(input: {
  entity_type: string;
  entity_id: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  base_version?: number | null;
  client_op_id?: string;
}): Promise<OutboxRow> {
  const now = new Date().toISOString();
  const row: OutboxRow = {
    client_op_id: input.client_op_id ?? uuid(),
    device_id: await getDeviceId(),
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    op: input.op,
    payload: input.payload,
    base_version: input.base_version ?? null,
    status: "pending",
    attempts: 0,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  const id = (await tx<IDBValidKey>("outbox", "readwrite", (s) => s.add(row))) as number;
  return { ...row, id };
}

export async function listPendingOps(): Promise<OutboxRow[]> {
  try {
    const all = await getAll<OutboxRow>("outbox");
    return all
      .filter((r) => r.status === "pending" || r.status === "failed")
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  } catch {
    return [];
  }
}

export async function countPendingOps(): Promise<number> {
  return (await listPendingOps()).length;
}

export async function markOpsSending(ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      const row = await tx<OutboxRow | undefined>("outbox", "readonly", (s) => s.get(id));
      if (row && (row.status === "pending" || row.status === "failed")) {
        await tx("outbox", "readwrite", (s) =>
          s.put({ ...row, status: "sending", updated_at: new Date().toISOString() }),
        );
      }
    } catch {
      /* best effort */
    }
  }
}

/** Server acked these ops — remove them (idempotent: re-ack is harmless). */
export async function ackOps(clientOpIds: string[]): Promise<void> {
  for (const cid of clientOpIds) {
    try {
      const rows = await getAll<OutboxRow>("outbox");
      const row = rows.find((r) => r.client_op_id === cid);
      if (row?.id != null) await tx("outbox", "readwrite", (s) => s.delete(row.id as number));
    } catch {
      /* best effort */
    }
  }
}

export async function failOps(clientOpIds: string[], error: string): Promise<void> {
  for (const cid of clientOpIds) {
    try {
      const rows = await getAll<OutboxRow>("outbox");
      const row = rows.find((r) => r.client_op_id === cid);
      if (row?.id != null) {
        await tx("outbox", "readwrite", (s) =>
          s.put({
            ...row,
            status: "failed",
            attempts: row.attempts + 1,
            last_error: error,
            updated_at: new Date().toISOString(),
          }),
        );
      }
    } catch {
      /* best effort */
    }
  }
}

export async function releaseSending(): Promise<void> {
  // After a crashed/failed push round, return stuck "sending" rows to pending.
  try {
    const all = await getAll<OutboxRow>("outbox");
    for (const row of all) {
      if (row.status === "sending") {
        await tx("outbox", "readwrite", (s) =>
          s.put({ ...row, status: "pending", updated_at: new Date().toISOString() }),
        );
      }
    }
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* tombstones (deletions applied on pull)                              */
/* ------------------------------------------------------------------ */

/**
 * Record a server tombstone so the entity stays deleted across devices.
 * Returns true when this tombstone is new (caller should evict any local
 * cached copy of the entity).
 */
export async function applyTombstone(input: {
  entity_type: string;
  entity_id: string;
  version: number;
  deleted_at: string;
}): Promise<boolean> {
  const id = `${input.entity_type}:${input.entity_id}`;
  try {
    const existing = await tx<TombstoneRow | undefined>("tombstones", "readonly", (s) => s.get(id));
    if (existing && existing.version >= input.version) return false;
    await tx("tombstones", "readwrite", (s) =>
      s.put({ ...input, id, applied_at: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function isTombstoned(entity_type: string, entity_id: string): Promise<boolean> {
  try {
    const row = await tx<TombstoneRow | undefined>(
      "tombstones",
      "readonly",
      (s) => s.get(`${entity_type}:${entity_id}`),
    );
    return !!row;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* offline pack cache registry                                         */
/* ------------------------------------------------------------------ */

export async function registerPackEntry(entry: Omit<PackEntry, "cached_at">): Promise<void> {
  try {
    await tx("pack", "readwrite", (s) =>
      s.put({ ...entry, cached_at: new Date().toISOString() }),
    );
  } catch {
    /* best effort */
  }
}

export async function listPackEntries(): Promise<PackEntry[]> {
  try {
    return await getAll<PackEntry>("pack");
  } catch {
    return [];
  }
}

export function isOfflineDbSupported(): boolean {
  return supported();
}
