import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCmsPage } from "@/lib/content";
import { pickText } from "@/lib/localize";
import { breadcrumbJsonLd, formatUpdatedAt, isoDateOnly, pageJsonLd, siteUrl } from "@/lib/seo";
import { CmsPageView, type CmsBreadcrumb } from "@/components/CmsPageView";
import type { CmsLang } from "@/components/CmsBlocks";

const SLUG = "privacy";

function cmsLang(locale: string): CmsLang {
  return locale === "ar" ? "ar" : locale === "en" ? "en" : "fa";
}

/**
 * Privacy Policy — the official copy lives in the CMS (published page
 * `${SLUG}`); the web only renders it. No next-intl fallback: a missing page
 * is an honest 404, never placeholder copy.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await getCmsPage(SLUG);
  const base = siteUrl();
  const title = page ? pickText(page.title, locale) : "";
  return {
    title,
    description: page?.seo_meta?.description?.trim() || undefined,
    alternates: { canonical: page?.seo_meta?.canonical?.trim() || `${base}/${locale}/privacy` },
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "content" });
  const page = await getCmsPage(SLUG);
  if (!page) notFound();

  const lang = cmsLang(locale);
  const base = siteUrl();
  const url = `${base}/${locale}/privacy`;
  const title = pickText(page.title, locale);
  const breadcrumbs: CmsBreadcrumb[] = [
    { name: t("page.home"), href: `/${locale}` },
    { name: title, href: `/${locale}/privacy` },
  ];
  const updatedIso = isoDateOnly(page.updated_at);

  return (
    <CmsPageView
      lang={lang}
      title={title}
      blocks={page.blocks}
      breadcrumbs={breadcrumbs}
      updated={
        updatedIso
          ? { iso: updatedIso, prefix: t("page.updatedOn"), date: formatUpdatedAt(page.updated_at, locale) }
          : null
      }
      breadcrumbAria={t("page.breadcrumbAria")}
      jsonLd={[
        breadcrumbJsonLd(breadcrumbs.map((b) => ({ name: b.name, url: `${base}${b.href}` }))),
        pageJsonLd(page, locale, url),
      ]}
    />
  );
}
