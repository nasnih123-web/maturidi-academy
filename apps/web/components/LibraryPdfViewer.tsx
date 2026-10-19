'use client';

/**
 * LibraryPdfViewer — rich PDF experience without bundling pdf.js.
 *
 * - First-page preview image (preview_url → cover_url → styled placeholder).
 * - Page navigation over the transcript paginated client-side
 *   (paginateTranscript in lib/library.ts) — honest local pagination.
 * - In-page text search over the transcript with match jumping.
 * - TOC from chapters (start_page) jumping to the matching transcript page.
 * - Download button resolving the signed stream URL.
 *
 * Pure presentation: item facts arrive as props; stream resolution via
 * lib/library-client.ts.
 */
import { useMemo, useState } from 'react';
import { paginateTranscript } from '@/lib/library';
import { resolveStreamUrl, LibraryClientError } from '@/lib/library-client';

export interface PdfViewerChapter {
  title: string;
  startPage: number | null;
}

export interface LibraryPdfViewerLabels {
  previewAlt: string;
  previewMissing: string;
  download: string;
  downloadPreparing: string;
  downloadFailed: string;
  tocTitle: string;
  pageLabel: string;
  prevPage: string;
  nextPage: string;
  searchPlaceholder: string;
  searchAria: string;
  noMatches: string;
  matchJump: string;
  noTranscript: string;
}

interface Props {
  itemId: string;
  title: string;
  previewUrl: string | null;
  transcript: string | null;
  chapters: PdfViewerChapter[];
  locale: string;
  labels: LibraryPdfViewerLabels;
}

export function LibraryPdfViewer({ itemId, title, previewUrl, transcript, chapters, locale, labels }: Props) {
  const pages = useMemo(() => paginateTranscript(transcript), [transcript]);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [dlState, setDlState] = useState<'idle' | 'busy' | 'error'>('idle');

  const pageCount = pages.length;
  const nf = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);
  const pageLabel = labels.pageLabel
    .replace('{n}', nf.format(page + 1))
    .replace('{total}', nf.format(pageCount));

  const matches = useMemo(() => {
    const needle = q.trim();
    if (!needle || pageCount === 0) return [] as number[];
    const out: number[] = [];
    pages.forEach((paras, pi) => {
      if (paras.some((p) => p.includes(needle))) out.push(pi);
    });
    return out;
  }, [q, pages, pageCount]);

  const goToMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    setPage(matches[next]);
  };

  const download = async () => {
    setDlState('busy');
    try {
      const url = await resolveStreamUrl(itemId);
      window.open(url, '_blank', 'noopener');
      setDlState('idle');
    } catch (err) {
      if (err instanceof LibraryClientError) setDlState('error');
      else setDlState('error');
    }
  };

  const jumpToChapter = (startPage: number | null) => {
    if (startPage == null || pageCount === 0) return;
    setPage(Math.min(Math.max(0, startPage - 1), pageCount - 1));
  };

  return (
    <div className="lib-pdf">
      <div className="lib-pdf-preview">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={labels.previewAlt} className="lib-pdf-preview-img" />
        ) : (
          <div className="lib-pdf-placeholder" role="img" aria-label={labels.previewMissing}>
            <span className="lib-pdf-placeholder-glyph" aria-hidden="true">
              ▤
            </span>
            <p>{title}</p>
            <p className="lib-pdf-placeholder-note">{labels.previewMissing}</p>
          </div>
        )}
      </div>

      <div className="lib-pdf-tools">
        <input
          type="search"
          className="lib-search lib-search-sm"
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchAria}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMatchIdx(0);
          }}
        />
        {q.trim() && matches.length > 0 && (
          <div className="lib-pdf-matchnav">
            <button type="button" className="lib-btn-sm" onClick={() => goToMatch(-1)} aria-label={labels.matchJump}>
              ‹
            </button>
            <span role="status">
              {nf.format(matchIdx + 1)} / {nf.format(matches.length)}
            </span>
            <button type="button" className="lib-btn-sm" onClick={() => goToMatch(1)} aria-label={labels.matchJump}>
              ›
            </button>
          </div>
        )}
        {q.trim() && matches.length === 0 && (
          <p className="lib-pdf-nomatch" role="status">
            {labels.noMatches}
          </p>
        )}
        <button type="button" className="lib-btn" onClick={() => void download()} disabled={dlState === 'busy'}>
          {dlState === 'busy' ? labels.downloadPreparing : labels.download}
        </button>
        {dlState === 'error' && (
          <p className="lib-error-text" role="alert">
            {labels.downloadFailed}
          </p>
        )}
      </div>

      <div className="lib-pdf-cols">
        {chapters.length > 0 && (
          <nav className="lib-pdf-toc" aria-label={labels.tocTitle}>
            <h3>{labels.tocTitle}</h3>
            <ol>
              {chapters.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="lib-pdf-toc-item"
                    onClick={() => jumpToChapter(c.startPage)}
                    disabled={c.startPage == null || pageCount === 0}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="lib-pdf-pages">
          {pageCount === 0 ? (
            <p className="lib-transcript-empty">{labels.noTranscript}</p>
          ) : (
            <>
              <div className="lib-pdf-page" aria-live="polite">
                {pages[page].map((para, i) => (
                  <p key={i}>{renderWithHighlights(para, q.trim())}</p>
                ))}
              </div>
              <div className="lib-pdf-pagenav">
                <button
                  type="button"
                  className="lib-btn-sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  aria-label={labels.prevPage}
                >
                  ‹
                </button>
                <span role="status">{pageLabel}</span>
                <button
                  type="button"
                  className="lib-btn-sm"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  aria-label={labels.nextPage}
                >
                  ›
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
