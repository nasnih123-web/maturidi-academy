import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCmsPage } from '@/lib/content';
import { pickText } from '@/lib/localize';
import { breadcrumbJsonLd, formatUpdatedAt, isoDateOnly, pageJsonLd, siteUrl } from '@/lib/seo';
import { CmsPageView, type CmsBreadcrumb } from '@/components/CmsPageView';
import type { CmsLang } from '@/components/CmsBlocks';
import { demoGuidelinesPage } from '@/lib/demo-social';
import { isSocialDemo } from '@/lib/social';

const SLUG = 'community-guidelines';

function cmsLang(locale: string): CmsLang {
  return locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fa';
}

async function loadGuidelines() {
  const page = await getCmsPage(SLUG);
  // Demo/screenshot fallback only: without a live CMS there is no page.
  // Never production data — the real page comes from the CMS (contract §15.9).
  if (!page && isSocialDemo()) return demoGuidelinesPage();
  return page;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const page = await loadGuidelines();
  const base = siteUrl();
  const title = page ? pickText(page.title, locale) : '';
  const description = page?.seo_meta?.description?.trim() || undefined;
  const canonical = page?.seo_meta?.canonical?.trim() || `${base}/${locale}/guidelines`;
  return {
    title: title || t('guidelinesMetaTitle'),
    description,
    alternates: { canonical },
    openGraph: {
      title: title || t('guidelinesMetaTitle'),
      ...(description ? { description } : {}),
      url: canonical,
      type: 'website',
      locale,
    },
  };
}

/**
 * Community guidelines (Phase 10): the CMS page slug `community-guidelines`
 * rendered with the same renderer as the Phase-4 CMS slug pages —
 * no duplicated rendering logic (ADR-001).
 */
export default async function GuidelinesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const tContent = await getTranslations({ locale, namespace: 'content' });
  const page = await loadGuidelines();

  if (!page) notFound();

  const base = siteUrl();
  const url = `${base}/${locale}/guidelines`;
  const title = pickText(page.title, locale);
  const breadcrumbs: CmsBreadcrumb[] = [
    { name: tContent('page.home'), href: `/${locale}` },
    { name: title, href: `/${locale}/guidelines` },
  ];
  const updatedIso = isoDateOnly(page.updated_at);
  const updated = updatedIso
    ? {
        iso: updatedIso,
        prefix: tContent('page.updatedOn'),
        date: formatUpdatedAt(page.updated_at, locale),
      }
    : null;

  return (
    <CmsPageView
      lang={cmsLang(locale)}
      title={title}
      blocks={page.blocks}
      breadcrumbs={breadcrumbs}
      updated={updated}
      breadcrumbAria={tContent('page.breadcrumbAria')}
      jsonLd={[
        breadcrumbJsonLd(breadcrumbs.map((b) => ({ name: b.name, url: `${base}${b.href}` }))),
        pageJsonLd(page, locale, url),
      ]}
    />
  );
}
