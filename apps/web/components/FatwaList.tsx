'use client';

/**
 * FatwaList — client-side filter UI for the fatwa listing page.
 *
 * Pure presentation + filtering: items arrive as props from the server
 * page (published homepage-section items, never invented here). Search
 * matches title / subtitle / category; category chips are derived from
 * the items themselves, so every chip has at least one result. No fetch
 * happens here (ADR-0002): the page owns data access, this component
 * only filters what it was given.
 */
import { useMemo, useState } from 'react';

export interface FatwaListItem {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  badge: string;
  href: string | null;
}

export interface FatwaListLabels {
  searchLabel: string;
  searchPlaceholder: string;
  categoryAll: string;
  resultsCount: string;
  emptyTitle: string;
  emptyHint: string;
  askAssistantAbout: string;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/[\u064B-\u0652]/g, '');
}

export function FatwaList({
  items,
  locale,
  labels,
}: {
  items: FatwaListItem[];
  locale: string;
  labels: FatwaListLabels;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) {
      const c = it.category.trim();
      if (c && !seen.has(c)) seen.set(c, c);
    }
    return [...seen.keys()].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return items.filter((it) => {
      if (category !== null && it.category.trim() !== category) return false;
      if (!q) return true;
      return (
        normalize(it.title).includes(q) ||
        normalize(it.subtitle).includes(q) ||
        normalize(it.category).includes(q)
      );
    });
  }, [items, query, category]);

  const countLabel = labels.resultsCount.split('{count}').join(String(filtered.length));
  const trimmedQuery = query.trim();

  return (
    <div className="ftw-list">
      <div className="ftw-list-search" role="search">
        <label htmlFor="ftw-list-q">{labels.searchLabel}</label>
        <input
          id="ftw-list-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.searchPlaceholder}
        />
      </div>

      {categories.length > 0 ? (
        <div className="ftw-cats" role="group" aria-label={labels.categoryAll}>
          <button
            type="button"
            className={category === null ? 'ftw-chip on' : 'ftw-chip'}
            onClick={() => setCategory(null)}
            aria-pressed={category === null}
          >
            {labels.categoryAll}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? 'ftw-chip on' : 'ftw-chip'}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}

      <p className="ftw-muted" role="status">
        {countLabel}
      </p>

      {trimmedQuery ? (
        <p>
          <a
            className="btn-secondary"
            href={`/${locale}/fatwa?q=${encodeURIComponent(trimmedQuery)}`}
          >
            {labels.askAssistantAbout.split('{q}').join(trimmedQuery)}
          </a>
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty-state" role="status">
          <h2>{labels.emptyTitle}</h2>
          <p>{labels.emptyHint}</p>
        </div>
      ) : (
        <ul className="ftw-list-items">
          {filtered.map((it) => (
            <li key={it.id}>
              {it.href ? (
                <a href={it.href}>
                  <strong>{it.title}</strong>
                  {it.subtitle ? <span>{it.subtitle}</span> : null}
                  {it.category ? <small>{it.category}</small> : null}
                  {it.badge ? <em>{it.badge}</em> : null}
                </a>
              ) : (
                <article>
                  <strong>{it.title}</strong>
                  {it.subtitle ? <span>{it.subtitle}</span> : null}
                  {it.category ? <small>{it.category}</small> : null}
                  {it.badge ? <em>{it.badge}</em> : null}
                </article>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
