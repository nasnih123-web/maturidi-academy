/**
 * Quran bookmarks + reading history (round 4 — Bayan-style LOCAL
 * storage).
 *
 * Bayan itself stores bookmarks on-device (Room); the web equivalent
 * is localStorage. Since parity step 8 (defect 11) localStorage is
 * the OFFLINE CACHE of an account-synced state: `quran-sync.ts`
 * mirrors this store to `GET/PUT /api/v1/quran/reading-state` for
 * signed-in users (conflict rule: newest updated_at wins). Signed
 * out or offline, everything here keeps working per-device exactly
 * as before. The save functions below notify subscribers on every
 * local mutation so the sync layer can push; `applyReadingState`
 * writes a pulled state WITHOUT notifying (no push echo).
 */

import {
  DEFAULT_SVG_MUSHAF,
  parseSvgMushafKey,
  type SvgMushafKey,
} from './quran-svg-page';

export type BookmarkKind = 'ayah' | 'page';

export interface Bookmark {
  /**
   * Mushaf-scoped id: 'hafs/kfqc:2:255' for an ayah,
   * 'page:hafs/kfqc:42' for a mushaf page. The key is part of the
   * id because an ayah number without its riwayah is not a
   * reference, and a page number without its mushaf is not a page.
   */
  id: string;
  kind: BookmarkKind;
  surah: number;
  /** Ayah number (ayah kind only), in this bookmark's mushaf. */
  ayah: number | null;
  /** Mushaf page number (page kind only, or the page of a non-Hafs ayah). */
  page: number | null;
  /** The mushaf key this bookmark belongs to (legacy: Hafs). */
  mushaf: SvgMushafKey;
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
  /** The mushaf key of the position (legacy: Hafs). */
  mushaf: SvgMushafKey;
  savedAt: number;
}

const BOOKMARKS_KEY = 'quran-bookmarks-v1';
const LAST_READ_KEY = 'quran-last-read-v1';
const SYNC_META_KEY = 'quran-reading-state-meta-v1';

/** Local-mutation subscribers (the sync layer's push trigger). */
type ReadingStateListener = () => void;
const listeners = new Set<ReadingStateListener>();

export function subscribeReadingState(l: ReadingStateListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function readSyncMeta(): { localUpdatedAt: number } {
  const raw = readJson<Record<string, unknown>>(SYNC_META_KEY);
  return {
    localUpdatedAt:
      raw && typeof raw.localUpdatedAt === 'number' ? raw.localUpdatedAt : 0,
  };
}

/** Stamp a local mutation: bump the state's logical clock + notify. */
function touchLocalState(): void {
  writeJson(SYNC_META_KEY, { localUpdatedAt: Date.now() });
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a broken subscriber must never break saving */
    }
  });
}

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
    mushaf: parseSvgMushafKey(typeof r.mushaf === 'string' ? r.mushaf : null),
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
  touchLocalState();
}

export function ayahBookmarkId(
  surah: number,
  ayah: number,
  mushaf: SvgMushafKey = DEFAULT_SVG_MUSHAF,
): string {
  return `${mushaf}:${surah}:${ayah}`;
}

export function pageBookmarkId(
  page: number,
  mushaf: SvgMushafKey = DEFAULT_SVG_MUSHAF,
): string {
  return `page:${mushaf}:${page}`;
}

/** Deep link back to a bookmark — always carrying the mushaf key. */
export function bookmarkHref(b: Bookmark, locale: string): string {
  const mushaf = encodeURIComponent(b.mushaf ?? DEFAULT_SVG_MUSHAF);
  if (b.kind === 'page' && b.page !== null) {
    return `/${locale}/quran/${b.surah}?view=page&target=${b.page}&mushaf=${mushaf}`;
  }
  // A non-Hafs ayah bookmark stores its page: the ayah view is a
  // Hafs-text view, so the bookmark lands on the ayah's own page
  // instead of a Hafs-numbered ayah view under another key.
  if (b.mushaf !== DEFAULT_SVG_MUSHAF && b.page !== null) {
    return `/${locale}/quran/${b.surah}?view=page&target=${b.page}&mushaf=${mushaf}`;
  }
  return `/${locale}/quran/${b.surah}?view=ayah&ayah=${b.ayah ?? 1}&mushaf=${mushaf}`;
}

export function loadLastRead(): LastRead | null {
  const raw = readJson<Record<string, unknown>>(LAST_READ_KEY);
  if (!raw || typeof raw.surah !== 'number' || typeof raw.view !== 'string') return null;
  return {
    surah: raw.surah,
    view: raw.view,
    target: typeof raw.target === 'number' ? raw.target : null,
    ayah: typeof raw.ayah === 'number' ? raw.ayah : null,
    mushaf: parseSvgMushafKey(typeof raw.mushaf === 'string' ? raw.mushaf : null),
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

export function saveLastRead(value: LastRead): void {
  writeJson(LAST_READ_KEY, value);
  touchLocalState();
}

/** The wire shape of the synced reading state (API: reading-state). */
export interface ReadingState {
  bookmarks: Bookmark[];
  lastRead: LastRead | null;
  /** Logical clock of the state (ms epoch) — newest wins. */
  updatedAt: number;
}

/**
 * The state's logical timestamp: the mutation stamp when present,
 * else derived from the data itself (pre-sync local data has no
 * stamp; its newest content time is the honest clock).
 */
export function readingStateUpdatedAt(): number {
  const meta = readSyncMeta().localUpdatedAt;
  if (meta > 0) return meta;
  const lr = loadLastRead();
  let t = lr ? lr.savedAt : 0;
  for (const b of loadBookmarks()) t = Math.max(t, b.createdAt);
  return t;
}

export function readingStateSnapshot(): ReadingState {
  return {
    bookmarks: loadBookmarks(),
    lastRead: loadLastRead(),
    updatedAt: readingStateUpdatedAt(),
  };
}

/**
 * Write a pulled (server) state into the local cache. Deliberately
 * bypasses saveBookmarks/saveLastRead: no mutation stamp, no
 * subscriber notify — the sync layer dispatches its own UI event.
 * The local clock adopts the state's updatedAt verbatim.
 */
export function applyReadingState(state: ReadingState): void {
  writeJson(BOOKMARKS_KEY, state.bookmarks);
  if (state.lastRead) writeJson(LAST_READ_KEY, state.lastRead);
  else {
    try {
      window.localStorage.removeItem(LAST_READ_KEY);
    } catch {
      /* blocked storage */
    }
  }
  writeJson(SYNC_META_KEY, { localUpdatedAt: state.updatedAt });
}

/** Deep link that restores the last-read position (mushaf key carried). */
export function lastReadHref(lr: LastRead, locale: string): string {
  const base = `/${locale}/quran/${lr.surah}`;
  const mushaf = encodeURIComponent(lr.mushaf ?? DEFAULT_SVG_MUSHAF);
  if (lr.view === 'ayah' && lr.ayah !== null)
    return `${base}?view=ayah&ayah=${lr.ayah}&mushaf=${mushaf}`;
  if ((lr.view === 'juz' || lr.view === 'hizb' || lr.view === 'page') && lr.target !== null) {
    return `${base}?view=${lr.view}&target=${lr.target}&mushaf=${mushaf}`;
  }
  return base;
}
