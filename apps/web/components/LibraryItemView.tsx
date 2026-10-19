'use client';

/**
 * LibraryItemView — assembles the per-kind viewer + transcript for a
 * library item detail.
 *
 * Receives the raw item + locale; localizes via pickText (pure service
 * fn, same as CourseView). The 360° viewer is code-split (React.lazy);
 * other viewers are small enough to ship with the detail-page chunk.
 */
import { lazy, Suspense } from 'react';
import { pickText } from '@/lib/localize';
import {
  scholarDisplay,
  type LibraryItemDetail,
  type MindmapNode,
} from '@/lib/library';
import { LibraryTranscript, type LibraryTranscriptLabels } from './LibraryTranscript';
import { LibraryAudioViewer, type LibraryAudioViewerLabels } from './LibraryAudioViewer';
import { LibraryVideoViewer, type LibraryVideoViewerLabels } from './LibraryVideoViewer';
import { LibraryPdfViewer, type LibraryPdfViewerLabels } from './LibraryPdfViewer';
import { LibraryMindmap, type LibraryMindmapLabels } from './LibraryMindmap';
import type { LibraryPanoViewerLabels } from './LibraryPanoViewer';

// React.lazy + Suspense (not next/dynamic): next/dynamic ssr:false inside a
// client component breaks the app-router client runtime when the chunk
// loads. Lazy keeps the 360° viewer out of every initial bundle, homepage
// included.
const LibraryPanoViewer = lazy(() =>
  import('./LibraryPanoViewer').then((m) => ({ default: m.LibraryPanoViewer })),
);

export interface LibraryItemViewLabels {
  untitled: string;
  audio: LibraryAudioViewerLabels;
  video: LibraryVideoViewerLabels;
  pdf: LibraryPdfViewerLabels;
  pano: LibraryPanoViewerLabels;
  mindmap: LibraryMindmapLabels;
  transcript: LibraryTranscriptLabels;
  panoLoading: string;
}

function chapterTitle(t: { fa?: string | null; ar?: string | null; en?: string | null } | string | null, locale: string, fallback: string): string {
  if (typeof t === 'string') return t;
  return pickText(t, locale) || fallback;
}

export function LibraryItemView({
  item,
  locale,
  labels,
}: {
  item: LibraryItemDetail;
  locale: string;
  labels: LibraryItemViewLabels;
}) {
  const title = pickText(item.title, locale) || labels.untitled;
  const scholarName = scholarDisplay(item.scholar ?? item.scholar_name, (t) => pickText(t, locale));

  const chapters = (item.chapters ?? []).map((c, i) => ({
    title: chapterTitle(c.title, locale, `${i + 1}`),
    startSeconds: c.start_seconds ?? null,
    startPage: c.start_page ?? null,
  }));

  let viewer: React.ReactNode = null;
  switch (item.kind) {
    case 'audio':
      viewer = (
        <LibraryAudioViewer
          itemId={item.id}
          title={title}
          scholarName={scholarName}
          coverUrl={item.cover_url ?? null}
          locale={locale}
          labels={labels.audio}
        />
      );
      break;
    case 'video':
      viewer = (
        <LibraryVideoViewer
          itemId={item.id}
          title={title}
          posterUrl={item.cover_url ?? null}
          chapters={chapters}
          captionsUrl={item.captions_url ?? null}
          locale={locale}
          labels={labels.video}
        />
      );
      break;
    case 'video_360':
      viewer = (
        <Suspense fallback={<p className="lib-status">…</p>}>
          <LibraryPanoViewer
            itemId={item.id}
            title={title}
            projection={item.projection ?? null}
            labels={labels.pano}
          />
        </Suspense>
      );
      break;
    case 'pdf':
      viewer = (
        <LibraryPdfViewer
          itemId={item.id}
          title={title}
          previewUrl={item.preview_url ?? item.cover_url ?? null}
          transcript={item.transcript ?? null}
          chapters={chapters}
          locale={locale}
          labels={labels.pdf}
        />
      );
      break;
    case 'mindmap': {
      const root: MindmapNode | null = item.mindmap
        ? item.mindmap
        : chapters.length > 0
          ? { label: title, children: chapters.map((c) => ({ label: c.title })) }
          : null;
      viewer = <LibraryMindmap root={root} labels={labels.mindmap} />;
      break;
    }
    default:
      viewer = null;
  }

  return (
    <div className="lib-itemview">
      {viewer}
      {item.kind !== 'pdf' && (
        <LibraryTranscript transcript={item.transcript ?? null} locale={locale} labels={labels.transcript} />
      )}
    </div>
  );
}
