import { safeHref } from "@/lib/section-data";
import type { HomeSection } from "@/lib/types";
import type { HomeSectionsLabels } from "./HomeSections";

/** Context for `section-*` embeds: live homepage sections + their labels. */
export interface SectionEmbedContext {
  sections: HomeSection[];
  locale: string;
  labels: HomeSectionsLabels;
}

export interface CmsBlock {
  type: string;
  /** visual-editor convention (spec): payload nested under `props` … */
  props?: Record<string, unknown>;
  /** …or the flat convention the seeds/editor actually emit: {type, text:{fa,ar,en}, …} */
  [key: string]: unknown;
}

export type CmsLang = "fa" | "ar" | "en";

function localized(value: unknown, lang: CmsLang, fallback = "fa"): string {
  if (value && typeof value === "object") {
    const map = value as Record<string, string>;
    return map[lang] ?? map[fallback] ?? "";
  }
  return typeof value === "string" ? value : "";
}

/** Merge the two block conventions into one payload (flat keys win). */
function payloadOf(block: CmsBlock): Record<string, unknown> {
  const { type: _t, props, ...flat } = block;
  return { ...(props ?? {}), ...flat };
}

/**
 * رندر بلاک‌های صفحهٔ CMS — ویجت‌های آماده (فاز ۴، رجیستری `apps/crm`):
 * - عمومی: hero (با theme)، rich-text، image، quote، cta-banner، divider
 * - سطرهای صفحهٔ اول فاز ۳: section-hero، section-latest_fatwas،
 *   section-quran_of_day، section-suggested_lessons، section-fresh_library،
 *   section-community، section-donation_banner (رندر زنده از API خانه)
 * - سازگاری: heading/paragraph (قرارداد flat سیدها)، text/cta (spec قدیم)،
 *   rich-text/events-strip (فاز ۳)
 * بلاک ناشناخته با console.warn نادیده گرفته می‌شود — هرگز کرش نمی‌کند.
 */
export function CmsBlocks({
  blocks,
  lang = "fa",
  sectionEmbed,
}: {
  blocks: CmsBlock[];
  lang?: CmsLang;
  /**
   * Context for `section-*` embeds (live homepage sections). Supplied by
   * the CMS page route only — pages without it skip embeds gracefully,
   * and never pay for the homepage-section bundle (perf budget ≤100KB).
   */
  sectionEmbed?: SectionEmbedContext | null;
}) {
  if (!Array.isArray(blocks)) return null;
  return (
    <div className="cms-blocks">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} lang={lang} sectionEmbed={sectionEmbed} />
      ))}
    </div>
  );
}

/**
 * Async server component: the homepage-section bundle is code-split via
 * native `await import()` and loads only when a page actually embeds a
 * section — never in the route's initial JS.
 */
async function SectionEmbedBlock({
  sectionKey,
  ctx,
}: {
  sectionKey: string;
  ctx: SectionEmbedContext;
}) {
  const { SectionEmbed } = await import("./SectionEmbed");
  return (
    <SectionEmbed
      sectionKey={sectionKey}
      sections={ctx.sections}
      locale={ctx.locale}
      labels={ctx.labels}
    />
  );
}

function BlockRenderer({
  block,
  lang,
  sectionEmbed,
}: {
  block: CmsBlock;
  lang: CmsLang;
  sectionEmbed?: SectionEmbedContext | null;
}) {
  if (!block || typeof block.type !== "string") {
    // eslint-disable-next-line no-console
    console.warn("[cms] block without a type skipped");
    return null;
  }
  // Homepage-row embeds: section-{key} → live section from the home API.
  if (block.type.startsWith("section-")) {
    const payload = payloadOf(block);
    const key =
      (typeof payload.section_key === "string" && payload.section_key) ||
      block.type.slice("section-".length);
    if (!sectionEmbed) {
      // eslint-disable-next-line no-console
      console.warn(`[cms] section embed "${key}" skipped: no section context`);
      return null;
    }
    return <SectionEmbedBlock sectionKey={key} ctx={sectionEmbed} />;
  }
  const payload = payloadOf(block);
  switch (block.type) {
    case "heading":
      return <HeadingBlock payload={payload} lang={lang} />;
    case "paragraph":
      return <ParagraphBlock payload={payload} lang={lang} />;
    case "hero":
      return <HeroBlock payload={payload} lang={lang} />;
    case "text":
      return <TextBlock payload={payload} lang={lang} />;
    case "image":
      return <ImageBlock payload={payload} lang={lang} />;
    case "quote":
      return <QuoteBlock payload={payload} lang={lang} />;
    case "cta":
      return <CtaBlock payload={payload} lang={lang} />;
    case "cta-banner":
      return <CtaBannerBlock payload={payload} lang={lang} />;
    case "divider":
      return <hr className="cms-divider" />;
    // legacy block types from the phase-3 port
    case "rich-text":
      return <RichText payload={payload} lang={lang} />;
    case "events-strip":
      return <EventsStrip payload={payload} />;
    default:
      // eslint-disable-next-line no-console
      console.warn(`[cms] unknown block type "${block.type}" skipped`);
      return null;
  }
}

type P = { payload: Record<string, unknown>; lang: CmsLang };

function textOf(payload: Record<string, unknown>, lang: CmsLang, keys: string[]): string {
  for (const k of keys) {
    const v = localized(payload[k], lang);
    if (v) return v;
  }
  return "";
}

