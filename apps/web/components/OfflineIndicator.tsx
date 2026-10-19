'use client';

/**
 * OfflineIndicator — site-wide connectivity pill in the status strip.
 *
 * States: online (green) / offline (red) / syncing (amber, "syncing…").
 * Shows the pending outbox-ops count from IndexedDB (sync-runner.ts).
 *
 * TEST HOOKS (screenshot/CI only): `?offline=1` forces the offline pill,
 * `?syncing=1` forces the syncing pill, `?pending=N` forces the count.
 * These read the URL at render time and never affect real state.
 */
import { useEffect, useState } from 'react';
import { syncRunner, type SyncSnapshot } from '@/lib/sync-runner';

export interface OfflineIndicatorLabels {
  online: string;
  offline: string;
  syncing: string;
  pendingOps: string; // template with {count}
  aria: string;
}

interface ForcedState {
  offline: boolean;
  syncing: boolean;
  pending: number | null;
}

function readForcedState(): ForcedState {
  if (typeof window === 'undefined') return { offline: false, syncing: false, pending: null };
  const q = new URLSearchParams(window.location.search);
  const pendingRaw = q.get('pending');
  const pending = pendingRaw != null && /^\d+$/.test(pendingRaw) ? parseInt(pendingRaw, 10) : null;
  return { offline: q.get('offline') === '1', syncing: q.get('syncing') === '1', pending };
}

export function OfflineIndicator({ labels }: { labels: OfflineIndicatorLabels }) {
  const [snap, setSnap] = useState<SyncSnapshot>(() => syncRunner.getSnapshot());
  // Forced states are a screenshot/test hook: they must be read on the
  // client at mount (SSR/hydration reuses the server-rendered state, so the
  // initializer alone would never see the query string).
  const [forced, setForced] = useState<ForcedState>({ offline: false, syncing: false, pending: null });

  useEffect(() => {
    setForced(readForcedState());
    syncRunner.start();
    return syncRunner.subscribe(setSnap);
  }, []);

  const showOffline = forced.offline || snap.state === 'offline';
  const showSyncing = !showOffline && (forced.syncing || snap.state === 'syncing');
  const pending = forced.pending ?? snap.pending;

  const tone = showOffline ? 'off' : showSyncing ? 'sync' : 'on';
  const text = showOffline ? labels.offline : showSyncing ? labels.syncing : labels.online;

  return (
    <span
      className={`offline-indicator tone-${tone}`}
      role="status"
      aria-label={labels.aria}
      data-testid="offline-indicator"
      data-state={showOffline ? 'offline' : showSyncing ? 'syncing' : 'online'}
    >
      <span className="offline-dot" aria-hidden="true" />
      <span className="offline-text">{text}</span>
      {pending > 0 && (
        <span className="offline-pending" title={labels.pendingOps.replace('{count}', String(pending))}>
          {pending}
        </span>
      )}
    </span>
  );
}
