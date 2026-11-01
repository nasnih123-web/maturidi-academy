/**
 * Quran bookmarks + reading history (round 4 — Bayan-style LOCAL
 * storage).
 *
 * Bayan itself stores bookmarks on-device (Room); the web equivalent
 * is localStorage — NOT a shortcut, and deliberately NOT a server
 * user-account feature in this round (no account scope, no sync).
 * Everything here is per-device and never leaves the browser.
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
