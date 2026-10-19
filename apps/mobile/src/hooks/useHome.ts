/**
 * apps/mobile — src/hooks/useHome.ts / useQuran.ts / useTasbih.ts / useAdhan.ts
 *
 * Data hooks: thin orchestration over the services layer. Each hook owns
 * loading/error/refresh state for its screen and nothing else (ADR-001).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { getHomeSections } from "../services/home";
import type { HomeSection } from "../types";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  refresh: () => void;
}

function useAsync<T>(fn: () => Promise<{ data: T; offline?: boolean }>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then(({ data: d, offline: off }) => {
        if (!alive) return;
        setData(d);
        setOffline(off === true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.code : "unknown");
        setOffline(e instanceof ApiError && e.isNetworkError);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { data, loading, error, offline, refresh };
}

export function useHomeSections(): AsyncState<HomeSection[]> {
  return useAsync(async () => ({ data: await getHomeSections() }));
}
