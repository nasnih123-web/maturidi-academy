/**
 * apps/mobile — src/lib/sync.ts
 *
 * Phase-13 offline sync engine — client side of the server sync contract
 * (`POST /api/v1/sync/push`, `GET /api/v1/sync/pull`, `/sync/cursor`,
 * `/sync/conflicts*`, see ADR-0010 and `apps/api/app/modules/sync/`).
 *
 *  - Every local mutation is appended to `offline_ops` with a stable
 *    `client_op_id` (idempotency key), the server `entity_type`
 *    (`user_ayah_note` | `user_progress` | `dhikr_daily_count`), `entity_id`,
 *    `op_type` (`upsert` | `delete`), the JSON `payload` and the
 *    `base_version` the edit was based on.
 *  - `pushPending()` POSTs pending ops; per-op results are `applied`
 *    (mark done), `conflicted` (a server conflict record now exists —
 *    surfaced via `listConflicts()`), or `rejected` (mark failed w/ detail).
 *  - `pullChanges()` GETs changes after the integer device cursor;
 *    `op_type: "delete"` is a tombstone → the local row is deleted.
 *    Entities with locally-pending ops are skipped on pull so an unpushed
 *    user edit is never overwritten by a stale pull.
 *  - Conflict policy is the server's (ADR-0010): scalars
 *    (`user_progress`, `dhikr_daily_count`) are max-wins and never conflict;
 *    `user_ayah_note` uses optimistic versioning — on conflict the server
 *    keeps its version and stores the client's in `conflict_records`;
 *    resolution goes through `POST /sync/conflicts/{id}/resolve`
 *    (`keep_local` | `keep_remote` | `merged`). Nothing is silently dropped.
 *
 * No UI code here — hooks consume `syncNow()` / `pendingOps()` /
 * `listConflicts()` / `resolveConflict()`.
 */
import { api, ApiError } from "./api";
import { getDb, nowIso } from "./db";
import { getDeviceId } from "./secureStore";
import type { SyncEntityType, SyncOpType } from "../types";

export interface OfflineOp {
  client_op_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  op_type: SyncOpType;
  payload: string;
  base_version: number;
  status: "pending" | "sending" | "done" | "failed" | "conflict";
  attempts: number;
  last_error: string | null;
  created_at: string;
}

/** Server conflict record (GET /api/v1/sync/conflicts). */
export interface ConflictRecord {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  local_payload: Record<string, unknown> | null;
  remote_payload: Record<string, unknown> | null;
  local_version: number | null;
  remote_version: number | null;
  resolution: string;
  created_at: string;
}

export type ConflictResolution = "keep_local" | "keep_remote" | "merged";

export interface SyncReport {
  pushed: number;
  accepted: number;
  conflicts: number;
  rejected: number;
  pulled: number;
  applied: number;
  tombstones: number;
  ok: boolean;
  /** Localised-message key for the UI (`sync_*`). */
  message: string;
}

const MAX_ATTEMPTS = 8;
const CURSOR_KV = "sync:cursor";

let serverSyncSupported: boolean | null = null;

function newClientOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Client-generated UUID v4 (offline-created notes need real UUIDs — the server rejects anything else). */
export function newUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Append a mutation to the offline queue. */
export async function enqueueOp(
  entityType: SyncEntityType,
  entityId: string,
  opType: SyncOpType,
  payload: Record<string, unknown>,
  baseVersion = 0,
): Promise<string> {
  const database = await getDb();
  const clientOpId = newClientOpId();
  await database.runAsync(
    `INSERT INTO offline_ops
       (client_op_id, entity_type, entity_id, op_type, payload, base_version, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [clientOpId, entityType, entityId, opType, JSON.stringify(payload), baseVersion, nowIso()],
  );
  return clientOpId;
}

export async function pendingOps(): Promise<OfflineOp[]> {
  const database = await getDb();
  return database.getAllAsync<OfflineOp>(
    `SELECT * FROM offline_ops WHERE status IN ('pending','failed') ORDER BY created_at ASC`,
  );
}

export async function pendingOpCount(): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM offline_ops WHERE status IN ('pending','failed')`,
  );
  return row?.n ?? 0;
}

