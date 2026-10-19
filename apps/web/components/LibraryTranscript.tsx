'use client';

/**
 * LibraryTranscript — collapsible transcript panel with in-text search.
 *
 * Server-rendered (collapsed) for SEO; hydration adds interactivity.
 * Pure presentation: receives the transcript text + labels, renders.
 */
import { useMemo, useState } from 'react';

export interface LibraryTranscriptLabels {
  title: string;
  expandAria: string;
  collapseAria: string;
  searchPlaceholder: string;
  searchAria: string;
  matchLabel: string;
  noTranscript: string;
  noMatches: string;
}

export function LibraryTranscript({
  transcript,
  locale,
  labels,
}: {
  transcript: string | null | undefined;
  locale: string;
  labels: LibraryTranscriptLabels;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const nf = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);

  const paragraphs = useMemo(
    () =>
      (transcript ?? '')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean),
    [transcript],
  );

  const matches = useMemo(() => {
    const needle = q.trim();
    if (!needle || paragraphs.length === 0) return [];
    const out: number[] = [];
    paragraphs.forEach((p, i) => {
      if (p.includes(needle)) out.push(i);
    });
    return out;
  }, [q, paragraphs]);

  if (paragraphs.length === 0) {
    return <p className="lib-transcript-empty">{labels.noTranscript}</p>;
  }

  return (
    <section className="lib-transcript" aria-label={labels.title}>
      <button
        type="button"
        className="lib-transcript-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? labels.collapseAria : labels.expandAria}
      >
        <span>{labels.title}</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="lib-transcript-body">
          <input
            type="search"
            className="lib-search lib-search-sm"
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchAria}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q.trim() && (
            <p className="lib-transcript-count" role="status">
              {matches.length === 0
                ? labels.noMatches
                : labels.matchLabel.replace('{n}', nf.format(matches.length))}
            </p>
          )}
          <div className="lib-transcript-text">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className={matches.includes(i) ? 'lib-transcript-hit' : undefined}
                data-para={i}
              >
                {renderWithHighlights(p, q.trim())}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function renderWithHighlights(text: string, needle: string): React.ReactNode {
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  let rest = text;
  let k = 0;
  for (;;) {
    const idx = rest.indexOf(needle);
    if (idx === -1) {
      parts.push(rest);
      break;
    }
    if (idx > 0) parts.push(rest.slice(0, idx));
    parts.push(
      <mark key={k++} className="lib-mark">
        {needle}
      </mark>,
    );
    rest = rest.slice(idx + needle.length);
  }
  return <>{parts}</>;
}
