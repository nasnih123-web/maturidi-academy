import type { MetadataRoute } from "next";

async function publishedArticleSlugs(): Promise<string[]> {
  const api = (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000"
  ).replace(/\/+$/, "");
  const slugs: string[] = [];
  try {
    let page = 1;
    let pages = 1;
    while (page <= pages) {
      const res = await fetch(`${api}/api/v1/articles?page=${page}&per_page=100`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      });
      if (!res.ok) return slugs;
      const o = (await res.json()) as Record<string, unknown>;
      if (Array.isArray(o.items)) {
        for (const raw of o.items) {
          if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).slug === "string") {
            slugs.push((raw as Record<string, unknown>).slug as string);
          }
        }
      }
      pages = typeof o.pages === "number" ? o.pages : 0;
      page += 1;
    }
  } catch {
    /* sitemap falls back to static routes; articles are added next run */
  }
  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const routes = ["", "/search", "/terms", "/privacy", "/fatwa/all", "/articles"];
  const locales = ["fa", "ar", "en"];
  const out: MetadataRoute.Sitemap = routes.flatMap((r) =>
    locales.map((l) => ({
      url: `${base}/${l}${r}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: r === "" ? 1 : 0.5,
    })),
  );
  const slugs = await publishedArticleSlugs();
  for (const slug of slugs) {
    for (const l of locales) {
      out.push({
        url: `${base}/${l}/articles/${encodeURIComponent(slug)}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      });
    }
  }
  return out;
}
