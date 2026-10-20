import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAllPlaces } from '@/lib/places';
import { PLACE_TYPES, toPlaceView, type PlaceView } from '@/lib/places-view';
import { EmptyState } from '@/components/EmptyState';
import type { PlacesMapLabels } from '@/components/PlacesMap';
import { PlacesMap } from '@/components/PlacesMapLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'places' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Religious places map (Phase 11).
 *
 * Thin RSC shell: server-fetches all published places (GET /api/v1/places),
 * resolves LocalizedText to plain strings, then mounts the code-split Leaflet
 * map. Leaflet (~150KB) never enters the homepage bundle. API failure or an
 * empty catalogue renders an honest state instead of a fake map.
 */
export default async function PlacesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'places' });

  let views: PlaceView[] = [];
  let failed = false;
  try {
    const places = await getAllPlaces();
    views = places.map((p) => toPlaceView(p, locale));
  } catch {
    failed = true;
  }

  const typeLabels = Object.fromEntries(PLACE_TYPES.map((k) => [k, t(`types.${k}`)])) as Record<
    string,
    string
  >;

  const labels: PlacesMapLabels = {
    mapAria: t('mapAria'),
    filterLabel: t('filterLabel'),
    all: t('types.all'),
    openDetail: t('openDetail'),
    loading: t('loading'),
    loadFailed: t('loadFailed'),
    retry: t('retry'),
    // t.raw: the component substitutes {n} itself; t() without values would
    // raise FORMATTING_ERROR and render the key.
    resultsCount: t.raw('resultsCount'),
  };

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-subtitle">{t('subtitle')}</p>
      {failed ? (
        <EmptyState title={t('loadFailed')} hint={t('loadFailedHint')} />
      ) : views.length === 0 ? (
        <EmptyState title={t('noPlaces')} hint={t('noPlacesHint')} />
      ) : (
        <PlacesMap locale={locale} places={views} typeLabels={typeLabels} labels={labels} />
      )}
    </div>
  );
}
