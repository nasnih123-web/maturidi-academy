/**
 * Account sync for the Quran reading state (parity step 8 —
 * defect 11): bookmarks + last-read position.
 *
 * localStorage (`quran-bookmarks.ts`) remains the offline cache and
 * the only store for signed-out users. For signed-in users this
 * module mirrors the state to `GET/PUT /api/v1/quran/reading-state`:
 *
 * - pull on init and on every auth change; the newer side wins;
 * - push (debounced) after every local mutation;
 * - conflict rule, same as the server's: the state with the newest
 *   `updated_at` (the state's own logical clock, ms epoch) wins.
 *   A PUT that loses the race gets a 409 — the client then re-GETs
 *   and adopts the server's newer state verbatim.
 *
 * After adopting a pulled state, `ma:quran-state-synced` is
 * dispatched so open reader components reload from the cache.
 * Every failure is silent by design: sync must never break reading.
 */

import { AuthFetchError, authFetch, isLoggedIn } from './auth-client';
import {
  applyReadingState,
  readingStateSnapshot,
  subscribeReadingState,
  type Bookmark,
  type LastRead,
  type ReadingState,
} from './quran-bookmarks';

const API_PATH = '/api/v1/quran/reading-state';
export const QURAN_STATE_SYNCED_EVENT = 'ma:quran-state-synced';

interface ServerReadingState {
  bookmarks: Bookmark[];
  last_read: LastRead | null;
  updated_at: number;
}

function toLocal(s: ServerReadingState): ReadingState {
  return {
    bookmarks: Array.isArray(s.bookmarks) ? s.bookmarks : [],
    lastRead: s.last_read ?? null,
    updatedAt: typeof s.updated_at === 'number' ? s.updated_at : 0,
  };
}

let started = false;
let pulling = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function notifyUi(): void {
  window.dispatchEvent(new CustomEvent(QURAN_STATE_SYNCED_EVENT));
}

async function fetchServerState(): Promise<ReadingState> {
  const res = await authFetch(API_PATH);
  return toLocal((await res.json()) as ServerReadingState);
}

/** Pull once; adopt the server state iff it is the newer side. */
export async function pullReadingState(): Promise<void> {
  if (!isLoggedIn() || pulling) return;
  pulling = true;
  try {
    const server = await fetchServerState();
    const local = readingStateSnapshot();
    if (server.updatedAt > local.updatedAt) {
      applyReadingState(server);
      notifyUi();
    } else if (local.updatedAt > server.updatedAt) {
      // Local device is ahead (e.g. bookmarks made while signed
      // out) — push instead of overwriting them with older data.
      await pushReadingState();
    }
  } catch {
    /* offline / session ended — the local cache stands */
  } finally {
    pulling = false;
  }
}

/** Push the current local snapshot; on 409 adopt the server's. */
export async function pushReadingState(): Promise<void> {
  if (!isLoggedIn()) return;
  const snap = readingStateSnapshot();
  try {
    await authFetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookmarks: snap.bookmarks,
        last_read: snap.lastRead,
        updated_at: snap.updatedAt,
      }),
    });
  } catch (err) {
    if (err instanceof AuthFetchError && err.status === 409) {
      try {
        const server = await fetchServerState();
        applyReadingState(server);
        notifyUi();
      } catch {
        /* keep local; next mutation retries */
      }
    }
    /* other failures: stay local; the next mutation retries */
  }
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushReadingState();
  }, 900);
}

/** Idempotent wiring: call from any Quran surface's mount effect. */
export function initQuranReadingSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  subscribeReadingState(schedulePush);
  window.addEventListener('ma:auth-change', () => {
    void pullReadingState();
  });
  void pullReadingState();
}
