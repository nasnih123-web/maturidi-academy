import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { AtmosphericEngine } from "@/components/AtmosphericEngine";
import { SiteHeader, type HeaderLabels } from "@/components/SiteHeader";
import { SiteFooter, type FooterColumn, type FooterLabels } from "@/components/SiteFooter";
import { AdhanCountdown, type AdhanCountdownLabels } from "@/components/AdhanCountdown";
import { OfflineIndicator, type OfflineIndicatorLabels } from "@/components/OfflineIndicator";
import { SwRegister } from "@/components/SwRegister";
import { TauriBridge } from "@/components/TauriBridge";
import { MunajatGate, type MunajatGateLabels } from "@/components/MunajatGate";
import { AuthProvider } from "@/lib/auth-context";
import { AudioPlayerProvider, type MiniPlayerLabels } from "@/lib/audio-player-context";
import { getHomeSections } from "@/lib/api";
import { getSiteConfig, uploadedFontCss, type Locale } from "@/lib/settings";
import { getNavItems } from "@/lib/content";
import { finalizeNav, getCmsNav, getFooterBrand, getNavColumns, type NavEntryFinal } from "@/lib/section-data";
import "./globals.css";
// Design tokens: `--ma-*` system (source of truth for platform_settings
// theme overrides) + the imperial semantic system (`turbo.css`, imported
// from globals.css). Both stay available; the ported UI is imperial-first.
import "@maturidi/design-tokens/tokens.css";

const DIRECTION: Record<string, "rtl" | "ltr"> = { fa: "rtl", ar: "rtl", en: "ltr" };
const LOCALES = ["fa", "ar", "en"] as const;

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "home" });
  const tRoot = await getTranslations({ locale });
  const base = siteUrl();
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title: { default: title, template: `%s — ${tRoot("appName")}` },
    description,
    icons: { icon: "/icon.png", apple: "/apple-icon.png", shortcut: "/icon.png" },
    manifest: "/manifest.webmanifest",
    alternates: {
      canonical: `${base}/${locale}`,
      languages: { fa: `${base}/fa`, ar: `${base}/ar`, en: `${base}/en`, "x-default": `${base}/fa` },
    },
    openGraph: {
      title,
      description,
      locale,
      type: "website",
      url: `${base}/${locale}`,
      images: [{ url: `${base}/logo.jpg`, alt: tRoot("appName") }],
    },
    twitter: { card: "summary", title, description, images: [`${base}/logo.jpg`] },
  };
}

