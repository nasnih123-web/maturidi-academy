import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, apiUpload } from "./api";
import type { Locale } from "./i18n";
import type { UploadedFont } from "./fonts";

/**
 * Appearance service — presentation configuration backed by platform_settings
 * (ADR-001: all parsing / defaults / API access live here, never in
 * components).
 *
 * Canonical keys (Track A):
 *   particles      {enabled, count, speed, parallax, lines}
 *   fonts.fa|ar|en {family, url} | null
 *   home.sections  [{id, variant, enabled}]
 *   hero.fa|ar|en  {title, subtitle, primary_cta, secondary_cta}
 *   POST /api/v1/admin/fonts (multipart: locale, family, file)
 *   DELETE /api/v1/admin/fonts/{locale}
 *
 * The settings endpoint contract is normalized here: the current backend
 * answers GET /api/v1/admin/settings with {settings: [{key, value, masked,
 * type, updated_at}], version} and expects PUT {settings: {...}}; older
 * backends used a flat map. Both shapes are accepted on read, and writes
 * try the envelope first with a flat-map fallback.
 */

export type SettingsMap = Record<string, string | null>;

/* ------------------------------------------------------------------ */
/* settings transport                                                  */
/* ------------------------------------------------------------------ */

interface SettingsListItem {
  key: string;
  value: unknown;
  masked?: boolean;
}

interface SettingsListOut {
  settings: SettingsListItem[];
  version?: number;
}

function isListShape(raw: unknown): raw is SettingsListOut {
  return (
    !!raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { settings?: unknown }).settings)
  );
}

export async function readSettingsMap(): Promise<SettingsMap> {
  const raw = await apiFetch<unknown>("/api/v1/admin/settings");
  if (isListShape(raw)) {
    const map: SettingsMap = {};
    for (const item of raw.settings) {
      if (!item || typeof item.key !== "string") continue;
      if (item.masked) continue; // secrets are never displayed
      map[item.key] =
        item.value == null
          ? null
          : typeof item.value === "string"
            ? item.value
            : JSON.stringify(item.value);
    }
    return map;
  }
  return ((raw ?? {}) as SettingsMap);
}

/** Write settings; tries the {settings: {...}} envelope, falls back to flat. */
export async function writeSettingsMap(
  partial: Record<string, string | null>,
): Promise<void> {
  try {
    await apiFetch("/api/v1/admin/settings", {
      method: "PUT",
      body: { settings: partial },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await apiFetch("/api/v1/admin/settings", { method: "PUT", body: partial });
      return;
    }
    throw err;
  }
}

export function useAppearanceSettingsQuery() {
  return useQuery({
    queryKey: ["platform-settings"],
    queryFn: readSettingsMap,
    retry: false,
    staleTime: 60_000,
  });
}

export function useWriteAppearanceKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | null }) =>
      writeSettingsMap({ [key]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* particles                                                           */
/* ------------------------------------------------------------------ */

export interface ParticlesConfig {
  enabled: boolean;
  count: number;
  speed: number;
  parallax: number;
  lines: boolean;
}

export const DEFAULT_PARTICLES: ParticlesConfig = {
  enabled: true,
  count: 110,
  speed: 1,
  parallax: 0.055,
  lines: true,
};

const PARTICLES_CACHE_KEY = "crm.particles";

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function parseParticlesConfig(raw: string | null | undefined): ParticlesConfig {
  if (!raw) return { ...DEFAULT_PARTICLES };
  try {
    const p = JSON.parse(raw) as Partial<ParticlesConfig>;
    return {
      enabled: p.enabled !== false,
      count: clamp(Number(p.count ?? DEFAULT_PARTICLES.count), 0, 400),
      speed: clamp(Number(p.speed ?? DEFAULT_PARTICLES.speed), 0.1, 3),
      parallax: clamp(Number(p.parallax ?? DEFAULT_PARTICLES.parallax), 0, 0.2),
      lines: p.lines !== false,
    };
  } catch {
    return { ...DEFAULT_PARTICLES };
  }
}

function loadCachedParticles(): ParticlesConfig {
  try {
    return parseParticlesConfig(localStorage.getItem(PARTICLES_CACHE_KEY));
  } catch {
    return { ...DEFAULT_PARTICLES };
  }
}

/**
 * Particles config with graceful degradation: settings (authenticated) →
 * localStorage cache (login page, pre-auth) → built-in defaults.
 */
export function useParticlesConfig(): ParticlesConfig {
  const [cached, setCached] = React.useState<ParticlesConfig>(loadCachedParticles);
  const { data } = useAppearanceSettingsQuery();

  React.useEffect(() => {
    if (!data) return;
    const cfg = parseParticlesConfig(data["particles"]);
    setCached(cfg);
    try {
      localStorage.setItem(PARTICLES_CACHE_KEY, JSON.stringify(cfg));
    } catch {
      // storage unavailable — session-only
    }
  }, [data]);

  return cached;
}

/* ------------------------------------------------------------------ */
/* uploaded fonts                                                      */
/* ------------------------------------------------------------------ */

export function parseUploadedFont(raw: string | null | undefined): UploadedFont | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<UploadedFont>;
    if (typeof f.family === "string" && f.family && typeof f.url === "string" && f.url) {
      return { family: f.family, url: f.url };
    }
    return null;
  } catch {
    return null;
  }
}

