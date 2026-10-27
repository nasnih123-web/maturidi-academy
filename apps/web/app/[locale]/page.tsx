import { getTranslations, setRequestLocale } from "next-intl/server";
import { getHomeSections } from "@/lib/api";
import { getSiteConfig, type Locale } from "@/lib/settings";
import {
  getAnnouncements,
  getBanners,
  getCalendarTheme,
  getIslamicEvents,
  getScholarQuotes,
} from "@/lib/content";
import {
  getAnnouncementViews,
  getEventView,
  getScholarQuoteViews,
} from "@/lib/section-data";
import { buildHomeLabels } from "@/lib/home-labels";
import { getFatwaListServer } from "@/lib/fatwa-topics";
import { getArticleListServer } from "@/lib/articles";
import { themeCssText } from "@/lib/theme";
import { ArticlesSlider } from "@/components/ArticlesSlider";
import { HomeSections, HomeSectionRenderer } from "@/components/HomeSections";
import { ComposedSections } from "@/components/sections/SectionSlot";
import { AnnouncementsBar } from "@/components/AnnouncementsBar";
import { HomeBanners } from "@/components/HomeBanners";
import { EventBanner } from "@/components/EventBanner";
import { ScholarQuotes } from "@/components/ScholarQuotes";
import type { HomeSection } from "@/lib/types";

export function generateStaticParams() {
  return [{ locale: "fa" }, { locale: "ar" }, { locale: "en" }];
}

/**
 * ISR: the homepage is prerendered and served as a static file (with
 * Content-Length) instead of a per-request dynamic stream. Data (home
 * sections, settings, content surfaces) revalidates every 120 seconds, so
 * a CRM change appears on the site within ~2 minutes.
 */
export const revalidate = 120;

function hijriDateLabel(
  t: Awaited<ReturnType<typeof getTranslations>>,
  locale: string,
  month: number | null,
  day: number | null,
): string | null {
  if (!month || !day || month < 1 || month > 12) return null;
  const months = t.raw("events.months") as unknown;
  const name = Array.isArray(months) ? (months[month - 1] as string | undefined) : undefined;
  if (!name) return null;
  const template = t.raw("events.hijriDate") as string;
  const dayTag = locale === "ar" ? "ar-EG" : locale === "en" ? "en-US" : "fa-IR";
  let dayStr = String(day);
  try {
    dayStr = day.toLocaleString(dayTag);
  } catch {
    /* keep latin digits */
  }
  return template.split("{month}").join(name).split("{day}").join(dayStr);
}

