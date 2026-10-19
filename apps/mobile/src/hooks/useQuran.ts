/**
 * apps/mobile — src/hooks/useQuran.ts
 *
 * Quran reader hooks: surah list, surah detail, and ayah notes (with
 * conflict surfacing for the keep-both policy).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  listConflicts,
  resolveConflict,
  type ConflictRecord,
  type ConflictResolution,
} from "../lib/sync";
import {
  createNote as svcCreateNote,
  deleteNote as svcDeleteNote,
  getSurah as svcGetSurah,
  listNotes as svcListNotes,
  listSurahs as svcListSurahs,
  updateNote as svcUpdateNote,
  type NoteInput,
} from "../services/quran";
import type { QuranNote, SurahDetail, SurahSummary } from "../types";

export function useSurahs(): {
  surahs: SurahSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [surahs, setSurahs] = useState<SurahSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    svcListSurahs()
      .then((items) => alive && setSurahs(items))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce]);

  return { surahs, loading, error, refresh };
}

export function useSurahDetail(number: number | null): {
  detail: SurahDetail | null;
  loading: boolean;
  error: string | null;
} {
  const [detail, setDetail] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (number == null) return;
    let alive = true;
    setLoading(true);
    setError(null);
    svcGetSurah(number)
      .then((d) => alive && setDetail(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [number]);

  return { detail, loading, error };
}

export function useQuranNotes(surah?: number, ayah?: number): {
  notes: QuranNote[];
  conflicts: ConflictRecord[];
  loading: boolean;
  offline: boolean;
  error: string | null;
  refresh: () => void;
  addNote: (input: NoteInput) => Promise<boolean>;
  editNote: (id: string, patch: { note_text?: string; is_private?: boolean }) => Promise<boolean>;
  removeNote: (id: string) => Promise<boolean>;
  resolveNoteConflict: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
} {
  const [notes, setNotes] = useState<QuranNote[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([svcListNotes(surah, ayah), listConflicts()])
      .then(([{ notes: n, offline: off }, c]) => {
        if (!alive) return;
        setNotes(n);
        // Server conflict records for ayah notes (ADR-0010: keep-both —
        // both versions are preserved server-side, the user picks).
        setConflicts(c.filter((x) => x.entity_type === "user_ayah_note"));
        setOffline(off);
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce, surah, ayah]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      try {
        await fn();
        setNonce((n) => n + 1);
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e.code : "unknown");
        return false;
      }
    },
    [],
  );

  const addNote = useCallback((input: NoteInput) => mutate(() => svcCreateNote(input)), [mutate]);
  const editNote = useCallback(
    (id: string, patch: { note_text?: string; is_private?: boolean }) => mutate(() => svcUpdateNote(id, patch)),
    [mutate],
  );
  const removeNote = useCallback((id: string) => mutate(() => svcDeleteNote(id)), [mutate]);
  const resolveNoteConflict = useCallback(
    async (conflictId: string, resolution: ConflictResolution) => {
      await resolveConflict(conflictId, resolution);
      setNonce((n) => n + 1);
    },
    [],
  );

  return { notes, conflicts, loading, offline, error, refresh, addNote, editNote, removeNote, resolveNoteConflict };
}