export function useUploadedFonts(): Record<Locale, UploadedFont | null> {
  const { data } = useAppearanceSettingsQuery();
  return React.useMemo(
    () => ({
      fa: parseUploadedFont(data?.["fonts.fa"]),
      ar: parseUploadedFont(data?.["fonts.ar"]),
      en: parseUploadedFont(data?.["fonts.en"]),
    }),
    [data],
  );
}

/**
 * Upload a locale font for a locale → POST /api/v1/admin/fonts
 * (multipart: locale, family, file). The endpoint may not exist yet
 * (Track A); 404 is surfaced honestly so the UI can say so.
 */
export async function uploadFont(
  locale: Locale,
  family: string,
  file: File,
): Promise<UploadedFont> {
  const form = new FormData();
  form.append("locale", locale);
  form.append("family", family);
  form.append("file", file);
  return apiUpload<UploadedFont>("/api/v1/admin/fonts", form);
}

export async function deleteFont(locale: Locale): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/fonts/${locale}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* brand logo                                                          */
/* ------------------------------------------------------------------ */

export const DEFAULT_BRAND_LOGO = "/brand/logo.jpg";

/**
 * Sidebar/login brand mark: the school emblem is the default; an admin can
 * override it via the `branding.crm_logo_url` platform setting (read-only
 * for now — not in SETTING_DEFS yet).
 */
export function resolveBrandLogo(settings: SettingsMap | undefined): string {
  const override = settings?.["branding.crm_logo_url"];
  return override && override.trim() ? override.trim() : DEFAULT_BRAND_LOGO;
}

export function useBrandLogo(): string {
  const { data } = useAppearanceSettingsQuery();
  return React.useMemo(() => resolveBrandLogo(data), [data]);
}

/* ------------------------------------------------------------------ */
/* home sections (variant picker)                                      */
/* ------------------------------------------------------------------ */

/**
 * The 10 below-hero section variants — mirrors the canonical registry
 * `apps/web/components/sections/registry.ts` (Track C, polish issue #8).
 * Cross-app import is impossible, so ids/labels are duplicated here by
 * contract; the picker tolerates unknown variant values from the server.
 */
export interface SectionVariantMeta {
  id: string;
  label: Record<Locale, string>;
  description: string;
}

export const SECTION_VARIANTS: SectionVariantMeta[] = [
  { id: "slider-classic", label: { fa: "اسلایدر کلاسیک", ar: "سلايدر كلاسيكي", en: "Classic slider" }, description: "ریل افقی کارت‌ها با دکمه‌های قبلی/بعدی و نقطه‌های صفحه" },
  { id: "grid-cards", label: { fa: "شبکهٔ کارت‌ها", ar: "شبكة البطاقات", en: "Card grid" }, description: "شبکهٔ واکنش‌گرای ۲ تا ۴ ستونه، بدون اسکرول افقی" },
  { id: "featured-rail", label: { fa: "ریل ویژه", ar: "سكة مميزة", en: "Featured rail" }, description: "کارت ویژهٔ بزرگ + ریل اسلایدری عریض برای بقیه" },
  { id: "shelf-row", label: { fa: "قفسهٔ سه‌بعدی", ar: "رف ثلاثي الأبعاد", en: "3D shelf" }, description: "ردیف کتاب‌مانند با پرسپکتیو ملایم — مناسب کتابخانه" },
  { id: "mosaic-wall", label: { fa: "دیوار موزاییکی", ar: "جدار فسيفسائي", en: "Mosaic wall" }, description: "کارت لید ۲×۲ + بقیه در شبکهٔ فشرده" },
  { id: "editorial-split", label: { fa: "تحریریه‌ای دوتکه", ar: "تقسيم تحريري", en: "Editorial split" }, description: "مطلب ویژهٔ بزرگ در کنار ستون فهرست مینیمال" },
  { id: "featured-list", label: { fa: "ویژه + فهرست", ar: "مميز + قائمة", en: "Featured + list" }, description: "کارت ویژه در کنار فهرست تیترها با نشان ستاره" },
  { id: "magazine-columns", label: { fa: "ستون‌های مجله‌ای", ar: "أعمدة المجلة", en: "Magazine columns" }, description: "چیدمان روزنامه‌ای چندستونه با کارت‌های تحریریه‌ای" },
  { id: "stack-timeline", label: { fa: "خط زمانی", ar: "خط زمني", en: "Timeline" }, description: "فهرست عمودی با خط راهنما و نقطه‌های نشانگر" },
  { id: "compact-list", label: { fa: "فهرست فشرده", ar: "قائمة مضغوطة", en: "Compact list" }, description: "ردیف‌های فشرده با تیتر و فراداده — بیشترین تراکم" },
];

