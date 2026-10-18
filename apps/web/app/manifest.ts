import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "آکادمی ماتریدی — Maturidi Academy",
    short_name: "آکادمی ماتریدی",
    description: "پلتفرم آموزشی اسلامی جامع — Comprehensive Islamic learning platform",
    start_url: "/fa",
    display: "standalone",
    dir: "rtl",
    lang: "fa",
    background_color: "#04100d",
    theme_color: "#04100d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo.jpg", sizes: "1024x1024", type: "image/jpeg", purpose: "any" },
    ],
  };
}
