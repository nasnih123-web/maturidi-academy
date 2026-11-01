/**
 * Quran bookmarks + reading history (round 4 — Bayan-style LOCAL
 * storage).
 *
 * Bayan itself stores bookmarks on-device (Room); the web equivalent
 * is localStorage — NOT a shortcut, and deliberately NOT a server
 * user-account feature in this round (no account scope, no sync).
 * Everything here is per-device and never leaves the browser.
 */

export type BookmarkKind = 'ayah' | 'page';

export interface Bookmark {
  /** 's:a' for an ayah, 'page:n' for a mushaf page. */
  id: string;
  kind: BookmarkKind;
  surah: number;
  /** Ayah number (ayah kind only). */
  ayah: number | null;
  /** Mushaf page number (page kind only). */
  page: number | null;
  /** Human label captured at save time (surah name + ref). */
  label: string;
  favorite: boolean;
  createdAt: number;
}

/** Last-read position: what the reader was last looking at. */
export interface LastRead {
  surah: number;
  /** 'surah' | 'ayah' | 'juz' | 'hizb' | 'page'. */
  view: string;
  /** Range target (juz/hizb/page modes) or null. */
  target: number | null;
  /** Focused ayah number (ayah mode) or null. */
  ayah: number | null;
  savedAt: number;
}

const BOOKMARKS_KEY = 'quran-bookmarks-v1';
const LAST_READ_KEY = 'quran-last-read-v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* blocked storage: features still work this session via state */
  }
}

function validBookmark(o: unknown): Bookmark | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.id !== 'string' || (r.kind !== 'ayah' && r.kind !== 'page')) return null;
  if (typeof r.surah !== 'number' || typeof r.label !== 'string') return null;
  return {
    id: r.id,
    kind: r.kind,
    surah: r.surah,
    ayah: typeof r.ayah === 'number' ? r.ayah : null,
    page: typeof r.page === 'number' ? r.page : null,
    label: r.label,
    favorite: r.favorite === true,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}

export function loadBookmarks(): Bookmark[] {
  const raw = readJson<unknown>(BOOKMARKS_KEY);
  if (!Array.isArray(raw)) return [];
  const out = raw.map(validBookmark).filter((b): b is Bookmark => b !== null);
  // Favorites first, then newest first (Bayan's favorites handling).
  out.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt - a.createdAt);
  return out;
}

export function saveBookmarks(items: Bookmark[]): void {
  writeJson(BOOKMARKS_KEY, items);
}

export function ayahBookmarkId(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

export function pageBookmarkId(page: number): string {
  return `page:${page}`;
}

/** Deep link back to a bookmark (reader params the page already honors). */
export function bookmarkHref(b: Bookmark, locale: string): string {
  if (b.kind === 'page' && b.page !== null) {
    return `/${locale}/quran/${b.surah}?view=page&target=${b.page}`;
  }
  return `/${locale}/quran/${b.surah}?view=ayah&ayah=${b.ayah ?? 1}`;
}

export function loadLastRead(): LastRead | null {
  const raw = readJson<Record<string, unknown>>(LAST_READ_KEY);
  if (!raw || typeof raw.surah !== 'number' || typeof raw.view !== 'string') return null;
  return {
    surah: raw.surah,
    view: raw.view,
    target: typeof raw.target === 'number' ? raw.target : null,
    ayah: typeof raw.ayah === 'number' ? raw.ayah : null,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

export function saveLastRead(value: LastRead): void {
  writeJson(LAST_READ_KEY, value);
}

/** Deep link that restores the last-read position. */
export function lastReadHref(lr: LastRead, locale: string): string {
  const base = `/${locale}/quran/${lr.surah}`;
  if (lr.view === 'ayah' && lr.ayah !== null) return `${base}?view=ayah&ayah=${lr.ayah}`;
  if ((lr.view === 'juz' || lr.view === 'hizb' || lr.view === 'page') && lr.target !== null) {
    return `${base}?view=${lr.view}&target=${lr.target}`;
  }
  return base;
}
