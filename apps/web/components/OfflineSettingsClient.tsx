'use client';

/**
 * OfflineSettingsClient — Phase 13 "what to keep offline" settings.
 *
 * Backend contract (Track 1, apps/api/app/modules/sync):
 *   GET /api/v1/sync/offline-pack
 *     → {items:[{kind:"lesson"|"library_item", ref_id, title:LocalizedText,
 *                 score:int, reason:"started"|"followed"|"popular"}],
 *         generated_at}
 *   (reasons are codes, not display text — localized client-side, §15.4)
 *
 * The three priority toggles (started > followed > popular, per spec) are
 * a LOCAL download filter persisted in IndexedDB: "Download now" prefetches
 * the pack items of the enabled reasons through their real public GETs
 * (lms/lessons, library/items) so the service worker caches the bodies.
 * Item titles come from the pack's LocalizedText in the current locale.
 *
 * Second section: web-push subscription (web-push.ts), a separate channel
 * from FCM; the backend honors `notification_preferences` when dispatching.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPackPrefs, setPackPrefs, registerPackEntry } from '@/lib/offline-db';
import {
  getPushState,
  subscribeWebPush,
  unsubscribeWebPush,
  pushSupported,
  type PushState,
} from '@/lib/web-push';

import { apiBaseUrl } from '@/lib/api-base';

const API_BASE = apiBaseUrl();
const ACCESS_KEY = 'ma.access_token';

export interface OfflineSettingsLabels {
  title: string;
  subtitle: string;
  tiersTitle: string;
  tiersHint: string;
  tierStarted: string;
  tierFollowed: string;
  tierPopular: string;
  tierStartedDesc: string;
  tierFollowedDesc: string;
  tierPopularDesc: string;
  items: string; // "{count}"
  prefetch: string;
  prefetching: string;
  prefetched: string;
  prefetchFailed: string;
  loading: string;
  loadFailed: string;
  packEmpty: string;
  pushTitle: string;
  pushHint: string;
  pushEnable: string;
  pushDisable: string;
  pushWorking: string;
  pushFailed: string;
  pushUnsupported: string;
  pushDenied: string;
  pushSubscribed: string;
  pushUnsubscribed: string;
}

type PackReason = 'started' | 'followed' | 'popular';

interface PackItem {
  kind: string;
  ref_id: string;
  title: Record<string, string>;
  score: number;
  reason: PackReason;
}

const REASONS: PackReason[] = ['started', 'followed', 'popular'];

function authHeader(): Record<string, string> {
  try {
    const token = window.localStorage.getItem(ACCESS_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function pickTitle(title: Record<string, string>, locale: string, fallback: string): string {
  return title[locale] || title.fa || title.en || title.ar || fallback;
}

/** Real public GET for a pack item — the SW caches these (network-first). */
function itemUrl(item: PackItem): string | null {
  if (item.kind === 'lesson') return `${API_BASE}/api/v1/lms/lessons/${encodeURIComponent(item.ref_id)}`;
  if (item.kind === 'library_item')
    return `${API_BASE}/api/v1/library/items/${encodeURIComponent(item.ref_id)}`;
  return null;
}

