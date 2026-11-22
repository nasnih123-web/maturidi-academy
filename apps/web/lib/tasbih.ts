/**
 * Tasbih domain layer (Phase 5 — Track 2/web).
 *
 * Dhikr presets are localized display strings (messages/*.json) — the
 * counting logic is locale-independent. Remote persistence follows the
 * Track-1 session contract; anonymous users keep a local-only history.
 *
 * Wire contract (source of truth: apps/api/app/modules/quran/{router,schemas}.py):
 * - POST /api/v1/tasbih/sessions (auth) { dhikr_text, target_count? }
 *     → { id, dhikr_text, target_count, count, started_at, ended_at, completed }
 * - POST /api/v1/tasbih/sessions/{id}/count (auth) { amount, idempotency_key? }
 *     → updated session
 * - GET /api/v1/tasbih/today (auth) → { date, totals: [{ dhikr_text, total_count }] }
 */

export interface DhikrSession {
  dhikrKey: string;
  dhikrText: string;
  count: number;
  target: number | null;
  startedAt: string;
  finishedAt: string;
}

export interface DailyTotal {
  date: string;
  total: number;
  sessions: number;
}

/** Server-side today's totals, per dhikr text. */
export interface TodayTotal {
  dhikrText: string;
  total: number;
}

const LOCAL_KEY = 'ma.tasbih_local';

/** Pure: progress fraction 0..1 for the ring. */
export function progressOf(count: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  return Math.min(1, Math.max(0, count / target));
}

/** Pure: has the session reached its target? */
export function targetReached(count: number, target: number | null): boolean {
  return target !== null && target > 0 && count >= target;
}

/**
 * Pure: normalize Arabic/Persian text for speech-recognition matching.
 *
 * ASR transcripts (ar-SA) come back unvocalized with plain alefs and
 * Arabic yeh, while the presets are fully vocalized («سُبْحَانَ ٱللَّٰهِ»).
 * Both sides are folded to one canonical form: harakat (U+064B–U+0652),
 * superscript alef (U+0670) and tatweel (U+0640) are stripped; the alef
 * family (آ U+0622, أ U+0623, إ U+0625, ٱ U+0671) folds to ا (U+0627);
 * Persian ی (U+06CC) folds to Arabic ي (U+064A); ة (U+0629) folds to
 * ه (U+0647); punctuation is dropped and whitespace collapsed.
 */
export function normalizeArabicForMatch(text: string): string {
  return text
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ی/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\p{P}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Pure: how many times the dhikr occurs in an ASR transcript.
 *
 * Counts non-overlapping occurrences on the normalized strings, and
 * again on the fully space-stripped variants (ASR routinely merges
 * «سبحان الله» into «سبحانالله» or splits words apart); the larger
 * count wins. Returns 0 when either side normalizes to empty.
 */
export function countDhikrOccurrences(transcript: string, dhikrText: string): number {
  const haystack = normalizeArabicForMatch(transcript);
  const needle = normalizeArabicForMatch(dhikrText);
  if (!haystack || !needle) return 0;
  const countIn = (h: string, n: string): number => {
    let count = 0;
    let idx = h.indexOf(n);
    while (idx !== -1) {
      count += 1;
      idx = h.indexOf(n, idx + n.length);
    }
    return count;
  };
  const spaced = countIn(haystack, needle);
  const merged = countIn(haystack.replace(/ /g, ''), needle.replace(/ /g, ''));
  return Math.max(spaced, merged);
}

/** Max length of a user-entered custom dhikr. */
export const CUSTOM_DHIKR_MAX_LENGTH = 80;

/**
 * Pure: validate and append a user-entered custom dhikr.
 *
 * Trims the raw input; rejects empty input, input longer than
 * CUSTOM_DHIKR_MAX_LENGTH, input that normalizes to nothing (e.g.
 * punctuation only), and duplicates — compared on the normalized form,
 * so «سُبْحَانَ ٱللَّٰهِ» and «سبحان الله» count as the same dhikr.
 * On success returns a NEW array (the input list is never mutated)
 * with the trimmed value appended; on rejection returns null.
 */
export function addCustomDhikr(list: string[], raw: string): string[] | null {
  const value = raw.trim();
  if (!value || value.length > CUSTOM_DHIKR_MAX_LENGTH) return null;
  const needle = normalizeArabicForMatch(value);
  if (!needle) return null;
  if (list.some((item) => normalizeArabicForMatch(item) === needle)) return null;
  return [...list, value];
}

interface LocalStore {
  sessions: DhikrSession[];
}

function loadLocal(): LocalStore {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return { sessions: [] };
    const o = JSON.parse(raw) as { sessions?: DhikrSession[] };
    return { sessions: Array.isArray(o.sessions) ? o.sessions : [] };
  } catch {
    return { sessions: [] };
  }
}

function saveLocal(store: LocalStore): void {
  try {
    // Cap history so the key cannot grow unbounded.
    const sessions = store.sessions.slice(-200);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ sessions }));
  } catch {
    /* non-fatal */
  }
}

/** Record a finished session locally (always) — returns the local store. */
export function recordLocalSession(session: DhikrSession): void {
  const store = loadLocal();
  store.sessions.push(session);
  saveLocal(store);
}

/** Pure: aggregate local sessions into daily totals (local timezone). */
export function localDailyTotals(sessions: DhikrSession[], days = 7): DailyTotal[] {
  const map = new Map<string, { total: number; sessions: number }>();
  for (const s of sessions) {
    const d = new Date(s.finishedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const cur = map.get(key) ?? { total: 0, sessions: 0 };
    cur.total += s.count;
    cur.sessions += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, days)
    .map(([date, v]) => ({ date, total: v.total, sessions: v.sessions }));
}

export function getLocalSessions(): DhikrSession[] {
  return loadLocal().sessions;
}

function newIdempotencyKey(): string {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/**
 * Persist a finished session to the API (signed-in users): create the
 * session, then add the final count in one call. Resolves false when the
 * request fails or the user is anonymous — the local record (always written
 * by recordLocalSession) remains the source of truth for the UI.
 */
export async function persistSessionRemote(session: DhikrSession): Promise<boolean> {
  try {
    const { authJson } = await import('./auth-client');
    const created = await authJson<{ id?: unknown }>('/api/v1/tasbih/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dhikr_text: session.dhikrText,
        target_count: session.target,
      }),
    });
    const id = typeof created?.id === 'string' ? created.id : null;
    if (!id) return false;
    await authJson<unknown>(`/api/v1/tasbih/sessions/${encodeURIComponent(id)}/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: session.count, idempotency_key: newIdempotencyKey() }),
    });
    return true;
  } catch {
    return false;
  }
}

/** Fetch today's server-side totals (signed-in users); null when unavailable. */
export async function fetchRemoteToday(): Promise<{ date: string; totals: TodayTotal[] } | null> {
  try {
    const { authJson } = await import('./auth-client');
    const body = await authJson<{ date?: unknown; totals?: Array<Record<string, unknown>> }>(
      `/api/v1/tasbih/today`,
    );
    if (!Array.isArray(body?.totals)) return null;
    return {
      date: typeof body.date === 'string' ? body.date : '',
      totals: body.totals
        .map((t) => ({
          dhikrText: typeof t.dhikr_text === 'string' ? t.dhikr_text : '',
          total: typeof t.total_count === 'number' ? t.total_count : 0,
        }))
        .filter((t) => t.dhikrText !== ''),
    };
  } catch {
    return null;
  }
}
