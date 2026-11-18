/**
 * HifzHub — the separate hifz flows (dashboard / testing / voice
 * search / Tasmi), kept OFF the study page by the user's standing
 * order (2026-11-06: no results/stats/history on the study page).
 *
 * Client component; all strings come from the server page as labels.
 * Navigation to an ayah goes to the study page for that surah.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HifzDashboard, type HifzDashboardLabels } from '@/components/HifzDashboard';
import { HifzTasmiPanel, type HifzTasmiLabels } from '@/components/HifzTasmiPanel';
import { HifzTestingMode, type HifzTestingLabels } from '@/components/HifzTestingMode';
import { HifzVoiceSearch, type HifzVoiceSearchLabels } from '@/components/HifzVoiceSearch';
import { useProfileGate } from '@/lib/profile-client';

export interface HifzHubLabels {
  title: string;
  tabDashboard: string;
  tabTesting: string;
  tabVoiceSearch: string;
  tabTasmi: string;
  dashboard: HifzDashboardLabels;
  testing: HifzTestingLabels;
  voiceSearch: HifzVoiceSearchLabels;
  tasmi: HifzTasmiLabels;
  /** Phase B gate wall strings (advanced tabs: testing + tasmi). */
  profileRequired: string;
  completeProfile: string;
}

export function HifzHub({
  labels,
  locale,
  profileRequired = false,
}: {
  labels: HifzHubLabels;
  locale: string;
  /** CRM flag profile.require_for_hifz_advanced, via public settings. */
  profileRequired?: boolean;
}) {
  const [tab, setTab] = useState<'dashboard' | 'testing' | 'voice' | 'tasmi'>('dashboard');
  const gate = useProfileGate(profileRequired);
  const advancedBlocked =
    (tab === 'testing' || tab === 'tasmi') && gate.kind === 'blocked';

  const goToAyah = (surah: number, ayah: number) => {
    window.location.href = `/${locale}/quran/${surah}?tab=hifz&ayah=${ayah}`;
  };

  return (
    <div className="hifz-hub" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
      <h1>{labels.title}</h1>
      <div role="tablist" aria-label={labels.title}>
        {(
          [
            ['dashboard', labels.tabDashboard],
            ['testing', labels.tabTesting],
            ['voice', labels.tabVoiceSearch],
            ['tasmi', labels.tabTasmi],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <HifzDashboard labels={labels.dashboard} onNavigate={goToAyah} />}
      {tab === 'testing' &&
        (advancedBlocked ? (
          <ProfileGateWall labels={labels} locale={locale} />
        ) : (
          <HifzTestingMode labels={labels.testing} />
        ))}
      {tab === 'voice' && <HifzVoiceSearch onNavigate={goToAyah} labels={labels.voiceSearch} />}
      {tab === 'tasmi' &&
        (advancedBlocked ? (
          <ProfileGateWall labels={labels} locale={locale} />
        ) : (
          <HifzTasmiPanel labels={labels.tasmi} />
        ))}
    </div>
  );
}

/** Phase B wall shown in place of the advanced tabs when gated. */
function ProfileGateWall({ labels, locale }: { labels: HifzHubLabels; locale: string }) {
  const next = encodeURIComponent(`/${locale}/quran/hifz`);
  return (
    <div>
      <p>{labels.profileRequired}</p>
      <p>
        <Link className="soc-btn soc-btn-primary" href={`/${locale}/profile?next=${next}`}>
          {labels.completeProfile}
        </Link>
      </p>
    </div>
  );
}
