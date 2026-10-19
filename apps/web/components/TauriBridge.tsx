'use client';

/**
 * TauriBridge — desktop glue (Phase 13).
 *
 * When the web app runs inside the Tauri shell, the tray menu's "Sync now"
 * item emits a `sync-now` event to the frontend; this bridge listens for it
 * and triggers the web sync runner. Outside Tauri it is a complete no-op.
 * Pure wiring — no UI, no business logic.
 */
import { useEffect } from 'react';
import { syncRunner } from '@/lib/sync-runner';

interface TauriEventApi {
  listen: (event: string, cb: () => void) => Promise<() => void>;
}

declare global {
  interface Window {
    __TAURI__?: { event: TauriEventApi };
  }
}

export function TauriBridge() {
  useEffect(() => {
    const api = window.__TAURI__?.event;
    if (!api) return;
    let unlisten: (() => void) | null = null;
    api
      .listen('sync-now', () => {
        void syncRunner.syncNow();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* tray sync is best-effort */
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);
  return null;
}

/** True when running inside the Tauri desktop shell (for conditional UI). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}
