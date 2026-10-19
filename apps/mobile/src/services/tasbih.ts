/**
 * apps/mobile — src/services/tasbih.ts
 *
 * Tasbih sessions + the offline-syncable daily aggregate.
 *
 * Two real server surfaces are used, each for its own job:
 *  - `POST /api/v1/tasbih/sessions…` — the per-session UX (online only).
 *  - the sync engine's `dhikr_daily_count` entity (ADR-0010) — the durable,
 *    cross-device counter. `entity_id` is `{date_iso}:{dhikr_text}` and the
 *    server applies max-wins on `total_count`, so concurrent devices can only
 *    ever raise the total. Every local increment updates the daily table
 *    and enqueues an `upsert`; the next sync push carries it.
 */
import { api, ApiError } from "../lib/api";
import { getDb, nowIso } from "../lib/db";
import { enqueueOp, newUuid } from "../lib/sync";
import type { DhikrTotal, TasbihSession } from "../types";

function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.isNetworkError;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface TasbihRow {
  session_id: string;
  dhikr_text: string;
  target_count: number | null;
  count: number;
  version: number;
  updated_at: string;
}

function rowToSession(r: TasbihRow): TasbihSession {
  return {
    id: r.session_id,
    dhikr_text: r.dhikr_text,
    target_count: r.target_count,
    count: r.count,
    started_at: r.updated_at,
    ended_at: null,
    completed: r.target_count != null && r.count >= r.target_count,
  };
}

/** Add `amount` to the local daily aggregate and queue the sync upsert. */
async function bumpDailyCount(dhikrText: string, amount: number): Promise<number> {
  const database = await getDb();
  const date = todayIso();
  await database.runAsync(
    `INSERT INTO cache_dhikr_daily (date, dhikr_text, total_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date, dhikr_text) DO UPDATE SET
       total_count = total_count + excluded.total_count, updated_at = excluded.updated_at`,
    [date, dhikrText, amount, nowIso()],
  );
  const row = await database.getFirstAsync<{ total_count: number }>(
    `SELECT total_count FROM cache_dhikr_daily WHERE date = ? AND dhikr_text = ?`,
    [date, dhikrText],
  );
  const total = row?.total_count ?? amount;
  await enqueueOp("dhikr_daily_count", `${date}:${dhikrText}`, "upsert", {
    date,
    dhikr_text: dhikrText,
    total_count: total,
  });
  return total;
}

export async function startSession(dhikrText: string, targetCount?: number): Promise<TasbihSession> {
  const database = await getDb();
  try {
    const session = await api.post<TasbihSession>("/api/v1/tasbih/sessions", {
      dhikr_text: dhikrText,
      target_count: targetCount ?? null,
    });
    await database.runAsync(
      `INSERT INTO cache_tasbih (session_id, dhikr_text, target_count, count, version, updated_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(session_id) DO UPDATE SET dhikr_text = excluded.dhikr_text,
         target_count = excluded.target_count, count = excluded.count, updated_at = excluded.updated_at`,
      [session.id, session.dhikr_text, session.target_count, session.count, nowIso()],
    );
    return session;
  } catch (e) {
    if (!isOffline(e)) throw e;
    // Offline: the session lives locally; its counts still reach the server
    // through the dhikr_daily_count sync entity (max-wins).
    const id = newUuid();
    await database.runAsync(
      `INSERT INTO cache_tasbih (session_id, dhikr_text, target_count, count, version, updated_at)
       VALUES (?, ?, ?, 0, 0, ?)`,
      [id, dhikrText, targetCount ?? null, nowIso()],
    );
    const row = await database.getFirstAsync<TasbihRow>(`SELECT * FROM cache_tasbih WHERE session_id = ?`, [id]);
    if (!row) throw e;
    return rowToSession(row);
  }
}

/** Increment the counter — optimistic locally, queued for sync. */
export async function increment(sessionId: string, amount = 1): Promise<TasbihSession> {
  const database = await getDb();
  const row = await database.getFirstAsync<TasbihRow>(`SELECT * FROM cache_tasbih WHERE session_id = ?`, [sessionId]);
  const newCount = (row?.count ?? 0) + amount;
  await database.runAsync(`UPDATE cache_tasbih SET count = ?, updated_at = ? WHERE session_id = ?`, [
    newCount,
    nowIso(),
    sessionId,
  ]);
  if (row) await bumpDailyCount(row.dhikr_text, amount);

  const idempotencyKey = `tasbih_${sessionId}_${Date.now()}`;
  try {
    const session = await api.post<TasbihSession>(
      `/api/v1/tasbih/sessions/${sessionId}/count`,
      { amount, idempotency_key: idempotencyKey },
      { idempotencyKey },
    );
    await database.runAsync(`UPDATE cache_tasbih SET count = ?, updated_at = ? WHERE session_id = ?`, [
      session.count,
      nowIso(),
      sessionId,
    ]);
    return session;
  } catch (e) {
    if (!isOffline(e)) throw e;
    const updated = await database.getFirstAsync<TasbihRow>(`SELECT * FROM cache_tasbih WHERE session_id = ?`, [
      sessionId,
    ]);
    if (!updated) throw e;
    return rowToSession(updated);
  }
}

export async function todayTotals(): Promise<{ totals: DhikrTotal[]; date: string; offline: boolean }> {
  try {
    const res = await api.get<{ date: string; totals: DhikrTotal[] }>("/api/v1/tasbih/today");
    return { totals: res.totals ?? [], date: res.date, offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    const database = await getDb();
    const rows = await database.getAllAsync<{ dhikr_text: string; total_count: number }>(
      `SELECT dhikr_text, total_count FROM cache_dhikr_daily WHERE date = ?`,
      [todayIso()],
    );
    return { totals: rows, date: todayIso(), offline: true };
  }
}
