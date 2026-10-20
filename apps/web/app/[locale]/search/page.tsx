import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { searchApi, ApiError } from "@/lib/api";
import { pickText } from "@/lib/localize";

export async function generateMetadata({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "searchPage" });
  const q = (searchParams.q ?? "").trim();
  return {
    title: q ? t("resultsFor", { q }) : t("metaTitle"),
    robots: { index: false, follow: true },
  };
}

/**
 * Search results page — server-rendered from GET /api/v1/search.
 * Linked from the header search and the hero mihrab search (form action),
 * so search works with and without JavaScript.
 */
export default async function SearchPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "searchPage" });
  const tHome = await getTranslations({ locale, namespace: "home" });
  const q = (searchParams.q ?? "").trim();

  if (!q) {
    return (
      <div className="search-page">
        <h1>{t("title")}</h1>
        <p>{t("hint")}</p>
      </div>
    );
  }

  let results: { id: string; type: string; title: string; snippet: string; href: string | null }[] = [];
  let failed = false;
  try {
    const res = await searchApi(q, { limit: 20 });
    results = res.results.map((r) => ({
      id: `${r.type}:${r.id}`,
      type: r.type,
      title: pickText(r.title, locale),
      snippet: typeof r.snippet === "string" ? r.snippet : "",
      href: typeof r.url === "string" && r.url ? r.url : null,
    }));
  } catch (err) {
    failed = true;
    // eslint-disable-next-line no-console
    console.error("[web] search failed:", err instanceof ApiError ? err.message : err);
  }

  return (
    <div className="search-page">
      <h1>{t("title")}</h1>
      {failed ? (
        <div className="error-state" role="alert">
          <p>
            <strong>{t("errorTitle")}</strong>
          </p>
          <p>{t("errorDescription")}</p>
        </div>
      ) : (
        <>
          <p aria-live="polite">{t("resultsFor", { q })}</p>
          {results.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>{t("noResults")}</h3>
            </div>
          ) : (
            <div>
              {results.map((r) => {
                const typeName = tHome(`search.types.${r.type}` as never) as string;
                const body = (
                  <>
                    <span className="res-type">{typeName}</span>
                    <h2>{r.title}</h2>
                    {r.snippet ? <p>{r.snippet}</p> : null}
                  </>
                );
                return r.href ? (
                  <Link key={r.id} className="search-result" href={r.href}>
                    {body}
                  </Link>
                ) : (
                  <div key={r.id} className="search-result">
                    {body}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
