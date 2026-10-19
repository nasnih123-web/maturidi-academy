'use client';

/**
 * AdhanCountdown — the compact live countdown for the header utility strip.
 *
 * Same hook as the full widget (useAdhanCountdown); renders one line:
 * "next prayer in H:MM:SS" or a quiet link to the widget when no location
 * is configured. Never renders invented times.
 */
import Link from 'next/link';
import { useAdhanCountdown } from '@/lib/hooks/useAdhanCountdown';
import type { AdhanSettings } from '@/lib/settings';
import type { PrayerName } from '@/lib/adhan';

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
  const { state } = useAdhanCountdown(settings, locale);

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
