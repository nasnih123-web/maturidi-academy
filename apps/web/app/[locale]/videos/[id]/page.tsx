import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, lazy } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getVideoWatch, type VideoItem } from '@/lib/videos';
import { getSiteConfig } from '@/lib/settings';
import { ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/library';
import { pickText } from '@/lib/localize';
import { LibraryVideoViewer } from '@/components/LibraryVideoViewer';
import {
  VideoWatchSidebar,
  type SidebarVideoRow,
} from '@/components/VideoWatchSidebar';

// Same lazy pattern as LibraryItemView: the 360° viewer stays out of
// every initial bundle.
const LibraryPanoViewer = lazy(() =>
  import('@/components/LibraryPanoViewer').then((m) => ({
    default: m.LibraryPanoViewer,
  })),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'videos' });
  try {
    const watch = await getVideoWatch(id);
    const title = pickText(watch.item.title, locale) || t('untitled');
    return {
      title: t('itemMetaTitle', { title }),
      description: pickText(watch.item.description, locale) || t('metaDescription'),
    };
  } catch {
    return { title: t('metaTitle'), description: t('metaDescription') };
  }
}

/**
 * Watch page — player (existing LibraryVideoViewer / pano viewer; the
 * viewer itself reports media_play/media_progress activity, exactly as
 * on the library detail page), title/scholar/description below, and a
 * sidebar with the current playlist + related videos. Sidebar side is
 * the CRM setting `videos.sidebar_side` (default left, as designed);
 * related renders only when `videos.related_enabled` is on.
 */
export default async function VideoWatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ playlist?: string }>;
}) {
  const { locale, id } = await params;
  const { playlist: playlistParam } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'videos' });
  const tLib = await getTranslations({ locale, namespace: 'library' });

  const [watchRes, siteConfig] = await Promise.all([
    getVideoWatch(id, playlistParam ?? null).then(
      (res) => ({ ok: true as const, res, notFound: false }),
      (err: unknown) => ({
        ok: false as const,
        res: null,
        notFound: err instanceof ApiError && err.status === 404,
      }),
    ),
    getSiteConfig(),
  ]);

  if (!watchRes.ok) {
    return (
      <div className="page-wrap">
        <div className="vid-empty">
          <p className="vid-empty-title">
            {watchRes.notFound ? t('notFoundTitle') : t('loadFailed')}
          </p>
          <p>{watchRes.notFound ? t('notFoundBody') : t('noVideosHint')}</p>
          <p>
            <Link className="vid-back-link" href={`/${locale}/videos`}>
              {t('backToVideos')}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const watch = watchRes.res;
  const item = watch.item;
  const title = pickText(item.title, locale) || t('untitled');
  const description = pickText(item.description, locale);
  const settings = siteConfig.videos;

  const toRow = (row: VideoItem, currentId: string, playlistId?: string): SidebarVideoRow => ({
    id: row.id,
    title: pickText(row.title, locale) || t('untitled'),
    scholarName: row.scholar_name ?? '',
    coverUrl: row.cover_url,
    durationLabel: formatDuration(row.duration_seconds, locale),
    href: `/${locale}/videos/${encodeURIComponent(row.id)}${
      playlistId ? `?playlist=${encodeURIComponent(playlistId)}` : ''
    }`,
    current: row.id === currentId,
  });

  const ctx = watch.playlist;
  const playlistItems = ctx ? ctx.items.map((r) => toRow(r, item.id, ctx.playlist.id)) : [];
  const related = settings.relatedEnabled
    ? watch.related.map((r) => toRow(r, item.id))
    : [];

  const videoLabels = {
    loadingVideo: tLib('player.loadingVideo'),
    videoFailed: tLib('player.videoFailed'),
    retry: tLib('retry'),
    chaptersTitle: tLib('chaptersTitle'),
    captionsNote: tLib('captionsNote'),
    seekToChapter: tLib('seekToChapter'),
  };
  const panoLabels = {
    loading: tLib('pano.loading'),
    failed: tLib('pano.failed'),
    retry: tLib('retry'),
    dragHint: tLib('pano.dragHint'),
    projectionLabel: tLib('pano.projectionLabel'),
    deviceNote: tLib('pano.deviceNote'),
    play: tLib('player.play'),
    pause: tLib('player.pause'),
    videoNote: tLib('pano.videoNote'),
  };

  return (
    <div className="page-wrap">
      <div className="vid-watch-layout" data-side={settings.sidebarSide}>
        <main className="vid-watch-main">
          {item.kind === 'video_360' ? (
            <Suspense fallback={<p className="lib-status">…</p>}>
              <LibraryPanoViewer
                itemId={item.id}
                title={title}
                projection={null}
                labels={panoLabels}
              />
            </Suspense>
          ) : (
            <LibraryVideoViewer
              itemId={item.id}
              title={title}
              posterUrl={item.cover_url}
              chapters={[]}
              captionsUrl={null}
              locale={locale}
              labels={videoLabels}
            />
          )}
          <h1 className="vid-watch-title">{title}</h1>
          {item.scholar_name ? (
            <p className="vid-watch-scholar">{item.scholar_name}</p>
          ) : null}
          {description ? <p className="vid-watch-desc">{description}</p> : null}
        </main>
        <aside className="vid-watch-side">
          <VideoWatchSidebar
            playlistTitle={ctx ? pickText(ctx.playlist.title, locale) || t('untitled') : null}
            positionLabel={
              ctx
                ? t('watch.videoOf', { position: ctx.position, total: ctx.total })
                : null
            }
            playlistItems={playlistItems}
            related={related}
            labels={{
              playlistTitle: t('watch.playlistTitle'),
              relatedTitle: t('watch.relatedTitle'),
              nowPlaying: t('watch.nowPlaying'),
            }}
          />
        </aside>
      </div>
    </div>
  );
}
