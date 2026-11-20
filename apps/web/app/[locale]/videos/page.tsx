import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getVideoPlaylists, getVideos, type VideoItem } from '@/lib/videos';
import { formatDuration } from '@/lib/library';
import { pickText } from '@/lib/localize';
import {
  VideosBrowser,
  type PlaylistShelf,
  type VideosBrowserItem,
} from '@/components/VideosBrowser';
import type { VideoCardItem } from '@/components/VideoCard';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'videos' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Videos section index — YouTube-style: «همهٔ ویدیوها» grid first,
 * playlist shelves after (approved design). Data comes from
 * GET /api/v1/videos + /api/v1/videos/playlists; on API failure the
 * page renders the honest empty state, never invented content.
 */
export default async function VideosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'videos' });
  const tLib = await getTranslations({ locale, namespace: 'library' });

  const [videosRes, playlistsRes] = await Promise.all([
    getVideos({ limit: 100 }).then(
      (res) => ({ ok: true as const, res }),
      () => ({ ok: false as const, res: null }),
    ),
    getVideoPlaylists().then(
      (res) => ({ ok: true as const, res }),
      () => ({ ok: false as const, res: null }),
    ),
  ]);

  const toCard = (item: VideoItem, playlistId?: string): VideoCardItem => ({
    id: item.id,
    title: pickText(item.title, locale) || t('untitled'),
    scholarName: item.scholar_name ?? '',
    coverUrl: item.cover_url,
    durationLabel: formatDuration(item.duration_seconds, locale),
    kindLabel: tLib(`kinds.${item.kind}`),
    playlistLabel: item.playlists.length > 0 ? t('playlistTag') : null,
    href: `/${locale}/videos/${encodeURIComponent(item.id)}${
      playlistId ? `?playlist=${encodeURIComponent(playlistId)}` : ''
    }`,
  });

  const videos: VideosBrowserItem[] = videosRes.ok
    ? videosRes.res.items.map((item) => ({
        ...toCard(item),
        createdAt: item.created_at,
      }))
    : [];

  const shelves: PlaylistShelf[] = playlistsRes.ok
    ? playlistsRes.res.map((pl) => ({
        id: pl.id,
        title: pickText(pl.title, locale) || t('untitled'),
        scholarName: pl.scholar_name ?? '',
        coverUrl: pl.cover_url,
        countLabel: t('videoCount', { count: pl.item_count }),
        totalLabel: t('totalDuration', {
          duration: formatDuration(pl.total_duration_seconds, locale),
        }),
        items: pl.items.slice(0, 3).map((item) => toCard(item, pl.id)),
      }))
    : [];

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-subtitle">{t('subtitle')}</p>
      <VideosBrowser
        videos={videos}
        playlists={shelves}
        labels={{
          chips: {
            all: t('chips.all'),
            newest: t('chips.newest'),
            playlists: t('chips.playlists'),
          },
          allVideos: t('allVideos'),
          newestFirst: t('newestFirst'),
          playlistPrefix: t('playlistPrefix'),
          viewPlaylist: t('viewPlaylist'),
          noVideos: t('noVideos'),
          noVideosHint: t('noVideosHint'),
        }}
      />
    </div>
  );
}
