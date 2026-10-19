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
