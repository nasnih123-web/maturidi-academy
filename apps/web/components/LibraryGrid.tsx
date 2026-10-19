'use client';

/**
 * LibraryGrid — filterable library grid (client component).
 *
 * Kind tabs + tag chips + a search box that hits GET /api/v1/library/search
 * (ranked over title/tags/transcript). All fetching goes through
 * lib/library-client.ts; all localization happens here at the edge via
 * pickText — presentational children receive plain strings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickText } from '@/lib/localize';
import {
  fetchLibraryItems,
  fetchLibrarySearch,
  LibraryClientError,
} from '@/lib/library-client';
import {
  formatDuration,
  scholarDisplay,
  type LibraryItemSummary,
  type LibraryKind,
} from '@/lib/library';
import { LibraryCard, type LibraryCardLabels } from './LibraryCard';
import { EmptyState } from './EmptyState';

export interface LibraryGridLabels extends LibraryCardLabels {
  searchPlaceholder: string;
  searchAria: string;
  tagFilterLabel: string;
  allTags: string;
  kinds: Record<LibraryKind | 'all', string>;
  noResults: string;
  noResultsHint: string;
  loadFailed: string;
  retry: string;
  loading: string;
  loadMore: string;
  untitled: string;
}

interface Props {
  locale: string;
  initialItems: LibraryItemSummary[];
  initialCursor: string | null;
  labels: LibraryGridLabels;
}

type Status = 'idle' | 'loading' | 'error';

export function LibraryGrid({ locale, initialItems, initialCursor, labels }: Props) {
  const [kind, setKind] = useState<LibraryKind | 'all'>('all');
  const [tag, setTag] = useState<string>('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LibraryItemSummary[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [status, setStatus] = useState<Status>('idle');
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleOf = useCallback((it: LibraryItemSummary) => pickText(it.title, locale) || labels.untitled, [locale, labels.untitled]);
  const scholarOf = useCallback(
    (it: LibraryItemSummary) => scholarDisplay(it.scholar_name, (t) => pickText(t, locale)),
    [locale],
  );

  // Tags harvested from everything currently loaded (honest: only what the
  // API actually returned — never invented).
  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const t of it.tags ?? []) if (t) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b, locale));
  }, [items, locale]);

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      if (query.trim()) {
        const res = await fetchLibrarySearch(query.trim());
        // Client-side kind/tag refinement over ranked results.
        const filtered = res.items.filter(
          (it) =>
            (kind === 'all' || it.kind === kind) &&
            (!tag || (it.tags ?? []).includes(tag)),
        );
        setItems(filtered);
        setCursor(null);
      } else {
        const res = await fetchLibraryItems({
          kind,
          tag: tag || undefined,
          q: undefined,
        });
        setItems(res.items);
        setCursor(res.next_cursor);
      }
      setStatus('idle');
    } catch (err) {
      if (err instanceof LibraryClientError) setStatus('error');
      else setStatus('error');
    }
  }, [kind, tag, query]);

  // Debounced reload on filter change (search box debounces harder below).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void reload(), query ? 450 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [reload, query]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchLibraryItems({ kind, tag: tag || undefined, cursor });
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.next_cursor);
    } catch {
      // Keep existing items; the button stays for a retry.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, kind, tag, loadingMore]);

  const cardLabels: LibraryCardLabels = { openItem: labels.openItem, kindLabel: '' };

  return (
    <div className="lib-grid-wrap">
      <div className="lib-toolbar" role="search">
        <div className="lib-tabs" role="tablist" aria-label={labels.searchAria}>
          {(['all', 'video', 'video_360', 'pdf', 'audio', 'mindmap'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`lib-tab${kind === k ? ' lib-tab-active' : ''}`}
              onClick={() => setKind(k)}
            >
              {labels.kinds[k]}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="lib-search"
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchAria}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {tags.length > 0 && (
          <div className="lib-tagrow" aria-label={labels.tagFilterLabel}>
            <button
              type="button"
              className={`lib-tag${!tag ? ' lib-tag-active' : ''}`}
              onClick={() => setTag('')}
            >
              {labels.allTags}
            </button>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className={`lib-tag${tag === t ? ' lib-tag-active' : ''}`}
                onClick={() => setTag(tag === t ? '' : t)}
                aria-pressed={tag === t}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {status === 'loading' && items.length === 0 && <p className="lib-status" role="status">{labels.loading}</p>}
      {status === 'error' && items.length === 0 && (
        <div className="lib-error" role="alert">
          <p>{labels.loadFailed}</p>
          <button type="button" className="lib-btn" onClick={() => void reload()}>
            {labels.retry}
          </button>
        </div>
      )}

      {status !== 'loading' && status !== 'error' && items.length === 0 && (
        <EmptyState title={labels.noResults} hint={labels.noResultsHint} />
      )}

      {items.length > 0 && (
        <ol className="lib-grid">
          {items.map((it) => (
            <li key={it.id}>
              <LibraryCard
                item={{
                  id: it.id,
                  kind: it.kind,
                  title: titleOf(it),
                  scholarName: scholarOf(it),
                  coverUrl: it.cover_url ?? null,
                  durationLabel: formatDuration(it.duration_seconds, locale),
                  href: `/${locale}/library/${encodeURIComponent(it.id)}`,
                }}
                labels={{ ...cardLabels, kindLabel: labels.kinds[it.kind] ?? it.kind }}
              />
            </li>
          ))}
        </ol>
      )}

      {cursor && status === 'idle' && (
        <div className="lib-more">
          <button type="button" className="lib-btn" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? labels.loading : labels.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
