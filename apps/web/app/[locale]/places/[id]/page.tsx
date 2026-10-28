import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPlace } from '@/lib/places';
import { coverImage, toPlaceView, typeEmoji, typeLabel } from '@/lib/places-view';
import { getSiteConfig } from '@/lib/settings';
import { videoEmbedUrl } from '@/lib/video-embed';
import { ApiError } from '@/lib/api';
import { pickText } from '@/lib/localize';
import { EmptyState } from '@/components/EmptyState';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'places' });
  try {
    const place = await getPlace(id);
    const name = pickText(place.name, locale) || id;
    return { title: t('detailMetaTitle', { name }), description: t('metaDescription') };
  } catch {
    return { title: t('metaTitle'), description: t('metaDescription') };
  }
}

/**
 * Place detail (Phase 11).
 *
 * Server-rendered from GET /api/v1/places/{id}: name, type, description,
 * coordinates and — when the place carries a Phase-9 library reference —
 * a «360° virtual tour» link into the library's pano player route
 * (/[locale]/library/[video_360_id]). 404 → notFound(); other API failures
 * render an honest error state.
 */
export default async function PlaceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'places' });

  let place: Awaited<ReturnType<typeof getPlace>> | null = null;
  let failed = false;
  try {
    place = await getPlace(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    failed = true;
  }

  if (failed || !place) {
    return (
      <div className="page-wrap">
        <Link className="place-back" href={`/${locale}/places`}>
          {t('backToMap')}
        </Link>
        <EmptyState title={t('loadFailed')} hint={t('loadFailedHint')} />
      </div>
    );
  }

  const view = toPlaceView(place, locale);
  // Type labels/emoji come from the CRM `places.types` setting; anything
  // the API invents later falls back to the raw key (never a next-intl
  // missing-key throw).
  const siteConfig = await getSiteConfig();
  const label = typeLabel(siteConfig.placeTypes, view.type, locale);
  const emoji = typeEmoji(siteConfig.placeTypes, view.type);
  const cover = coverImage(view);
  const embed = view.videoUrl ? videoEmbedUrl(view.videoUrl) : null;

  return (
    <div className="page-wrap place-detail">
      <Link className="place-back" href={`/${locale}/places`}>
        {t('backToMap')}
      </Link>
      <h1 className="page-title">{view.name}</h1>
      <p className="page-subtitle">
        <span className="place-type-badge">
          {emoji} {label}
        </span>
      </p>

      {view.images.length > 0 ? (
        <div className="place-gallery">
          {view.images.map((im) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={im.url} className="place-detail-img" src={im.url} alt={im.caption || view.name} loading="lazy" />
          ))}
        </div>
      ) : cover ? (
        // cover passed safeImageUrl (http(s) only) in the view layer.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="place-detail-img" src={cover} alt={view.name} loading="lazy" />
      ) : null}

      {view.description ? <p className="place-desc">{view.description}</p> : null}

      <dl className="place-meta">
        {view.city ? (
          <div>
            <dt>{t('cityLabel')}</dt>
            <dd>{view.city}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('coordinatesLabel')}</dt>
          <dd dir="ltr">
            {view.lat.toFixed(4)}، {view.lng.toFixed(4)}
          </dd>
        </div>
      </dl>

      {view.video360Id ? (
        <div className="place-tour">
          <Link className="place-tour-link" href={`/${locale}/library/${view.video360Id}`}>
            {t('view360')}
          </Link>
          <p className="place-tour-hint">{t('view360Hint')}</p>
        </div>
      ) : null}

      {view.videoUrl ? (
        embed ? (
          <div className="place-tour">
            <iframe
              title={view.name}
              src={embed}
              loading="lazy"
              allowFullScreen
              style={{ width: '100%', height: '360px', border: 0, borderRadius: '0.6rem' }}
            />
          </div>
        ) : (
          <div className="place-tour">
            <a className="place-tour-link" href={view.videoUrl} target="_blank" rel="noreferrer">
              {t('videoLinkFallback')}
            </a>
          </div>
        )
      ) : null}
    </div>
  );
}
