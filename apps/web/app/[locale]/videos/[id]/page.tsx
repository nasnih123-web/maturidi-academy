import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, lazy } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  formatVideoDate,
  getVideoPlaylists,
  getVideoWatch,
  type VideoItem,
} from '@/lib/videos';
import { getSiteConfig } from '@/lib/settings';
import { ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/library';
import { pickText } from '@/lib/localize';
import { ProVideoPlayer } from '@/components/ProVideoPlayer';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import {
  VideoWatchBelow,
  type WatchPlaylistTab,
} from '@/components/VideoWatchBelow';
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
 * Watch page — professional player for kind=video (ProVideoPlayer:
 * custom controls, resume, autoplay-next; it reports
 * media_play/media_progress activity with the same semantics as the
 * library viewer) and the pano viewer for video_360. Title/scholar/
 * description below, and a sidebar with the current playlist + related
 * videos. Sidebar side is the CRM setting `videos.sidebar_side`
 * (default left, as designed); related renders only when
 * `videos.related_enabled` is on. Player behaviour switches come from
 * the same public settings (`videos.player_*` / `autoplay_next` /
 * `resume_playback`).
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

  const [watchRes, siteConfig, playlistsRes] = await Promise.all([
    getVideoWatch(id, playlistParam ?? null).then(
      (res) => ({ ok: true as const, res, notFound: false }),
      (err: unknown) => ({
        ok: false as const,
        res: null,
        notFound: err instanceof ApiError && err.status === 404,
      }),
    ),
    getSiteConfig(),
    getVideoPlaylists().then(
      (res) => ({ ok: true as const, res }),
      () => ({ ok: false as const, res: null }),
    ),
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

  const playlistsTab: WatchPlaylistTab[] = playlistsRes.ok
    ? playlistsRes.res.map((pl) => ({
        id: pl.id,
        title: pickText(pl.title, locale) || t('untitled'),
        countLabel: t('videoCount', { count: pl.item_count }),
        coverUrl: pl.cover_url ?? pl.items[0]?.cover_url ?? null,
        href: pl.items[0]
          ? `/${locale}/videos/${encodeURIComponent(pl.items[0].id)}?playlist=${encodeURIComponent(pl.id)}`
          : `/${locale}/videos`,
        current: ctx?.playlist.id === pl.id,
      }))
    : [];

  const nextItem = ctx?.next_item_id
    ? ctx.items.find((r) => r.id === ctx.next_item_id) ?? null
    : null;
  const nextUrl =
    ctx && ctx.next_item_id
      ? `/${locale}/videos/${encodeURIComponent(ctx.next_item_id)}?playlist=${encodeURIComponent(ctx.playlist.id)}`
      : null;
  const nextTitle = nextItem
    ? pickText(nextItem.title, locale) || t('untitled')
    : null;

  const playerLabels = {
    play: t('player.play'),
    pause: t('player.pause'),
    mute: t('player.mute'),
    unmute: t('player.unmute'),
    volume: t('player.volume'),
    seek: t('player.seek'),
    settings: t('player.settings'),
    speed: t('player.speed'),
    autoplayNext: t('player.autoplayNext'),
    pip: t('player.pip'),
    fullscreen: t('player.fullscreen'),
    exitFullscreen: t('player.exitFullscreen'),
    loading: t('player.loading'),
    failed: t('player.failed'),
    retry: t('player.retry'),
    resumeFrom: t('player.resumeFrom'),
    nextUp: t('player.nextUp'),
    startsIn: t('player.startsIn'),
    playNow: t('player.playNow'),
    cancel: t('player.cancel'),
    rewind: t('player.rewind'),
    forward: t('player.forward'),
    subtitles: t('player.subtitles'),
    subtitlesOff: t('player.subtitlesOff'),
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
          {item.embed_url ? (
            <YouTubeEmbed itemId={item.id} title={title} embedUrl={item.embed_url} />
          ) : item.kind === 'video_360' ? (
            <Suspense fallback={<p className="lib-status">…</p>}>
              <LibraryPanoViewer
                itemId={item.id}
                title={title}
                projection={null}
                labels={panoLabels}
              />
            </Suspense>
          ) : (
            <ProVideoPlayer
              itemId={item.id}
              title={title}
              streamUrl={watch.stream_url}
              posterUrl={item.cover_url}
              locale={locale}
              settings={{
                playerSpeed: settings.playerSpeed,
                playerPip: settings.playerPip,
                autoplayNext: settings.autoplayNext,
                resumePlayback: settings.resumePlayback,
              }}
              nextUrl={nextUrl}
              nextTitle={nextTitle}
              labels={playerLabels}
              subtitles={watch.subtitles}
              subtitleDefaultLang={settings.subtitleDefaultLang}
            />
          )}
          <VideoWatchBelow
            itemId={item.id}
            locale={locale}
            title={title}
            scholarName={item.scholar_name}
            dateLabel={formatVideoDate(item.published_at, locale)}
            durationLabel={formatDuration(item.duration_seconds, locale)}
            durationSeconds={item.duration_seconds}
            subtitleLangs={watch.subtitles.map((s) => s.lang)}
            description={description}
            tags={item.topic_tags}
            isExternal={Boolean(item.embed_url)}
            externalUrl={item.external_url}
            streamUrl={watch.stream_url}
            resumeEnabled={
              settings.resumePlayback && item.kind === 'video' && !item.embed_url
            }
            playlistTitle={
              ctx ? pickText(ctx.playlist.title, locale) || t('untitled') : null
            }
            positionLabel={
              ctx
                ? t('watch.videoOf', { position: ctx.position, total: ctx.total })
                : null
            }
            playlistItems={playlistItems}
            playlists={playlistsTab}
            related={related}
            labels={{
              publishedLabel: t('watch.publishedLabel'),
              durationLabel: t('watch.durationLabel'),
              subtitlesLabel: t('watch.subtitlesLabel'),
              download: t('watch.download'),
              watchOnYouTube: item.external_url?.includes('aparat.com')
                ? t('watch.watchOnAparat')
                : item.external_url?.includes('youtube')
                  ? t('watch.watchOnYouTube')
                  : t('watch.watchExternal'),
              share: t('watch.share'),
              linkCopied: t('watch.linkCopied'),
              save: t('watch.save'),
              saved: t('watch.saved'),
              tagsLabel: t('watch.tagsLabel'),
              episodesTab: t('watch.episodesTab'),
              playlistsTab: t('watch.playlistsTab'),
              currentPlaylist: t('watch.currentPlaylist'),
              similarTab: t('watch.relatedTitle'),
              nowPlaying: t('watch.nowPlaying'),
              resumeTitle: t('watch.resumeTitle'),
              resumePercentTemplate: t('watch.resumePercent', {
                percent: '__PCT__',
              }),
              resumeFromTemplate: t('player.resumeFrom', { time: '__TIME__' }),
              more: t('watch.more'),
              less: t('watch.less'),
            }}
          />
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
