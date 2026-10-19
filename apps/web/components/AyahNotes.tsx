'use client';

/**
 * AyahNotes — private ayah notes UI.
 *
 * Logged-in users: list / add / edit / delete their own notes on an ayah.
 * Logged out: a sign-in prompt (never a broken UI). All strings arrive via
 * `labels`; all HTTP via lib/quran-client.ts.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { createNote, deleteNote, getNotes, updateNote } from '@/lib/quran-client';
import type { AyahNote } from '@/lib/quran';

export interface AyahNotesLabels {
  notesTitle: string;
  addNote: string;
  notePlaceholder: string;
  saveNote: string;
  cancel: string;
  editNote: string;
  deleteNote: string;
  deleteConfirm: string;
  privateNote: string;
  publicNote: string;
  signInPrompt: string;
  signIn: string;
  notesEmpty: string;
  notesFailed: string;
  noteSaved: string;
  noteDeleted: string;
  playAyah: string;
}

export function AyahNotes({
  surah,
  ayahNumber,
  locale,
  labels,
  onPlayAyah,
  canPlay,
}: {
  surah: number;
  ayahNumber: number;
  locale: string;
  labels: AyahNotesLabels;
  onPlayAyah: () => void;
  canPlay: boolean;
}) {
  const { loggedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<AyahNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !loggedIn) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getNotes(surah, ayahNumber)
      .then((ns) => {
        if (!cancelled) setNotes(ns);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loggedIn, surah, ayahNumber]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateNote(editingId, { text, isPrivate });
        setNotes((ns) => ns.map((n) => (n.id === editingId ? updated : n)));
      } else {
        const created = await createNote({ surah, ayah: ayahNumber, text, isPrivate });
        setNotes((ns) => [created, ...ns]);
      }
      setDraft('');
      setEditingId(null);
      setIsPrivate(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(labels.deleteConfirm)) return;
    try {
      await deleteNote(id);
      setNotes((ns) => ns.filter((n) => n.id !== id));
    } catch {
      setFailed(true);
    }
  };

  return (
    <span className="ayah-notes">
      {canPlay ? (
        <button type="button" className="ayah-mini-btn" onClick={onPlayAyah} aria-label={labels.playAyah}>
          ▶
        </button>
      ) : null}
      <button
        type="button"
        className="ayah-mini-btn"
        aria-expanded={open}
        aria-controls={`notes-${surah}-${ayahNumber}`}
        onClick={() => setOpen((o) => !o)}
        title={labels.notesTitle}
      >
        ✎
      </button>
      {open ? (
        <span className="ayah-notes-panel" id={`notes-${surah}-${ayahNumber}`} role="dialog" aria-label={labels.notesTitle}>
          {!loggedIn ? (
            <span className="ayah-notes-signin">
              {labels.signInPrompt}{' '}
              <Link href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/quran/${surah}?ayah=${ayahNumber}`)}`}>
                {labels.signIn}
              </Link>
            </span>
          ) : (
            <>
              {loading ? <span className="ayah-notes-empty">…</span> : null}
              {failed ? (
                <span className="ayah-notes-empty" role="alert">
                  {labels.notesFailed}
                </span>
              ) : null}
              {!loading && !failed && notes.length === 0 ? (
                <span className="ayah-notes-empty">{labels.notesEmpty}</span>
              ) : null}
              <ul className="ayah-notes-list">
                {notes.map((n) => (
                  <li key={n.id} className="ayah-note-item">
                    <p>{n.text}</p>
                    <span className="ayah-note-meta">
                      {n.isPrivate ? labels.privateNote : labels.publicNote}
                      <button type="button" onClick={() => { setEditingId(n.id); setDraft(n.text); setIsPrivate(n.isPrivate); }}>
                        {labels.editNote}
                      </button>
                      <button type="button" onClick={() => void remove(n.id)}>
                        {labels.deleteNote}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <label className="ayah-note-field">
                <span className="sr-only">{labels.addNote}</span>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={labels.notePlaceholder}
                  rows={2}
                  maxLength={2000}
                />
              </label>
              <span className="ayah-note-row">
                <label className="quran-toggle">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                  {labels.privateNote}
                </label>
                {editingId ? (
                  <button type="button" onClick={() => { setEditingId(null); setDraft(''); }}>
                    {labels.cancel}
                  </button>
                ) : null}
                <button type="button" className="ayah-note-save" onClick={() => void submit()} disabled={saving || !draft.trim()}>
                  {labels.saveNote}
                </button>
              </span>
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}
