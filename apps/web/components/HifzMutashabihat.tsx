/**
 * HifzMutashabihat — phrases shared with other ayahs, computed by the
 * server from our own Tanzil text (never hard-coded).
 *
 * A collapsible panel under the study page: each phrase group gets its
 * own colour (rotating palette, toggleable). Clicking another ayah
 * navigates there. Nothing is shown when the ayah has no shared
 * phrases or when the request fails (e.g. signed out).
 */
import { useEffect, useState } from 'react';
import { authJson } from '@/lib/auth-client';
// Labels type lives in lib/hifz-study-types.ts (re-exported here so
// existing importers keep importing it from this component).
import type { HifzMutashabihatLabels } from '@/lib/hifz-study-types';
export type { HifzMutashabihatLabels } from '@/lib/hifz-study-types';

const HIFZ_API = '/api/v1/quran/hifz';

export interface MutashabihatGroup {
  phrase: string;
  occurrences: { surah: number; ayah: number; text: string }[];
}


const GROUP_COLORS = ['#7a4a00', '#1d4ed8', '#15803d', '#b3261e', '#6d28d9', '#0e7490'];

export function HifzMutashabihat({
  surah,
  ayah,
  onNavigate,
  labels,
}: {
  surah: number;
  ayah: number;
  onNavigate: (surah: number, ayah: number) => void;
  labels: HifzMutashabihatLabels;
}) {
  const [groups, setGroups] = useState<MutashabihatGroup[] | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    void authJson<MutashabihatGroup[]>(
      `${HIFZ_API}/mutashabihat?surah=${surah}&ayah=${ayah}`,
    )
      .then((g) => {
        if (!cancelled) setGroups(g);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [surah, ayah]);

  if (groups === null || groups.length === 0) return null;
  return (
    <section className="hifz-mutashabihat" aria-label={labels.title}>
      <div className="hifz-mutashabihat-head">
        <h3>{labels.title}</h3>
        <button type="button" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? labels.hide : labels.show}
        </button>
      </div>
      {visible && (
        <ul>
          {groups.map((g, i) => (
            <li key={g.phrase} style={{ borderInlineStart: `4px solid ${GROUP_COLORS[i % GROUP_COLORS.length]}` }}>
              <p className="hifz-mutashabihat-phrase" dir="rtl" lang="ar">
                {g.phrase}
              </p>
              <p>
                {g.occurrences.map((o) => (
                  <button
                    key={`${o.surah}:${o.ayah}`}
                    type="button"
                    onClick={() => onNavigate(o.surah, o.ayah)}
                    title={labels.goToAyah}
                  >
                    {o.surah}:{o.ayah}
                  </button>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
