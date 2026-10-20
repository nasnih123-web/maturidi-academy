import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPlace } from '@/lib/places';
import { toPlaceView } from '@/lib/places-view';
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
  // Known types resolve to localized labels; anything the API invents later
  // falls back to the raw key (never a next-intl missing-key throw).
  const typeLabel =
    (
      {
        mosque: t('types.mosque'),
        shrine: t('types.shrine'),
        holy_site: t('types.holy_site'),
        museum: t('types.museum'),
        other: t('types.other'),
      } as Record<string, string>
    )[view.type] ?? view.type;

  return (
    <div className="page-wrap place-detail">
      <Link className="place-back" href={`/${locale}/places`}>
        {t('backToMap')}
      </Link>
      <h1 className="page-title">{view.name}</h1>
      <p className="page-subtitle">
        <span className="place-type-badge">{typeLabel}</span>
      </p>

      {view.description ? <p className="place-desc">{view.description}</p> : null}

      <dl className="place-meta">
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
    </div>
  );
}
