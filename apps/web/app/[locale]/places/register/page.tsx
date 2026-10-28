import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSiteConfig } from '@/lib/settings';
import { typeLabel } from '@/lib/places-view';
import { PlaceRegisterForm, type PlaceRegisterLabels } from '@/components/PlaceRegisterForm';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'places' });
  return { title: t('registerMetaTitle'), description: t('registerMetaDescription') };
}

/**
 * Public place registration (maps phase) — thin RSC shell over the client
 * form. Submissions land as drafts (POST /api/v1/places/submissions) and
 * reach the public map only after CRM review + publish — never directly.
 */
export default async function PlaceRegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'places' });

  // Type options come from the CRM `places.types` setting (defaults when
  // the setting is absent); labels resolve per locale from the defs.
  const siteConfig = await getSiteConfig();
  const typeDefs = siteConfig.placeTypes;
  const typeLabels = Object.fromEntries(
    typeDefs.map((d) => [d.key, typeLabel(typeDefs, d.key, locale)]),
  ) as Record<string, string>;
  const typeKeys = typeDefs.map((d) => d.key);

  const labels: PlaceRegisterLabels = {
    name: t('registerName'),
    description: t('registerDescription'),
    city: t('registerCity'),
    cityHint: t('registerCityHint'),
    imageUrl: t('registerImageUrl'),
    imageUrlHint: t('registerImageUrlHint'),
    lat: t('registerLat'),
    lng: t('registerLng'),
    type: t('registerType'),
    useMyLocation: t('registerUseMyLocation'),
    locating: t('registerLocating'),
    located: t('registerLocated'),
    locationDenied: t('registerLocationDenied'),
    locationUnsupported: t('registerLocationUnsupported'),
    manualHint: t('registerManualHint'),
    submit: t('registerSubmit'),
    submitting: t('registerSubmitting'),
    success: t('registerSuccess'),
    successHint: t('registerSuccessHint'),
    error: t('registerError'),
    nameRequired: t('registerNameRequired'),
    invalidCoords: t('registerInvalidCoords'),
    invalidImageUrl: t('registerInvalidImageUrl'),
    backToMap: t('backToMap'),
  };

  return (
    <div className="page-wrap">
      <Link className="place-back" href={`/${locale}/places`}>
        {t('backToMap')}
      </Link>
      <h1 className="page-title">{t('registerTitle')}</h1>
      <p className="page-subtitle">{t('registerSubtitle')}</p>
      <PlaceRegisterForm locale={locale} labels={labels} typeLabels={typeLabels} typeKeys={typeKeys} />
    </div>
  );
}