export type SectionVariant = (typeof SECTION_VARIANTS)[number]["id"];

export function variantLabel(variants: SectionVariantMeta[], id: string, locale: Locale): string {
  return variants.find((v) => v.id === id)?.label[locale] ?? id;
}

export interface HomeSectionSlot {
  id: string;
  variant: string;
  enabled: boolean;
}

/** Default below-hero slots (the web's 10 home keys minus hero/status/footer). */
export const DEFAULT_HOME_SECTIONS: HomeSectionSlot[] = [
  { id: "latest_fatwas", variant: "slider-classic", enabled: true },
  { id: "quran_of_day", variant: "featured-rail", enabled: true },
  { id: "suggested_lessons", variant: "slider-classic", enabled: true },
  { id: "fresh_library", variant: "shelf-row", enabled: true },
  { id: "community", variant: "grid-cards", enabled: true },
  { id: "nearby_map", variant: "mosaic-wall", enabled: false },
  { id: "donation_banner", variant: "editorial-split", enabled: true },
];

export function parseHomeSections(raw: string | null | undefined): HomeSectionSlot[] {
  if (!raw) return DEFAULT_HOME_SECTIONS.map((s) => ({ ...s }));
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return DEFAULT_HOME_SECTIONS.map((s) => ({ ...s }));
    const out: HomeSectionSlot[] = [];
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const rec = it as Record<string, unknown>;
      if (typeof rec.id !== "string" || !rec.id) continue;
      out.push({
        id: rec.id,
        variant: typeof rec.variant === "string" && rec.variant ? rec.variant : "slider-classic",
        enabled: rec.enabled !== false,
      });
    }
    return out.length > 0 ? out : DEFAULT_HOME_SECTIONS.map((s) => ({ ...s }));
  } catch {
    return DEFAULT_HOME_SECTIONS.map((s) => ({ ...s }));
  }
}

/* ------------------------------------------------------------------ */
/* hero                                                                */
/* ------------------------------------------------------------------ */

export interface HeroCta {
  label: string;
  href: string;
}

export interface HeroLocale {
  title: string;
  subtitle: string;
  primary_cta: HeroCta;
  secondary_cta: HeroCta;
}

export const EMPTY_HERO: HeroLocale = {
  title: "",
  subtitle: "",
  primary_cta: { label: "", href: "" },
  secondary_cta: { label: "", href: "" },
};

export function parseHeroLocale(raw: string | null | undefined): HeroLocale {
  if (!raw) return { ...EMPTY_HERO, primary_cta: { ...EMPTY_HERO.primary_cta }, secondary_cta: { ...EMPTY_HERO.secondary_cta } };
  try {
    const h = JSON.parse(raw) as Partial<HeroLocale>;
    const cta = (c: unknown): HeroCta => {
      const r = (c ?? {}) as Partial<HeroCta>;
      return {
        label: typeof r.label === "string" ? r.label : "",
        href: typeof r.href === "string" ? r.href : "",
      };
    };
    return {
      title: typeof h.title === "string" ? h.title : "",
      subtitle: typeof h.subtitle === "string" ? h.subtitle : "",
      primary_cta: cta(h.primary_cta),
      secondary_cta: cta(h.secondary_cta),
    };
  } catch {
    return { ...EMPTY_HERO, primary_cta: { ...EMPTY_HERO.primary_cta }, secondary_cta: { ...EMPTY_HERO.secondary_cta } };
  }
}