/** Entity ids with unpushed local ops — pull must not overwrite these. */
async function dirtyEntityIds(): Promise<Set<string>> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ entity_type: string; entity_id: string }>(
    `SELECT entity_type, entity_id FROM offline_ops WHERE status IN ('pending','failed','conflict')`,
  );
  return new Set(rows.map((r) => `${r.entity_type}:${r.entity_id}`));
}

async function getCursor(): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [CURSOR_KV]);
  const n = Number.parseInt(row?.value ?? "0", 10);
  return Number.isNaN(n) ? 0 : n;
}

async function setCursor(cursor: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [
    CURSOR_KV,
    String(cursor),
    String(cursor),
  ]);
}

function backoffDelay(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, 60000);
}

interface PushResult {
  client_op_id: string;
  status: "pending" | "applied" | "conflicted" | "rejected";
  entity_type: string;
  entity_id: string;
  version: number | null;
  conflict_id: string | null;
  detail: string | null;
}

/** Push queued ops. Returns a summary for the caller. */
export async function pushPending(): Promise<{ applied: number; conflicts: number; rejected: number }> {
  const database = await getDb();
  const ops = await pendingOps();
  const summary = { applied: 0, conflicts: 0, rejected: 0 };
  if (ops.length === 0) return summary;
  if (serverSyncSupported === false) return summary;

  const deviceId = await getDeviceId();
  let results: PushResult[];
  try {
    const res = await api.post<{ device_id: string; results: PushResult[] }>(
      "/api/v1/sync/push",
      {
        device_id: deviceId,
        ops: ops.map((o) => ({
          client_op_id: o.client_op_id,
          entity_type: o.entity_type,
          entity_id: o.entity_id,
          op_type: o.op_type,
          payload: JSON.parse(o.payload) as Record<string, unknown>,
          base_version: o.base_version,
        })),
      },
      { auth: true },
    );
    results = res.results ?? [];
    serverSyncSupported = true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      serverSyncSupported = false;
      console.warn("[sync] /api/v1/sync/push not found (404); push disabled until app restart.");
      return summary;
    }
    for (const o of ops) {
      const failed = o.attempts + 1 >= MAX_ATTEMPTS;
      await database.runAsync(
        `UPDATE offline_ops SET status = ?, last_error = ?, attempts = attempts + 1 WHERE client_op_id = ?`,
        [failed ? "failed" : "pending", "network_error", o.client_op_id],
      );
    }
    void backoffDelay;
    throw e;
  }

  const byId = new Map(results.map((r) => [r.client_op_id, r]));
  for (const o of ops) {
    const r = byId.get(o.client_op_id);
    if (!r) {
      await database.runAsync(
        `UPDATE offline_ops SET status = 'pending', last_error = 'no result from server' WHERE client_op_id = ?`,
        [o.client_op_id],
      );
      continue;
    }
    if (r.status === "applied") {
      if (r.version != null) await stampLocalVersion(database, o.entity_type, o.entity_id, r.version);
      await database.runAsync(`UPDATE offline_ops SET status = 'done', last_error = NULL WHERE client_op_id = ?`, [
        o.client_op_id,
      ]);
      summary.applied += 1;
    } else if (r.status === "conflicted") {
      // The server kept its version and stored ours in conflict_records.
      // Local cache keeps the user's version until they resolve.
      await database.runAsync(
        `UPDATE offline_ops SET status = 'conflict', last_error = ? WHERE client_op_id = ?`,
        [r.conflict_id ?? "conflict", o.client_op_id],
      );
      summary.conflicts += 1;
    } else {
      await database.runAsync(`UPDATE offline_ops SET status = 'failed', last_error = ? WHERE client_op_id = ?`, [
        r.detail ?? r.status,
        o.client_op_id,
      ]);
      summary.rejected += 1;
    }
  }
  return summary;
}

