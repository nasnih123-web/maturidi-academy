import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getLibraryItem, formatDuration, scholarDisplay } from '@/lib/library';
import { ApiError } from '@/lib/api';
import { pickText } from '@/lib/localize';
import { LibraryItemView, type LibraryItemViewLabels } from '@/components/LibraryItemView';
import { LibraryAccessGate, type LibraryAccessGateLabels } from '@/components/LibraryAccessGate';
import { LibraryCard } from '@/components/LibraryCard';

export async function generateMetadata({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'library' });
  try {
    const item = await getLibraryItem(id);
    const title = pickText(item.title, locale) || t('untitled');
    return {
      title: t('itemMetaTitle', { title }),
      description: pickText(item.description, locale) || t('metaDescription'),
    };
  } catch {
    return { title: t('metaTitle'), description: t('metaDescription') };
  }
}

function viewLabels(
  t: Awaited<ReturnType<typeof getTranslations>>,
): LibraryItemViewLabels {
  return {
    untitled: t('untitled'),
    audio: {
      play: t('player.play'),
      pause: t('player.pause'),
      seekBack: t('player.seekBack'),
      seekForward: t('player.seekForward'),
      speed: t('player.speed'),
      loadingAudio: t('player.loadingAudio'),
      audioFailed: t('player.audioFailed'),
      retry: t('retry'),
      coverAlt: t('player.coverAlt'),
    },
    video: {
      loadingVideo: t('player.loadingVideo'),
      videoFailed: t('player.videoFailed'),
      retry: t('retry'),
      chaptersTitle: t('chaptersTitle'),
      captionsNote: t('captionsNote'),
      seekToChapter: t('seekToChapter'),
    },
    pdf: {
      previewAlt: t('pdf.previewAlt'),
      previewMissing: t('pdf.previewMissing'),
      download: t('pdf.download'),
      downloadPreparing: t('pdf.downloadPreparing'),
      downloadFailed: t('pdf.downloadFailed'),
      tocTitle: t('chaptersTitle'),
      // t.raw: the component substitutes {n}/{total} itself; resolving via
      // t() without values would raise FORMATTING_ERROR and render the key.
      pageLabel: t.raw('pdf.pageLabel'),
      prevPage: t('pdf.prevPage'),
      nextPage: t('pdf.nextPage'),
      searchPlaceholder: t('pdf.searchPlaceholder'),
      searchAria: t('pdf.searchAria'),
      noMatches: t('pdf.noMatches'),
      matchJump: t('pdf.matchJump'),
      noTranscript: t('transcript.noTranscript'),
    },
    pano: {
      loading: t('pano.loading'),
      failed: t('pano.failed'),
      retry: t('retry'),
      dragHint: t('pano.dragHint'),
      projectionLabel: t('pano.projectionLabel'),
      deviceNote: t('pano.deviceNote'),
      play: t('player.play'),
      pause: t('player.pause'),
      videoNote: t('pano.videoNote'),
    },
    mindmap: {
      empty: t('mindmap.empty'),
      emptyHint: t('mindmap.emptyHint'),
      expandAria: t('mindmap.expandAria'),
      collapseAria: t('mindmap.collapseAria'),
    },
    transcript: {
      title: t('transcript.title'),
      expandAria: t('transcript.expandAria'),
      collapseAria: t('transcript.collapseAria'),
      searchPlaceholder: t('transcript.searchPlaceholder'),
      searchAria: t('transcript.searchAria'),
      // t.raw: {n} is substituted by the component (see pageLabel above).
      matchLabel: t.raw('transcript.matchLabel'),
      noTranscript: t('transcript.noTranscript'),
      noMatches: t('transcript.noMatches'),
    },
    panoLoading: t('pano.loading'),
  };
}

/**
 * Library item detail (Phase 9).
 *
 * Server-rendered from GET /api/v1/library/items/{id}: header metadata,
 * per-kind viewer, transcript and related rail — SEO-friendly. A 404 means
 * "not found OR scholars_only for anonymous callers": the access gate
 * retries with the user's token when logged in, else shows login-required.
 */
export default async function LibraryItemPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'library' });
  const vl = viewLabels(t);

  let item: Awaited<ReturnType<typeof getLibraryItem>> | null = null;
  let notFound = false;
  let failed = false;
  try {
    item = await getLibraryItem(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound = true;
    else failed = true;
  }

  if (notFound || failed) {
    const gateLabels: LibraryAccessGateLabels = {
      checking: t('gate.checking'),
      loginRequiredTitle: t('gate.loginRequiredTitle'),
      loginRequiredBody: t('gate.loginRequiredBody'),
      loginCta: t('gate.loginCta'),
      notFoundTitle: failed ? t('loadFailed') : t('gate.notFoundTitle'),
      notFoundBody: failed ? t('loadFailedHint') : t('gate.notFoundBody'),
      backToLibrary: t('gate.backToLibrary'),
    };
    return (
      <div className="page-wrap">
        <LibraryAccessGate itemId={id} locale={locale} viewLabels={vl} labels={gateLabels} />
      </div>
    );
  }

  // item is non-null here (both failure branches returned above).
  const it = item!;
  const title = pickText(it.title, locale) || t('untitled');
  const description = pickText(it.description, locale);
  const scholarName = scholarDisplay(it.scholar ?? it.scholar_name, (x) => pickText(x, locale));
  const durationLabel = formatDuration(it.duration_seconds, locale);
  const related = (it.related_items ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: pickText(r.title, locale) || t('untitled'),
    scholarName: scholarDisplay(r.scholar_name, (x) => pickText(x, locale)),
    coverUrl: r.cover_url ?? null,
    durationLabel: formatDuration(r.duration_seconds, locale),
    href: `/${locale}/library/${encodeURIComponent(r.id)}`,
  }));

  return (
    <div className="page-wrap">
      <nav className="lib-breadcrumb" aria-label={t('breadcrumbAria')}>
        <Link href={`/${locale}/library`}>{t('title')}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{title}</span>
      </nav>

      <header className="lib-detail-head">
        <div className="lib-detail-kicker">
          <span className="lib-card-kind">{t(`kinds.${it.kind}`)}</span>
          {durationLabel ? (
            <span className="lib-detail-duration" dir="ltr">
              {durationLabel}
            </span>
          ) : null}
        </div>
        <h1 className="page-title">{title}</h1>
        {scholarName ? <p className="lib-detail-scholar">{scholarName}</p> : null}
        {description ? <p className="lib-detail-desc">{description}</p> : null}
      </header>

      <LibraryItemView item={it} locale={locale} labels={vl} />

      {related.length > 0 && (
        <section className="lib-related" aria-label={t('relatedTitle')}>
          <h2 className="lib-related-title">{t('relatedTitle')}</h2>
          <ol className="lib-related-rail">
            {related.map((r) => (
              <li key={r.id}>
                <LibraryCard
                  item={r}
                  labels={{ openItem: t('openItem'), kindLabel: t(`kinds.${r.kind}`) }}
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
