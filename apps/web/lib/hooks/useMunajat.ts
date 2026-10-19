'use client';

/**
 * useMunajat — resolves the night-munajat calm theme state.
 *
 * Clock-driven via lib/munajat.ts (user-local time, 02:00–05:00 default)
 * with a manual override toggle. The component applies `data-munajat="on"`
 * on <html> and renders the toggle; all decisions are pure functions.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isMunajatTime,
  loadMunajatOverride,
  resolveMunajatActive,
  saveMunajatOverride,
  type MunajatOverride,
} from '../munajat';
import type { MunajatSettings } from '../settings';

export function useMunajat(settings: MunajatSettings) {
  const [override, setOverride] = useState<MunajatOverride>(null);
  const [clockActive, setClockActive] = useState(false);

  useEffect(() => {
    setOverride(loadMunajatOverride());
    const evaluate = () => setClockActive(isMunajatTime(new Date(), settings));
    evaluate();
    const id = setInterval(evaluate, 60_000);
    return () => clearInterval(id);
  }, [settings]);

  const active = resolveMunajatActive(clockActive, override);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (active) document.documentElement.setAttribute('data-munajat', 'on');
    else document.documentElement.removeAttribute('data-munajat');
  }, [active]);

  const setManual = useCallback((v: MunajatOverride) => {
    saveMunajatOverride(v);
    setOverride(v);
  }, []);

  return { active, clockActive, override, setManual };
}