async function stampLocalVersion(
  database: Awaited<ReturnType<typeof getDb>>,
  entityType: SyncEntityType,
  entityId: string,
  version: number,
): Promise<void> {
  if (entityType === "user_ayah_note") {
    await database.runAsync(`UPDATE cache_notes SET version = ? WHERE id = ?`, [version, entityId]);
  } else if (entityType === "user_progress") {
    await database.runAsync(`UPDATE cache_progress SET version = ? WHERE lesson_id = ?`, [version, entityId]);
  }
}

interface PullChange {
  seq: number;
  entity_type: string;
  entity_id: string;
  op_type: string;
  payload: Record<string, unknown> | null;
  version: number;
}

/** Pull server changes after the device cursor and apply them. */
export async function pullChanges(): Promise<{ pulled: number; applied: number; tombstones: number }> {
  const database = await getDb();
  if (serverSyncSupported === false) return { pulled: 0, applied: 0, tombstones: 0 };

  const deviceId = await getDeviceId();
  let cursor = await getCursor();
  if (cursor === 0) {
    // First run: adopt the server's current cursor so we don't replay history.
    try {
      const c = await api.get<{ cursor_seq: number }>("/api/v1/sync/cursor", {
        auth: true,
        query: { device_id: deviceId },
      });
      cursor = c.cursor_seq ?? 0;
      await setCursor(cursor);
    } catch {
      // Non-fatal — pull below will start from 0.
    }
  }

  let payload: { changes: PullChange[]; new_cursor: number };
  try {
    payload = await api.get<{ changes: PullChange[]; new_cursor: number }>("/api/v1/sync/pull", {
      auth: true,
      query: { cursor, device_id: deviceId, limit: 200 },
    });
    serverSyncSupported = true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      serverSyncSupported = false;
      console.warn("[sync] /api/v1/sync/pull not found (404); pull disabled until app restart.");
      return { pulled: 0, applied: 0, tombstones: 0 };
    }
    throw e;
  }

  const dirty = await dirtyEntityIds();
  let applied = 0;
  let tombstones = 0;
  for (const change of payload.changes ?? []) {
    if (dirty.has(`${change.entity_type}:${change.entity_id}`)) continue; // never clobber unpushed user edits
    if (change.op_type === "delete") {
      await deleteLocalRow(database, change.entity_type as SyncEntityType, change.entity_id);
      tombstones += 1;
    } else if (change.payload) {
      await upsertLocalRow(database, change);
      applied += 1;
    }
  }
  if (payload.new_cursor > cursor) await setCursor(payload.new_cursor);
  return { pulled: (payload.changes ?? []).length, applied, tombstones };
}

async function deleteLocalRow(
  database: Awaited<ReturnType<typeof getDb>>,
  entityType: SyncEntityType,
  entityId: string,
): Promise<void> {
  if (entityType === "user_ayah_note") {
    await database.runAsync(`DELETE FROM cache_notes WHERE id = ?`, [entityId]);
  } else if (entityType === "user_progress") {
    await database.runAsync(`DELETE FROM cache_progress WHERE lesson_id = ?`, [entityId]);
  } else if (entityType === "dhikr_daily_count") {
    const parts = entityId.split(":");
    const date = parts[0] ?? "";
    const dhikrText = parts.slice(1).join(":");
    await database.runAsync(`DELETE FROM cache_dhikr_daily WHERE date = ? AND dhikr_text = ?`, [date, dhikrText]);
  }
}