export function OfflineSettingsClient({
  locale,
  labels,
}: {
  locale: string;
  labels: OfflineSettingsLabels;
}) {
  const [items, setItems] = useState<PackItem[] | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    started: true,
    followed: true,
    popular: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefetching, setPrefetching] = useState(false);
  const [pushState, setPushState] = useState<PushState>('unsubscribed');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await getPackPrefs();
      if (!cancelled) setEnabled((e) => ({ ...e, ...local }));
      try {
        const res = await fetch(`${API_BASE}/api/v1/sync/offline-pack`, { headers: authHeader() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pack = (await res.json()) as { items?: PackItem[] };
        if (!cancelled) setItems(Array.isArray(pack.items) ? pack.items : []);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
      setPushState(await getPushState());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const g: Record<PackReason, PackItem[]> = { started: [], followed: [], popular: [] };
    for (const it of items ?? []) {
      if (g[it.reason]) g[it.reason].push(it);
    }
    for (const r of REASONS) g[r].sort((a, b) => b.score - a.score);
    return g;
  }, [items]);

  const toggle = useCallback(
    (reason: PackReason) => {
      setEnabled((e) => {
        const next = { ...e, [reason]: !e[reason] };
        void setPackPrefs(next);
        return next;
      });
    },
    [],
  );

  const onPrefetch = useCallback(async () => {
    if (!items) return;
    setPrefetching(true);
    setNotice(null);
    try {
      let ok = 0;
      for (const item of items) {
        if (!enabled[item.reason]) continue;
        const url = itemUrl(item);
        if (!url) continue;
        try {
          const res = await fetch(url, { headers: authHeader() });
          if (res.ok) {
            ok++;
            await registerPackEntry({ key: `${item.kind}:${item.ref_id}`, kind: 'item', ref: item.ref_id, etag: null });
          }
        } catch {
          /* per-item best effort — offline is the expected failure here */
        }
      }
      setNotice(`${labels.prefetched} (${ok})`);
    } catch {
      setNotice(labels.prefetchFailed);
    } finally {
      setPrefetching(false);
    }
  }, [items, enabled, labels]);

  const onPushToggle = useCallback(async () => {
    setPushBusy(true);
    try {
      if (pushState === 'subscribed') {
        await unsubscribeWebPush();
        setPushState(await getPushState());
      } else {
        await subscribeWebPush(locale);
        setPushState('subscribed');
      }
    } catch {
      setPushState(await getPushState());
      setNotice(labels.pushFailed);
    } finally {
      setPushBusy(false);
    }
  }, [pushState, locale, labels]);

  const tierTitle = (r: PackReason) =>
    r === 'started' ? labels.tierStarted : r === 'followed' ? labels.tierFollowed : labels.tierPopular;
  const tierDesc = (r: PackReason) =>
    r === 'started'
      ? labels.tierStartedDesc
      : r === 'followed'
        ? labels.tierFollowedDesc
        : labels.tierPopularDesc;

  return (
    <div className="offline-settings" data-testid="offline-settings">
      <header className="offline-settings-head">
        <h1>{labels.title}</h1>
        <p>{labels.subtitle}</p>
      </header>

      <section className="offline-card" aria-labelledby="tiers-h">
        <h2 id="tiers-h">{labels.tiersTitle}</h2>
        <p className="offline-hint">{labels.tiersHint}</p>
        {loading ? (
          <p className="offline-hint">{labels.loading}</p>
        ) : loadError ? (
          <p className="offline-hint">{labels.loadFailed}</p>
        ) : (
          <ul className="offline-tiers">
            {REASONS.map((r) => (
              <li key={r} className="offline-tier">
                <label className="offline-tier-row">
                  <input
                    type="checkbox"
                    checked={!!enabled[r]}
                    onChange={() => toggle(r)}
                    aria-label={tierTitle(r)}
                  />
                  <span className="offline-tier-text">
                    <strong>{tierTitle(r)}</strong>
                    <span className="offline-hint">{tierDesc(r)}</span>
                    {grouped[r].length > 0 && (
                      <span className="offline-hint">
                        {labels.items.replace('{count}', String(grouped[r].length))} —{' '}
                        {grouped[r]
                          .slice(0, 3)
                          .map((it) => pickTitle(it.title, locale, it.ref_id))
                          .join(' · ')}
                        {grouped[r].length > 3 ? ' …' : ''}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {(items?.length ?? 0) === 0 && !loading && !loadError && (
          <p className="offline-hint">{labels.packEmpty}</p>
        )}
        <div className="offline-actions">
          <button
            type="button"
            className="offline-btn secondary"
            onClick={onPrefetch}
            disabled={prefetching || !items}
          >
            {prefetching ? labels.prefetching : labels.prefetch}
          </button>
        </div>
      </section>

      <section className="offline-card" aria-labelledby="push-h">
        <h2 id="push-h">{labels.pushTitle}</h2>
        <p className="offline-hint">{labels.pushHint}</p>
        {!pushSupported() ? (
          <p className="offline-hint">{labels.pushUnsupported}</p>
        ) : pushState === 'denied' ? (
          <p className="offline-hint">{labels.pushDenied}</p>
        ) : (
          <div className="offline-actions">
            <button type="button" className="offline-btn" onClick={onPushToggle} disabled={pushBusy}>
              {pushBusy
                ? labels.pushWorking
                : pushState === 'subscribed'
                  ? labels.pushDisable
                  : labels.pushEnable}
            </button>
            <span className="offline-hint">
              {pushState === 'subscribed' ? labels.pushSubscribed : labels.pushUnsubscribed}
            </span>
          </div>
        )}
      </section>

      {notice && (
        <p className="offline-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
