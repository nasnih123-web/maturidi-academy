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
import { HifzDashboard, type HifzDashboardLabels } from '@/components/HifzDashboard';
import { HifzTasmiPanel, type HifzTasmiLabels } from '@/components/HifzTasmiPanel';
import { HifzTestingMode, type HifzTestingLabels } from '@/components/HifzTestingMode';
import { HifzVoiceSearch, type HifzVoiceSearchLabels } from '@/components/HifzVoiceSearch';

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
}

export function HifzHub({ labels, locale }: { labels: HifzHubLabels; locale: string }) {
  const [tab, setTab] = useState<'dashboard' | 'testing' | 'voice' | 'tasmi'>('dashboard');

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
      {tab === 'testing' && <HifzTestingMode labels={labels.testing} />}
      {tab === 'voice' && <HifzVoiceSearch onNavigate={goToAyah} labels={labels.voiceSearch} />}
      {tab === 'tasmi' && <HifzTasmiPanel labels={labels.tasmi} />}
    </div>
  );
}