async function upsertLocalRow(database: Awaited<ReturnType<typeof getDb>>, change: PullChange): Promise<void> {
  const d = change.payload ?? {};
  if (change.entity_type === "user_ayah_note") {
    await database.runAsync(
      `INSERT INTO cache_notes (id, surah, ayah, note_text, is_private, version, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         surah = excluded.surah, ayah = excluded.ayah, note_text = excluded.note_text,
         is_private = excluded.is_private, version = excluded.version,
         updated_at = excluded.updated_at, deleted = 0`,
      [
        change.entity_id,
        Number(d.surah ?? 0),
        Number(d.ayah ?? 0),
        String(d.note_text ?? ""),
        d.is_private ? 1 : 0,
        change.version,
        nowIso(),
      ],
    );
  } else if (change.entity_type === "user_progress") {
    await database.runAsync(
      `INSERT INTO cache_progress (lesson_id, status, position_seconds, version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lesson_id) DO UPDATE SET status = excluded.status,
         position_seconds = excluded.position_seconds, version = excluded.version,
         updated_at = excluded.updated_at`,
      [change.entity_id, String(d.status ?? "in_progress"), Number(d.position_seconds ?? 0), change.version, nowIso()],
    );
  } else if (change.entity_type === "dhikr_daily_count") {
    const parts = change.entity_id.split(":");
    const date = parts[0] ?? "";
    const dhikrText = parts.slice(1).join(":");
    await database.runAsync(
      `INSERT INTO cache_dhikr_daily (date, dhikr_text, total_count, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date, dhikr_text) DO UPDATE SET
         total_count = excluded.total_count, updated_at = excluded.updated_at`,
      [date, dhikrText, Number(d.total_count ?? 0), nowIso()],
    );
  }
}

// ── Conflicts (server-owned records) ──────────────────────────────────

export async function listConflicts(): Promise<ConflictRecord[]> {
  try {
    const res = await api.get<{ items: ConflictRecord[]; total: number }>("/api/v1/sync/conflicts", {
      auth: true,
      query: { only_pending: true, limit: 50 },
    });
    return res.items ?? [];
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.isNetworkError)) return [];
    throw e;
  }
}

/**
 * Resolve a conflict. `keep_local` replays the device version (ADR-0010:
 * "local" = the device that pushed later and lost); `keep_remote` keeps the
 * server version; `merged` applies a user-merged payload.
 */
export async function resolveConflict(
  conflictId: string,
  resolution: ConflictResolution,
  mergedPayload?: Record<string, unknown>,
): Promise<void> {
  const deviceId = await getDeviceId();
  await api.post(
    `/api/v1/sync/conflicts/${conflictId}/resolve`,
    { resolution, ...(mergedPayload ? { merged_payload: mergedPayload } : {}) },
    { auth: true, query: { device_id: deviceId } },
  );
  // Drop the local conflict markers for this entity — the next pull carries
  // the resolved truth.
  const database = await getDb();
  await database.runAsync(`UPDATE offline_ops SET status = 'done' WHERE status = 'conflict'`);
}

/**
 * Full sync pass: push local ops first, then pull server changes.
 * Safe to call on app start, on reconnect and from the Settings screen.
 */
export async function syncNow(): Promise<SyncReport> {
  try {
    const push = await pushPending();
    const pull = await pullChanges();
    const pending = await pendingOpCount();
    return {
      pushed: push.applied + push.conflicts + push.rejected,
      accepted: push.applied,
      conflicts: push.conflicts,
      rejected: push.rejected,
      pulled: pull.pulled,
      applied: pull.applied,
      tombstones: pull.tombstones,
      ok: pending === 0,
      message: pending === 0 ? "settings.syncIdle" : "settings.pendingOps",
    };
  } catch (e) {
    const message = e instanceof ApiError && e.isNetworkError ? "settings.syncOffline" : "common.errorTitle";
    return {
      pushed: 0,
      accepted: 0,
      conflicts: 0,
      rejected: 0,
      pulled: 0,
      applied: 0,
      tombstones: 0,
      ok: false,
      message,
    };
  }
}

/** Test seam: reset the "server supports sync" probe. */
export function resetSyncProbe(): void {
  serverSyncSupported = null;
}
