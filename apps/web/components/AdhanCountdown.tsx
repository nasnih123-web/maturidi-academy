'use client';

/**
 * AdhanCountdown — the compact live countdown for the header utility strip.
 *
 * Same hook as before (useAdhanCountdown); renders one line:
 * "next prayer in H:MM:SS" or a quiet link to the widget when no location
 * is configured. Never renders invented times.
 *
 * The strip follows the user's saved page choice (ma.adhan_choice): on
 * mount and on every ma:adhan-choice event it re-reads the choice, stores
 * its coordinates as the saved location, overrides method/madhab, and
 * reloads — so the banner on every page (including the /adhan page itself)
 * reflects the current selection without a reload.
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAdhanCountdown } from '@/lib/hooks/useAdhanCountdown';
import type { AdhanSettings } from '@/lib/settings';
import {
  ADHAN_CHOICE_EVENT,
  loadAdhanChoice,
  saveLocation,
  type AdhanChoice,
  type PrayerName,
} from '@/lib/adhan';

export interface AdhanCountdownLabels {
  prefix: string;
  prayerNames: Record<PrayerName, string>;
  setupLink: string;
  countdownAria: string;
}

export function AdhanCountdown({
  locale,
  settings,
  labels,
}: {
  locale: string;
  settings: AdhanSettings;
  labels: AdhanCountdownLabels;
}) {
  const [override, setOverride] = useState<AdhanChoice | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const effectiveSettings: AdhanSettings = override
    ? { ...settings, method: override.method, madhab: override.madhab }
    : settings;
  const { state, reload } = useAdhanCountdown(effectiveSettings, locale);
  // The hook returns a fresh `reload` closure every render; calling it from
  // an effect that lists it would loop. Keep it in a ref instead.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    const applyChoice = () => {
      const choice = loadAdhanChoice();
      if (!choice) return;
      saveLocation({ lat: choice.lat, lng: choice.lng, label: null, source: 'manual' });
      setOverride(choice);
      setReloadTick((n) => n + 1);
    };
    applyChoice();
    window.addEventListener(ADHAN_CHOICE_EVENT, applyChoice);
    return () => window.removeEventListener(ADHAN_CHOICE_EVENT, applyChoice);
  }, []);

  useEffect(() => {
    if (reloadTick > 0) reloadRef.current();
  }, [reloadTick]);

  if (state.status !== 'ready' || !state.next) {
    if (state.status === 'needs_location') {
      return (
        <Link href={`/${locale}/adhan`} className="adhan-strip-link">
          {labels.setupLink}
        </Link>
      );
    }
    return null;
  }

  return (
    <span
      className="adhan-strip"
      role="timer"
      aria-label={`${labels.countdownAria}: ${labels.prayerNames[state.next.name]}`}
    >
      <span className="adhan-strip-label">
        {labels.prefix} {labels.prayerNames[state.next.name]}
      </span>{' '}
      <span className="adhan-strip-time" dir="ltr">
        {state.countdown}
      </span>
    </span>
  );
}