function headerLabels(
  tHeader: Awaited<ReturnType<typeof getTranslations>>,
  tRoot: Awaited<ReturnType<typeof getTranslations>>,
  tHome: Awaited<ReturnType<typeof getTranslations>>,
): HeaderLabels {
  return {
    skip: tHome("skipToContent"),
    brandName: tRoot("appName"),
    brandSub: tRoot("brandSub"),
    navAria: tHeader("navAria"),
    mobileNavAria: tHeader("mobileNavAria"),
    searchPlaceholder: tHeader("searchPlaceholder"),
    searchAria: tHeader("searchAria"),
    langAria: tHeader("langAria"),
    langNames: {
      fa: tHeader("langNames.fa"),
      ar: tHeader("langNames.ar"),
      en: tHeader("langNames.en"),
    },
    menuAria: tHeader("menuAria"),
    closeAria: tHeader("closeAria"),
    submenuAria: tHeader("submenuAria"),
    submenuExpandTemplate: tHeader.raw("submenuExpand"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: "home" });
  const tRoot = await getTranslations({ locale });
  const tHeader = await getTranslations({ locale, namespace: "header" });
  const tFooter = await getTranslations({ locale, namespace: "footer" });
  const tAdhan = await getTranslations({ locale, namespace: "adhan" });
  const tOffline = await getTranslations({ locale, namespace: "offline" });
  const tMunajat = await getTranslations({ locale, namespace: "munajat" });
  const tLibrary = await getTranslations({ locale, namespace: "library" });
  // Phase 9: site-wide audio mini-player labels (provider is a thin client
  // shell; the MiniPlayer UI chunk loads only once a track is active).
  const miniPlayerLabels: MiniPlayerLabels = {
    nowPlaying: tLibrary("player.nowPlaying"),
    play: tLibrary("player.play"),
    pause: tLibrary("player.pause"),
    close: tLibrary("player.close"),
    expandAria: tLibrary("player.expandAria"),
    collapseAria: tLibrary("player.collapseAria"),
    audioFailed: tLibrary("player.audioFailed"),
  };

  // Primary nav: CMS-driven (`GET /api/v1/content/public/nav`) — nested
  // tree, visible, locale-filtered and schedule-resolved server-side.
  // Falls back to the localized static IA only when the API returns empty,
  // so the menu never breaks. Footer columns are already API-driven
  // (footer section `data.columns`); the static columns are its fallback.
  const staticNav: NavEntryFinal[] = (tHeader.raw("nav") as { href: string; label: string }[]).map(
    (n) => ({ href: `/${locale}${n.href}`, label: n.label, external: false, children: [] }),
  );
  let nav: NavEntryFinal[] = staticNav;
  const apiNav = await getNavItems(locale as "fa" | "ar" | "en");
  if (apiNav.length > 0) {
    const cmsNav = finalizeNav(getCmsNav(apiNav, locale), locale);
    if (cmsNav.length > 0) nav = cmsNav;
  }

  const footerColumns: FooterColumn[] = tFooter.raw("columns") as FooterColumn[];
  // Footer is CRM-driven (footer section `data.columns` + `data.brand`);
  // the localized static columns/messages are the fallback whenever the
  // API has none, so a null/empty footer payload never breaks the footer.
  let apiColumns: FooterColumn[] = [];
  let apiBrand: { tagline: string | null; rights: string | null } | null = null;
  try {
    const res = await getHomeSections();
    const footerSection = res.sections.find((s) => s.key === "footer" && s.visible !== false);
    if (footerSection) {
      apiColumns = getNavColumns(footerSection.data, locale);
      apiBrand = getFooterBrand(footerSection.data, locale);
    }
  } catch {
    apiColumns = [];
    apiBrand = null;
  }
  const footerLabels: FooterLabels = {
    brandName: tRoot("appName"),
    tagline: apiBrand?.tagline ?? tFooter("tagline"),
    rights: apiBrand?.rights ?? tFooter("rights", { year: String(new Date().getFullYear()) }),
    navFallback: footerColumns,
  };

  const adhanStripLabels: AdhanCountdownLabels = {
    prefix: tAdhan("stripPrefix"),
    prayerNames: {
      imsak: tAdhan("prayers.imsak"),
      fajr: tAdhan("prayers.fajr"),
      sunrise: tAdhan("prayers.sunrise"),
      dhuhr: tAdhan("prayers.dhuhr"),
      asr: tAdhan("prayers.asr"),
      maghrib: tAdhan("prayers.maghrib"),
      isha: tAdhan("prayers.isha"),
      midnight: tAdhan("prayers.midnight"),
    },
    setupLink: tAdhan("stripSetup"),
    countdownAria: tAdhan("countdownAria"),
  };

  const offlineLabels: OfflineIndicatorLabels = {
    online: tOffline("indicatorOnline"),
    offline: tOffline("indicatorOffline"),
    syncing: tOffline("indicatorSyncing"),
    pendingOps: tOffline("pendingOps"),
    aria: tOffline("indicatorAria"),
  };

  const munajatLabels: MunajatGateLabels = {
    toggleOn: tMunajat("toggleOn"),
    toggleOff: tMunajat("toggleOff"),
    toggleAuto: tMunajat("toggleAuto"),
    toggleAria: tMunajat("toggleAria"),
    ambientPlay: tMunajat("ambientPlay"),
    ambientPause: tMunajat("ambientPause"),
  };

  // Platform settings (cached, revalidate 120s — see lib/settings.ts): particles,
  // uploaded per-locale fonts, hero copy, homepage slots. Non-throwing;
  // missing settings → today's defaults.
  const siteConfig = await getSiteConfig();
  const loc = (["fa", "ar", "en"].includes(locale) ? locale : "fa") as Locale;
  const uploadedFont = siteConfig.fonts[loc];

  return (
    // Imperial dark-obsidian is the only theme (polish milestone: the
    // dark-mode toggle was removed). `data-theme="dark"` is now a constant.
    <html lang={locale} dir={DIRECTION[locale] ?? "rtl"} data-locale={locale} data-theme="dark">
      <body>
        {uploadedFont ? <style>{uploadedFontCss(loc, uploadedFont)}</style> : null}
        <NextIntlClientProvider messages={messages}>
          {/* global living background — behind every page, even the footer */}
          <div className="site-atmosphere" aria-hidden>
            <AtmosphericEngine config={siteConfig.particles} />
          </div>
          <AuthProvider>
            <SwRegister />
            <TauriBridge />
            <MunajatGate settings={siteConfig.munajat} labels={munajatLabels}>
              <div className="adhan-strip-bar" role="region" aria-label={adhanStripLabels.countdownAria}>
                <AdhanCountdown locale={locale} settings={siteConfig.adhan} labels={adhanStripLabels} />
                <OfflineIndicator labels={offlineLabels} />
              </div>
              <SiteHeader locale={locale} labels={headerLabels(tHeader, tRoot, t)} nav={nav} />
              <AudioPlayerProvider labels={miniPlayerLabels}>
                <main id="main-content" aria-label={t("mainLandmark")}>
                  {children}
                </main>
              </AudioPlayerProvider>
              <SiteFooter locale={locale} labels={footerLabels} columns={apiColumns} />
            </MunajatGate>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