function HeadingBlock({ payload, lang }: P) {
  const text = textOf(payload, lang, ["text", "text_l10n", "heading", "heading_l10n"]);
  if (!text) return null;
  return <h2 className="cms-heading">{text}</h2>;
}

function ParagraphBlock({ payload, lang }: P) {
  const text = textOf(payload, lang, ["text", "text_l10n", "body", "body_l10n"]);
  if (!text) return null;
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="cms-paragraph">
          {p}
        </p>
      ))}
    </>
  );
}

/** Theme allowlist mirrors the CRM registry select options (blockRegistry.ts). */
const HERO_THEMES = ["default", "ramadan", "muharram", "eid-fitr", "eid-adha", "mawlid"] as const;

function HeroBlock({ payload, lang }: P) {
  const heading = textOf(payload, lang, ["heading", "heading_l10n", "text", "text_l10n"]);
  const body = textOf(payload, lang, ["sub", "sub_l10n", "body", "body_l10n"]);
  const image = safeHref(textOf(payload, lang, ["image", "image_l10n", "url", "src"]));
  const ctaText = textOf(payload, lang, ["cta_label", "cta_label_l10n", "cta_text", "cta_text_l10n"]);
  const ctaUrl = safeHref(textOf(payload, lang, ["cta_link", "cta_url", "url"]));
  const theme =
    typeof payload.theme === "string" &&
    (HERO_THEMES as readonly string[]).includes(payload.theme)
      ? payload.theme
      : "default";
  if (!heading && !body && !image) return null;
  return (
    <section className="cms-hero" data-theme={theme}>
      <div className="cms-hero-body">
        {heading ? <h2>{heading}</h2> : null}
        {body ? <p>{body}</p> : null}
        {ctaText && ctaUrl ? (
          <a className="cms-cta-btn" href={ctaUrl}>
            {ctaText}
          </a>
        ) : null}
      </div>
      {image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={image} alt={heading || ""} className="cms-hero-image" loading="lazy" />
      ) : null}
    </section>
  );
}

function TextBlock({ payload, lang }: P) {
  const heading = textOf(payload, lang, ["heading", "heading_l10n"]);
  const body = textOf(payload, lang, ["body", "body_l10n", "text", "text_l10n"]);
  if (!heading && !body) return null;
  const paragraphs = body
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <section className="cms-text">
      {heading ? <h2>{heading}</h2> : null}
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </section>
  );
}

function ImageBlock({ payload, lang }: P) {
  const url = safeHref(textOf(payload, lang, ["url", "src", "image", "image_l10n"]));
  if (!url) return null;
  const alt = textOf(payload, lang, ["alt", "alt_l10n"]);
  const caption = textOf(payload, lang, ["caption", "caption_l10n"]);
  return (
    <figure className="cms-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

function QuoteBlock({ payload, lang }: P) {
  const text = textOf(payload, lang, ["text", "text_l10n"]);
  const author = textOf(payload, lang, ["author", "author_l10n"]);
  if (!text) return null;
  return (
    <figure className="cms-quote">
      <blockquote>{text}</blockquote>
      {author ? <figcaption>— {author}</figcaption> : null}
    </figure>
  );
}

function CtaBlock({ payload, lang }: P) {
  const text = textOf(payload, lang, ["text", "text_l10n", "label", "label_l10n"]);
  const url = safeHref(textOf(payload, lang, ["url", "href"]));
  if (!text || !url) return null;
  return (
    <div className="cms-cta">
      <a className="cms-cta-btn" href={url}>
        {text}
      </a>
    </div>
  );
}

function CtaBannerBlock({ payload, lang }: P) {
  const title = textOf(payload, lang, ["title", "title_l10n"]);
  const body = textOf(payload, lang, ["body", "body_l10n"]);
  const ctaLabel = textOf(payload, lang, ["cta_label", "cta_label_l10n"]);
  const ctaLink = safeHref(textOf(payload, lang, ["cta_link"]));
  if (!title && !body) return null;
  return (
    <section className="cms-cta-banner" aria-label={title || undefined}>
      <div className="cms-cta-banner-body">
        {title ? <h2>{title}</h2> : null}
        {body ? <p>{body}</p> : null}
      </div>
      {ctaLabel && ctaLink ? (
        <a className="cms-cta-btn" href={ctaLink}>
          {ctaLabel}
        </a>
      ) : null}
    </section>
  );
}

function RichText({ payload, lang }: P) {
  const heading = textOf(payload, lang, ["heading", "heading_l10n"]);
  const body = textOf(payload, lang, ["body", "body_l10n"]);
  return (
    <section className="cms-rich">
      {heading ? <h2>{heading}</h2> : null}
      {body ? <p>{body}</p> : null}
    </section>
  );
}

function EventsStrip({ payload }: { payload: Record<string, unknown> }) {
  const events = Array.isArray(payload.events) ? (payload.events as { name?: string; date?: string }[]) : [];
  if (!events.length) return null;
  return (
    <section className="cms-events">
      {events.map((e, i) => (
        <div key={i} className="cms-event">
          <span className="cms-event-name">{e.name}</span>
          {e.date ? <span className="cms-event-date">{e.date}</span> : null}
        </div>
      ))}
    </section>
  );
}
