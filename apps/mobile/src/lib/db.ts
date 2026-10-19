/**
 * apps/mobile — src/lib/db.ts
 *
 * Local SQLite database (expo-sqlite) for the Phase-13 offline story:
 *
 *  - `offline_ops`  — the offline operation queue. Every local mutation made
 *    while offline (or optimistically) is recorded here with a stable
 *    `client_op_id` (idempotency), the server `entity_type`
 *    (`user_ayah_note` | `user_progress` | `dhikr_daily_count`), `entity_id`,
 *    `op_type` (`upsert` | `delete`), the JSON `payload` and the
 *    `base_version` the edit was made against (ADR-0010). Rows are never
 *    deleted by the UI — the sync engine marks them done/failed/conflict.
 *  - `kv`           — small device-level prefs + the integer sync cursor
 *    (`sync:cursor`, per device — ADR-0010 §3).
 *  - `cache_*`      — offline-readable mirrors of server entities the user
 *    has touched. Deletes are tombstoned (`deleted = 1`) until the server
 *    confirms; server tombstones on pull delete the local row.
 *
 * Schema changes are forward-only: new tables/columns are added with
 * `IF NOT EXISTS` guards in `migrate()` (engineering-contract §12).
 */
import * as SQLite from "expo-sqlite";

const DB_NAME = "maturidi.db";

let db: SQLite.SQLiteDatabase | null = null;

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`PRAGMA journal_mode = WAL;`);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_ops (
      client_op_id TEXT PRIMARY KEY,
      entity_type  TEXT NOT NULL,   -- user_ayah_note | user_progress | dhikr_daily_count
      entity_id    TEXT NOT NULL,
      op_type      TEXT NOT NULL,   -- upsert | delete
      payload      TEXT NOT NULL,   -- JSON
      base_version INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | done | failed | conflict
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      created_at   TEXT NOT NULL
    );
  `);
  await database.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_offline_ops_status ON offline_ops(status, created_at);`,
  );

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_notes (
      id         TEXT PRIMARY KEY,
      surah      INTEGER NOT NULL,
      ayah       INTEGER NOT NULL,
      note_text  TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 1,
      version    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      deleted    INTEGER NOT NULL DEFAULT 0
    );
  `);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_tasbih (
      session_id   TEXT PRIMARY KEY,
      dhikr_text   TEXT NOT NULL,
      target_count INTEGER,
      count        INTEGER NOT NULL DEFAULT 0,
      version      INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL
    );
  `);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_progress (
      lesson_id        TEXT PRIMARY KEY,
      status           TEXT NOT NULL,
      position_seconds INTEGER NOT NULL DEFAULT 0,
      version          INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT NOT NULL
    );
  `);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_dhikr_daily (
      date       TEXT NOT NULL,
      dhikr_text TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, dhikr_text)
    );
  `);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_library (
      item_id    TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      kind       TEXT NOT NULL,
      local_path TEXT,
      version    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

/** Open (and migrate) the database — singleton. */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_NAME);
    await migrate(db);
  }
  return db;
}

/** For tests / sign-out: close and drop the singleton (files stay on disk). */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
