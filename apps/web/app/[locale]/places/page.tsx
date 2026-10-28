import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAllPlaces } from '@/lib/places';
import { getSiteConfig } from '@/lib/settings';
import { toPlaceView, type PlaceView } from '@/lib/places-view';
import { EmptyState } from '@/components/EmptyState';
import { GlobeExplorer } from '@/components/GlobeExplorerLazy';
import type { GlobeExplorerLabels } from '@/components/GlobeExplorer';

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
 * Religious places globe (globe phase).
 *
 * Thin RSC shell: server-fetches all published places (GET /api/v1/places)
 * plus the CRM globe settings (default view, place types, popup shape),
 * resolves LocalizedText to plain strings, then mounts the code-split 3D
 * globe. three.js never enters the homepage bundle. API failure or an
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

  const labels: GlobeExplorerLabels = {
    legendTitle: t('legendTitle'),
    allTypes: t('types.all'),
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
    qiblaArcLabel: t('qiblaArcLabel'),
    closePanel: t('closePanel'),
    galleryPrev: t('galleryPrev'),
    galleryNext: t('galleryNext'),
    galleryCounter: t.raw('galleryCounter'),
    video360: t('view360'),
    videoRegular: t('videoRegular'),
    videoLinkFallback: t('videoLinkFallback'),
    viewDetail: t('viewDetail'),
    cityLabel: t('cityLabel'),
    typeLabel: t('typeLabel'),
    loading: t('loading'),
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
        <GlobeExplorer
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
