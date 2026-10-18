import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const routes = ["", "/search", "/terms", "/privacy"];
  const locales = ["fa", "ar", "en"];
  return routes.flatMap((r) =>
    locales.map((l) => ({
      url: `${base}/${l}${r}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: r === "" ? 1 : 0.5,
    })),
  );
}
