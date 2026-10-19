/**
 * apps/mobile — src/services/quran.ts
 *
 * Quran reader data + ayah notes with offline support.
 *
 * Read path (surahs/ayahs) is online-first with no local mirror — the text
 * corpus is large and versioned server-side; the Phase-13 offline priority
 * list covers user data first (spec: started > followed > popular).
 *
 * Notes are user-authored content: every mutation is written to the local
 * cache immediately and appended to the offline op queue, so the UI works
 * fully offline. Conflicts follow the keep-both policy (see lib/sync.ts) —
 * neither version is ever silently discarded.
 */
import { api, ApiError } from "../lib/api";
import { getDb, nowIso } from "../lib/db";
import { enqueueOp, newUuid } from "../lib/sync";
import type { Ayah, QuranNote, SurahDetail, SurahSummary } from "../types";

function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.isNetworkError;
}

export async function listSurahs(): Promise<SurahSummary[]> {
  const res = await api.get<{ items: SurahSummary[] }>("/api/v1/quran/surahs", { auth: false });
  return res.items ?? [];
}

export async function getSurah(
  number: number,
  opts?: { translation?: string; reciter?: string },
): Promise<SurahDetail> {
  return api.get<SurahDetail>(`/api/v1/quran/surah/${number}`, {
    auth: false,
    query: { translation: opts?.translation, reciter: opts?.reciter },
  });
}

export async function getAyah(surah: number, ayah: number): Promise<Ayah> {
  return api.get<Ayah>(`/api/v1/quran/ayah/${surah}/${ayah}`, { auth: false });
}

interface NoteRow {
  id: string;
  surah: number;
  ayah: number;
  note_text: string;
  is_private: number;
  version: number;
  updated_at: string;
}

function rowToNote(r: NoteRow): QuranNote {
  return {
    id: r.id,
    surah: r.surah,
    ayah: r.ayah,
    note_text: r.note_text,
    is_private: r.is_private === 1,
    version: r.version,
    updated_at: r.updated_at,
  };
}

async function cacheNotes(rows: QuranNote[]): Promise<void> {
  const database = await getDb();
  for (const n of rows) {
    await database.runAsync(
      `INSERT INTO cache_notes (id, surah, ayah, note_text, is_private, version, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         note_text = excluded.note_text, is_private = excluded.is_private,
         version = excluded.version, updated_at = excluded.updated_at, deleted = 0`,
      [n.id, n.surah, n.ayah, n.note_text, n.is_private ? 1 : 0, n.version ?? 0, n.updated_at ?? nowIso()],
    );
  }
}

/** Online-first; falls back to the local cache when offline. */
export async function listNotes(surah?: number, ayah?: number): Promise<{ notes: QuranNote[]; offline: boolean }> {
  try {
    const res = await api.get<{ items: QuranNote[] }>("/api/v1/quran/notes", {
      query: { surah, ayah, limit: 50 },
    });
    const notes = res.items ?? [];
    await cacheNotes(notes);
    return { notes, offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    const database = await getDb();
    const rows = await database.getAllAsync<NoteRow>(
      `SELECT * FROM cache_notes WHERE deleted = 0
       AND (? IS NULL OR surah = ?) AND (? IS NULL OR ayah = ?)
       ORDER BY updated_at DESC`,
      [surah ?? null, surah ?? null, ayah ?? null, ayah ?? null],
    );
    return { notes: rows.map(rowToNote), offline: true };
  }
}

export interface NoteInput {
  surah: number;
  ayah: number;
  note_text: string;
  is_private?: boolean;
}

export async function createNote(input: NoteInput): Promise<{ note: QuranNote; offline: boolean }> {
  const payload = {
    surah: input.surah,
    ayah: input.ayah,
    note_text: input.note_text,
    is_private: input.is_private ?? true,
  };
  try {
    const note = await api.post<QuranNote>("/api/v1/quran/notes", payload);
    await cacheNotes([note]);
    return { note, offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    const database = await getDb();
    // The server only accepts real UUIDs as note ids (ADR-0010) — the
    // offline-created note keeps this id after the push.
    const id = newUuid();
    const note: QuranNote = {
      id,
      surah: payload.surah,
      ayah: payload.ayah,
      note_text: payload.note_text,
      is_private: payload.is_private,
      version: 0,
      updated_at: nowIso(),
    };
    await cacheNotes([note]);
    await enqueueOp("user_ayah_note", id, "upsert", payload, 0);
    return { note, offline: true };
  }
}

export async function updateNote(
  id: string,
  patch: { note_text?: string; is_private?: boolean },
): Promise<{ note: QuranNote; offline: boolean }> {
  const database = await getDb();
  const existing = await database.getFirstAsync<NoteRow>(`SELECT * FROM cache_notes WHERE id = ?`, [id]);
  const baseVersion = existing?.version ?? 0;
  try {
    const note = await api.put<QuranNote>(`/api/v1/quran/notes/${id}`, patch);
    await cacheNotes([note]);
    return { note, offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    if (existing) {
      await database.runAsync(
        `UPDATE cache_notes SET note_text = ?, is_private = ?, updated_at = ? WHERE id = ?`,
        [
          patch.note_text ?? existing.note_text,
          patch.is_private !== undefined ? (patch.is_private ? 1 : 0) : existing.is_private,
          nowIso(),
          id,
        ],
      );
    }
    await enqueueOp("user_ayah_note", id, "upsert", { id, ...patch }, baseVersion);
    const updated = await database.getFirstAsync<NoteRow>(`SELECT * FROM cache_notes WHERE id = ?`, [id]);
    if (!updated) throw e;
    return { note: rowToNote(updated), offline: true };
  }
}

/** Tombstone locally; the server delete is queued for the next sync. */
export async function deleteNote(id: string): Promise<{ offline: boolean }> {
  const database = await getDb();
  try {
    await api.del(`/api/v1/quran/notes/${id}`);
    await database.runAsync(`DELETE FROM cache_notes WHERE id = ?`, [id]);
    return { offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    const existing = await database.getFirstAsync<NoteRow>(`SELECT * FROM cache_notes WHERE id = ?`, [id]);
    await database.runAsync(`UPDATE cache_notes SET deleted = 1, updated_at = ? WHERE id = ?`, [nowIso(), id]);
    await enqueueOp("user_ayah_note", id, "delete", { id }, existing?.version ?? 0);
    return { offline: true };
  }
}
