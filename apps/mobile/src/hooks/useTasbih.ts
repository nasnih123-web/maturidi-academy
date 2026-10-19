/**
 * apps/mobile — src/hooks/useTasbih.ts / useAdhan.ts
 *
 * Tasbih counter state and prayer-time state.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  increment as svcIncrement,
  startSession as svcStartSession,
  todayTotals as svcTodayTotals,
} from "../services/tasbih";
import type { DhikrTotal, TasbihSession } from "../types";

export function useTasbih(): {
  session: TasbihSession | null;
  totals: DhikrTotal[];
  starting: boolean;
  error: string | null;
  start: (dhikrText: string, targetCount?: number) => Promise<void>;
  tap: () => Promise<void>;
  reset: () => void;
} {
  const [session, setSession] = useState<TasbihSession | null>(null);
  const [totals, setTotals] = useState<DhikrTotal[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    svcTodayTotals()
      .then((t) => setTotals(t.totals))
      .catch(() => undefined);
  }, []);

  const start = useCallback(async (dhikrText: string, targetCount?: number) => {
    setStarting(true);
    setError(null);
    try {
      const s = await svcStartSession(dhikrText, targetCount);
      setSession(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
    } finally {
      setStarting(false);
    }
  }, []);

  const tap = useCallback(async () => {
    if (!session) return;
    try {
      const s = await svcIncrement(session.id, 1);
      setSession(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
    }
  }, [session]);

  const reset = useCallback(() => setSession(null), []);

  return { session, totals, starting, error, start, tap, reset };
}
