import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicArticles } from "@/lib/content";
import { pickText } from "@/lib/localize";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "articlesPage" });
  return { title: t("title"), robots: { index: true, follow: true } };
}

/**
 * Articles list page — published CMS pages with content_type=article,
 * from GET /api/v1/content/public/pages. The header/footer nav link to
 * /articles, but no list route existed before this page (only
 * /pages/[slug] for a single item), so the menu link 404'd.
 * Non-throwing: a missing/empty backend yields the empty state.
 */
export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "articlesPage" });
  const articles = await getPublicArticles();

  return (
    <div className="search-page">
      <h1>{t("title")}</h1>
      {articles.length === 0 ? (
        <div className="empty-state" role="status">
          <h3>{t("empty")}</h3>
        </div>
      ) : (
        <div>
          {articles.map((a) => (
            <Link key={a.slug} className="search-result" href={`/${locale}/pages/${a.slug}`}>
              <h2>{pickText(a.title, locale)}</h2>
              {a.published_at ? (
                <p>{new Date(a.published_at).toLocaleDateString(locale)}</p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