/**
 * Homepage: React Server Component.
 * All 10 sections come from GET /api/v1/home/sections — rendered in `order`,
 * skipping `visible: false`. Phase-4 CMS surfaces are fetched in parallel:
 * announcements (placement=global), banners (placement=homepage, server
 * priority order), the active Islamic event (calendar/theme → events for
 * today's hijri date), and scholar quotes (placement=homepage). Each fetch
 * is non-throwing and its surface renders nothing when the API has no data.
 * If the API is unreachable we render a graceful, localized error state
 * (contract §15: no mock data, never fake sections).
 * Platform settings (`platform_settings`, fetched with 120s revalidation via
 * lib/settings.ts) drive: homepage slot composition (`home.sections`),
 * hero copy (`hero.<locale>`), particles and uploaded fonts (in the
 * layout). When the settings endpoint is missing, everything falls back
 * to today's behavior.
 * Client-side JS on this page: search autocomplete, sliders, announcement
 * dismissal, atmospheric canvas (all progressive enhancement —
 * content is server-rendered).
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "home" });
  const tContent = await getTranslations({ locale, namespace: "content" });
  const tArticles = await getTranslations({ locale, namespace: "articles" });

  let sections: HomeSection[] = [];
  let themeCss = "";
  let apiFailed = false;

  const [homeRes, announcements, banners, calTheme, quotes, siteConfig, fatwaRes, articlesRes] = await Promise.all([
    getHomeSections().then(
      (res) => ({ ok: true as const, res }),
      () => ({ ok: false as const }),
    ),
    getAnnouncements("global"),
    getBanners("homepage"),
    getCalendarTheme(),
    getScholarQuotes("homepage"),
    getSiteConfig(),
    // Homepage fatwa slider — latest published fatwas from the public
    // endpoint (never section JSON). Non-throwing: on failure the slider
    // renders the honest empty state.
    getFatwaListServer({
      locale: (["fa", "ar", "en"].includes(locale) ? locale : "fa"),
      sort: "newest",
      page: 1,
      perPage: 10,
    }).then(
      (res) => ({ ok: true as const, res }),
      () => ({ ok: false as const }),
    ),
    // Homepage articles slider — latest published articles from the
    // public endpoint (never section JSON, no seed.py section key).
    // Non-throwing: on failure the slider renders nothing.
    getArticleListServer({
      locale: (["fa", "ar", "en"].includes(locale) ? locale : "fa"),
      sort: "newest",
      page: 1,
      perPage: 10,
    }).then(
      (res) => ({ ok: true as const, res }),
      () => ({ ok: false as const }),
    ),
  ]);

  if (homeRes.ok) {
    sections = homeRes.res.sections;
    themeCss = themeCssText(homeRes.res.theme);
  } else {
    apiFailed = true;
    // eslint-disable-next-line no-console
    console.error("[web] home sections fetch failed");
  }

  // Settings-driven composition (issue #3): when the `home.sections` key is
  // present, slots render in settings order with the chosen variants;
  // otherwise today's behavior (API order + SPECS). Hero copy comes from
  // `hero.<locale>` with fallback to the API section copy.
  const loc = (["fa", "ar", "en"].includes(locale) ? locale : "fa") as Locale;
  const slots = siteConfig.homeSections;
  const heroOverride = siteConfig.hero[loc];
  const homeLabels = buildHomeLabels(t);
  // The `home.sections` key holds the slots BELOW the hero (per the seed);
  // the hero section itself always renders first, with the hero.<locale>
  // settings override applied.
  const heroSection = sections.find((s) => s.key === "hero" && s.visible !== false);

  const announcementViews = getAnnouncementViews(announcements, locale);

  // Active Islamic event: today's hijri date comes from calendar/theme;
  // prefer the themed event_id, fall back to the first event of the day.
  let activeEvent = null as ReturnType<typeof getEventView>;
  let hijriDate: string | null = null;
  if (calTheme?.hijri) {
    const { month, day } = calTheme.hijri;
    const events = await getIslamicEvents(month, day);
    const match =
      calTheme.event_id != null
        ? events.find((e) => String(e.id) === calTheme.event_id)
        : undefined;
    activeEvent = getEventView(match ?? events[0], locale);
    hijriDate = hijriDateLabel(tContent, locale, month, day);
  }

  const quoteViews = getScholarQuoteViews(quotes, locale);

  // Slider items mapped once for both homepage render paths.
  const fatwaSliderItems = fatwaRes.ok
    ? fatwaRes.res.items.map((it) => ({
        id: it.id,
        title: it.title,
        subtitle: it.description || null,
        author: it.authorName,
        category: it.category?.title ?? null,
        image: it.featuredImageUrl,
        href: `/${locale}/fatwa/${it.id}`,
      }))
    : [];

  // Recent-articles slider — rendered exactly once, immediately after
  // the community section in whichever render path is active (slots
  // order when home.sections is set, API order otherwise). It renders
  // nothing when there are no published articles. Previously this was
  // a fixed block after ALL sections; the user asked for it to follow
  // the community section like the fatwa slider does.
  const articlesSlider = (
    <ArticlesSlider
      locale={locale}
      items={articlesRes.ok ? articlesRes.res.items : []}
      title={tArticles("homeTitle")}
      showAllLabel={tArticles("showAll")}
    />
  );

  return (
    <>
      {themeCss ? <style>{themeCss}</style> : null}
      {apiFailed ? (
        <div className="error-state" role="alert">
          <h1>{t("errorTitle")}</h1>
          <p>{t("errorDescription")}</p>
          <a className="btn-secondary" href={`/${locale}`}>
            {t("errorRetry")}
          </a>
        </div>
      ) : (
        <>
          <AnnouncementsBar
            items={announcementViews.map((a) => ({ id: a.id, message: a.message }))}
            dismissLabel={tContent("announcements.dismiss")}
            listAria={tContent("announcements.listAria")}
          />
          <EventBanner
            event={activeEvent}
            locale={locale}
            ariaLabel={tContent("events.aria")}
            hijriDate={hijriDate}
          />
          <HomeBanners banners={banners} locale={locale} />
          {slots ? (
            <>
              {heroSection ? (
                <HomeSectionRenderer
                  section={heroSection}
                  locale={locale}
                  labels={homeLabels}
                  heroOverride={heroOverride}
                />
              ) : null}
              <ComposedSections
                sections={sections}
                slots={slots}
                locale={locale}
                labels={homeLabels}
                heroOverride={heroOverride}
                fatwaSliderItems={fatwaSliderItems}
                afterCommunity={articlesSlider}
              />
            </>
          ) : (
            <HomeSections
              sections={sections}
              locale={locale}
              labels={homeLabels}
              heroOverride={heroOverride}
              fatwaSliderItems={fatwaSliderItems}
              afterCommunity={articlesSlider}
            />
          )}
          <ScholarQuotes
            quotes={quoteViews}
            heading={tContent("quotes.heading")}
            ariaLabel={tContent("quotes.aria")}
          />
        </>
      )}
    </>
  );
}
