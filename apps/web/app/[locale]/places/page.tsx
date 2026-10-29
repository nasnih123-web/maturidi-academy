import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAllPlaces } from '@/lib/places';
import { getSiteConfig } from '@/lib/settings';
import { toPlaceView, type PlaceView } from '@/lib/places-view';
import { EmptyState } from '@/components/EmptyState';
import { PlacesGlobe } from '@/components/PlacesGlobeLazy';
import type { PlacesGlobeLabels } from '@/components/PlacesGlobe';

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
 * Religious places globe (MapLibre globe phase).
 *
 * Thin RSC shell: server-fetches all published places (GET /api/v1/places)
 * plus the CRM globe settings (default view, place types, popup shape),
 * resolves LocalizedText to plain strings, then mounts the code-split
 * MapLibre globe. MapLibre never enters the homepage bundle. API failure or an
 * empty catalogue renders an honest state instead of a fake globe.
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
  // Globe settings are CRM-controlled; a settings failure keeps the
  // Kaaba-centered defaults instead of breaking the globe.
  const siteConfig = await getSiteConfig();

  const labels: PlacesGlobeLabels = {
    allTypes: t('types.all'),
    tileFallbackNotice: t('tileFallbackNotice'),
    locationError: t('locationError'),
    toggleTypeFilter: t('toggleTypeFilter'),
    closePanel: t('closePanel'),
    modeSatellite: t('modeSatellite'),
    modeSimple: t('modeSimple'),
    modeDark: t('modeDark'),
    modeTopology: t('modeTopology'),
    searchPlaceholder: t('searchPlaceholder'),
    searchNoResults: t('searchNoResults'),
    myLocation: t('myLocation'),
    locating: t('locating'),
    located: t('located'),
    locationDenied: t('locationDenied'),
    locationUnsupported: t('locationUnsupported'),
    autoRotateOn: t('autoRotateOn'),
    autoRotateOff: t('autoRotateOff'),
    qiblaFromHere: t('qiblaFromHere'),
    qiblaInfo: t.raw('qiblaInfo'),
    galleryPrev: t('galleryPrev'),
    galleryNext: t('galleryNext'),
    galleryCounter: t.raw('galleryCounter'),
    video360: t('view360'),
    videoLinkFallback: t('videoLinkFallback'),
    cityLabel: t('cityLabel'),
    typeLabel: t('typeLabel'),
    listTitle: t('listTitle'),
    showAll: t('showAll'),
    mapLoadError: t('mapLoadError'),
  };

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-subtitle">{t('subtitle')}</p>
      <p className="place-register-cta">
        <Link className="place-tour-link" href={`/${locale}/places/register`}>
          {t('registerCta')}
        </Link>
        <span className="place-register-hint">{t('registerHint')}</span>
      </p>
      {failed ? (
        <EmptyState title={t('loadFailed')} hint={t('loadFailedHint')} />
      ) : views.length === 0 ? (
        <EmptyState title={t('noPlaces')} hint={t('noPlacesHint')} />
      ) : (
        <PlacesGlobe
          locale={locale}
          places={views}
          typeDefs={siteConfig.placeTypes}
          popupConfig={siteConfig.placesPopup}
          globeSettings={siteConfig.globe}
          labels={labels}
        />
      )}
    </div>
  );
}
