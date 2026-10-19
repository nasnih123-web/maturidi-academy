/**
 * apps/mobile — src/hooks/useSync.ts
 *
 * Manual sync trigger + pending-op counter for the Settings screen.
 * The engine itself lives in lib/sync.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { pendingOpCount, syncNow, type SyncReport } from "../lib/sync";

export function useSyncStatus(): {
  pending: number;
  syncing: boolean;
  lastReport: SyncReport | null;
  sync: () => Promise<void>;
  refreshPending: () => Promise<void>;
} {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);

  const refreshPending = useCallback(async () => {
    setPending(await pendingOpCount().catch(() => 0));
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const report = await syncNow();
      setLastReport(report);
    } finally {
      await refreshPending();
      setSyncing(false);
    }
  }, [refreshPending]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  return { pending, syncing, lastReport, sync, refreshPending };
}
