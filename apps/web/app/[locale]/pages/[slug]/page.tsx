import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCmsPage } from "@/lib/content";
import { getHomeSections } from "@/lib/api";
import { pickText } from "@/lib/localize";
import { buildHomeLabels } from "@/lib/home-labels";
import { breadcrumbJsonLd, formatUpdatedAt, isoDateOnly, pageJsonLd, siteUrl } from "@/lib/seo";
import { CmsPageView, type CmsBreadcrumb } from "@/components/CmsPageView";
import type { CmsLang } from "@/components/CmsBlocks";
import type { HomeSection } from "@/lib/types";

function cmsLang(locale: string): CmsLang {
  return locale === "ar" ? "ar" : locale === "en" ? "en" : "fa";
}

async function loadPage(locale: string, slug: string, searchParams: Record<string, string | undefined>) {
  const previewId = typeof searchParams.preview === "string" ? searchParams.preview : undefined;
  const token = typeof searchParams.pt === "string" ? searchParams.pt : undefined;
  const preview = Boolean(previewId);
  const page = await getCmsPage(slug, preview ? { previewId, token } : {});
  return { page, preview };
}

export async function generateMetadata({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const { page, preview } = await loadPage(locale, slug, searchParams);
  const lang = cmsLang(locale);
  const t = await getTranslations({ locale, namespace: "content" });
  const base = siteUrl();
  const title = page ? pickText(page.title, locale) : "";
  const description = page?.seo_meta?.description?.trim() || undefined;
  const canonical = page?.seo_meta?.canonical?.trim() || `${base}/${locale}/pages/${slug}`;
  const author = page?.seo_meta?.author?.trim() || undefined;
  return {
    title: title || t("page.errorTitle"),
    description,
    alternates: { canonical },
    ...(author ? { authors: [{ name: author }] } : {}),
    openGraph: {
      title: title || t("page.errorTitle"),
      ...(description ? { description } : {}),
      url: canonical,
      type: page?.content_type === "article" ? "article" : "website",
      locale,
    },
    ...(preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function CmsSlugPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale, slug } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "content" });
  const tHome = await getTranslations({ locale, namespace: "home" });
  const lang = cmsLang(locale);
  const { page, preview } = await loadPage(locale, slug, searchParams);

  if (!page) notFound();

  // Homepage sections for `section-*` embeds (dropped from the editor palette).
  // Non-throwing: a missing home API only disables embeds, never the page.
  let homeSections: HomeSection[] = [];
  try {
    homeSections = (await getHomeSections()).sections;
  } catch {
    homeSections = [];
  }
  const sectionLabels = buildHomeLabels(tHome);
  const sectionEmbed = { sections: homeSections, locale, labels: sectionLabels };

  const base = siteUrl();
  const url = `${base}/${locale}/pages/${slug}`;
  const title = pickText(page.title, locale);
  const breadcrumbs: CmsBreadcrumb[] = [
    { name: t("page.home"), href: `/${locale}` },
    { name: title, href: `/${locale}/pages/${slug}` },
  ];
  const updatedIso = isoDateOnly(page.updated_at);
  const updated = updatedIso
    ? {
        iso: updatedIso,
        prefix: t("page.updatedOn"),
        date: formatUpdatedAt(page.updated_at, locale),
      }
    : null;

  return (
    <CmsPageView
      lang={lang}
      title={title}
      blocks={page.blocks}
      breadcrumbs={breadcrumbs}
      updated={updated}
      preview={preview}
      previewLabel={preview ? t("page.previewBadge") : undefined}
      breadcrumbAria={t("page.breadcrumbAria")}
      sectionEmbed={sectionEmbed}
      jsonLd={[breadcrumbJsonLd(breadcrumbs.map((b) => ({ name: b.name, url: `${base}${b.href}` }))), pageJsonLd(page, locale, url)]}
    />
  );
}
