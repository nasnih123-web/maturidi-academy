'use client';

/**
 * SwRegister — registers the Phase-13 service worker once per page load.
 * Pure wiring: no UI. Skipped on non-http(s) origins (file:// screenshots).
 */
import { useEffect } from 'react';

export function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    const proto = window.location.protocol;
    if (proto !== 'http:' && proto !== 'https:') return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline-first is best-effort; the app works without it */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
