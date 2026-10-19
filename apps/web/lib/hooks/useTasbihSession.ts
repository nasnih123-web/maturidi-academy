'use client';

/**
 * useTasbihSession — digital tasbih counter state machine.
 *
 * Owns count/target/session lifecycle. Persistence (local + remote) goes
 * through lib/tasbih.ts; the component only renders and forwards events.
 * Keyboard: the component binds Space/Enter on the counter button (native
 * <button> semantics) — this hook stays input-agnostic.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getLocalSessions,
  localDailyTotals,
  persistSessionRemote,
  progressOf,
  recordLocalSession,
  targetReached,
  fetchRemoteToday,
  type DailyTotal,
  type DhikrSession,
  type TodayTotal,
} from '../tasbih';
import { isLoggedIn } from '../auth-client';

export interface TasbihSessionState {
  dhikrKey: string;
  dhikrText: string;
  count: number;
  target: number | null;
  progress: number;
  reached: boolean;
  startedAt: string | null;
  totals: DailyTotal[];
  totalsLoading: boolean;
  /** Today's server-side totals per dhikr (signed-in users). */
  todayRemote: TodayTotal[];
}

export function useTasbihSession(initialTarget: number | null = 100) {
  const [dhikrKey, setDhikrKey] = useState('subhanallah');
  const [dhikrText, setDhikrText] = useState('');
  const [count, setCount] = useState(0);
  const [target, setTarget] = useState<number | null>(initialTarget);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [totals, setTotals] = useState<DailyTotal[]>([]);
  const [todayRemote, setTodayRemote] = useState<TodayTotal[]>([]);
  const [totalsLoading, setTotalsLoading] = useState(true);

  const refreshTotals = useCallback(async () => {
    setTotalsLoading(true);
    setTotals(localDailyTotals(getLocalSessions(), 7));
    if (isLoggedIn()) {
      const remote = await fetchRemoteToday();
      setTodayRemote(remote?.totals ?? []);
    } else {
      setTodayRemote([]);
    }
    setTotalsLoading(false);
  }, []);

  useEffect(() => {
    void refreshTotals();
  }, [refreshTotals]);

  const selectDhikr = useCallback((key: string, text: string) => {
    // Switching dhikr starts a fresh count; the previous partial count is
    // kept only via an explicit finish (simplest honest model).
    setDhikrKey(key);
    setDhikrText(text);
    setCount(0);
    setStartedAt(null);
  }, []);

  const increment = useCallback(() => {
    setCount((c) => {
      if (c === 0) setStartedAt(new Date().toISOString());
      return c + 1;
    });
  }, []);

  const decrement = useCallback(() => {
    setCount((c) => Math.max(0, c - 1));
  }, []);

  const reset = useCallback(() => {
    setCount(0);
    setStartedAt(null);
  }, []);

  const finishSession = useCallback(async (): Promise<void> => {
    if (count <= 0) return;
    const session: DhikrSession = {
      dhikrKey,
      dhikrText,
      count,
      target,
      startedAt: startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    recordLocalSession(session);
    await persistSessionRemote(session);
    setCount(0);
    setStartedAt(null);
    await refreshTotals();
  }, [count, dhikrKey, dhikrText, target, startedAt, refreshTotals]);

  const state: TasbihSessionState = useMemo(
    () => ({
      dhikrKey,
      dhikrText,
      count,
      target,
      progress: progressOf(count, target),
      reached: targetReached(count, target),
      startedAt,
      totals,
      totalsLoading,
      todayRemote,
    }),
    [dhikrKey, dhikrText, count, target, startedAt, totals, totalsLoading, todayRemote],
  );

  return {
    state,
    selectDhikr,
    increment,
    decrement,
    reset,
    finishSession,
    setTarget,
    refreshTotals,
  };
}
