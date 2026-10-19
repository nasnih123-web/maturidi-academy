/**
 * Browser-side Quran notes client (Phase 5 — Track 2/web).
 *
 * Authenticated CRUD for private ayah notes. The token handling lives in
 * lib/auth-client.ts; this module only knows the note wire contract
 * (source of truth: apps/api/app/modules/quran/{router,schemas}.py).
 * Notes are per-user and private — the API enforces ownership.
 *
 * Wire contract (auth required on all):
 * - GET  /api/v1/quran/notes?surah={n}&ayah={m}  → { items: NoteOut[], next_cursor }
 * - POST /api/v1/quran/notes { surah, ayah, note_text, is_private } → NoteOut
 * - PUT  /api/v1/quran/notes/{id} { note_text?, is_private? } → NoteOut
 * - DELETE /api/v1/quran/notes/{id} → 204
 *
 * NoteOut: { id, surah, ayah, note_text, is_private, created_at }
 */
import { authJson } from './auth-client';
import type { AyahNote } from './quran';

function asNote(raw: unknown): AyahNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.note_text !== 'string') return null;
  return {
    id: o.id,
    surah: typeof o.surah === 'number' ? o.surah : 0,
    ayah: typeof o.ayah === 'number' ? o.ayah : 0,
    text: o.note_text,
    isPrivate: o.is_private !== false,
    createdAt: typeof o.created_at === 'string' ? o.created_at : '',
    updatedAt: typeof o.created_at === 'string' ? o.created_at : '',
  };
}

export async function getNotes(surah: number, ayah: number): Promise<AyahNote[]> {
  const body = await authJson<{ items?: unknown }>(
    `/api/v1/quran/notes?surah=${surah}&ayah=${ayah}`,
  );
  if (!Array.isArray(body?.items)) return [];
  return body.items.map(asNote).filter((n): n is AyahNote => n !== null);
}

export async function createNote(input: {
  surah: number;
  ayah: number;
  text: string;
  isPrivate: boolean;
}): Promise<AyahNote> {
  const body = await authJson<unknown>('/api/v1/quran/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      surah: input.surah,
      ayah: input.ayah,
      note_text: input.text,
      is_private: input.isPrivate,
    }),
  });
  const note = asNote(body);
  if (!note) throw new Error('unexpected note response');
  return note;
}

export async function updateNote(
  id: string,
  input: { text?: string; isPrivate?: boolean },
): Promise<AyahNote> {
  const patch: Record<string, unknown> = {};
  if (typeof input.text === 'string') patch.note_text = input.text;
  if (typeof input.isPrivate === 'boolean') patch.is_private = input.isPrivate;
  const body = await authJson<unknown>(
    `/api/v1/quran/notes/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  const note = asNote(body);
  if (!note) throw new Error('unexpected note response');
  return note;
}

export async function deleteNote(id: string): Promise<void> {
  await authJson<unknown>(`/api/v1/quran/notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
