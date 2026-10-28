"use client";

/**
 * Homepage "recent articles" slider — parity with the other homepage
 * sliders (fatwa etc.): shared `.section-head` title treatment (geometric
 * anchor, imperial h2, show-all CTA with directional arrow), RTL-aware
 * rail scrolling with the same `.slider-nav-btn` / `.slider-dot` controls
 * and behavior as the shared Slider primitive (scroll by ~one viewport,
 * snap, keyboard arrows, page dots below the rail).
 *
 * Layout matches the shared Slider primitive exactly: the header holds
 * only the title and the show-all link (space-between); the prev/next
 * buttons sit BELOW the rail, flanking the page dots. Cards are equal
 * height: each slide is a flex column and the card grows to fill it
 * (same effect as the fatwa slider's equal-height rule, without a
 * section-id-scoped CSS rule — this component owns its own section).
 * Renders nothing when there is nothing to show.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GEOMETRY_RENDERERS } from "@maturidi/design-tokens/geometry";
import type { ArticleItem } from "@/lib/articles";

const SLIDE_W = "clamp(15rem, 22vw, 19rem)";

function isRtl(el: HTMLElement): boolean {
  return getComputedStyle(el).direction === "rtl";
}

export function ArticlesSlider({
  locale,
  items,
  title,
  showAllLabel,
  sliderPrev,
  sliderNext,
}: {
  locale: string;
  items: ArticleItem[];
  title: string;
  showAllLabel: string;
  sliderPrev: string;
  sliderNext: string;
}): React.ReactElement | null {
  const trackRef = useRef<HTMLUListElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const anchor = GEOMETRY_RENDERERS.divider({ size: 170, color: "currentColor" });
  const ctaArrow = locale === "en" ? "→" : "←";

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setPages(max > 4 ? Math.ceil(max / Math.max(el.clientWidth, 1)) + 1 : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  /** Move to a normalized fraction (0..1) — direction-independent. */
  const scrollToFrac = useCallback((frac: number) => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const clamped = Math.max(0, Math.min(1, frac));
    el.scrollTo({ left: (isRtl(el) ? -1 : 1) * clamped * max, behavior: "smooth" });
  }, []);

  const scrollBy = useCallback((dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const step = el.clientWidth * 0.9;
    el.scrollBy({ left: (isRtl(el) ? -1 : 1) * dir * step, behavior: "smooth" });
  }, []);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const frac = max > 0 ? Math.abs(el.scrollLeft) / max : 0;
    setPage(Math.round(frac * Math.max(1, pages - 1)));
  }, [pages]);

  if (items.length === 0) return null;

  return (
    <section className="home-section" aria-label={title}>
      <div className="section-head">
        <span className="section-anchor" aria-hidden dangerouslySetInnerHTML={{ __html: anchor }} />
        <div>
          <h2>{title}</h2>
        </div>
        <div
          style={{
            marginInlineStart: "auto",
            display: "flex",
            alignItems: "center",
            alignSelf: "center",
          }}
        >
          <Link href={`/${locale}/articles`} className="section-cta">
            {showAllLabel} {ctaArrow}
          </Link>
        </div>
      </div>
      <div role="region" aria-roledescription="carousel" aria-label={title}>
        <ul
          ref={trackRef}
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={(e) => {
            const el = trackRef.current;
            const rtl = el ? isRtl(el) : false;
            const forwardKey = rtl ? "ArrowLeft" : "ArrowRight";
            const backKey = rtl ? "ArrowRight" : "ArrowLeft";
            if (e.key === forwardKey) {
              e.preventDefault();
              scrollBy(1);
            }
            if (e.key === backKey) {
              e.preventDefault();
              scrollBy(-1);
            }
          }}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <li key={item.slug} className="flex shrink-0 snap-start flex-col" style={{ width: SLIDE_W, maxWidth: "85vw" }}>
              <article className="ftw-card flex-1">
                <Link
                  href={`/${locale}/articles/${encodeURIComponent(item.slug)}`}
                  className="ftw-card-link"
                >
                  {item.featuredImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.featuredImageUrl} alt="" className="ftw-card-img" loading="lazy" />
                  ) : (
                    <div className="ftw-card-img ftw-card-img-empty" aria-hidden />
                  )}
                  <h3>{item.title}</h3>
                </Link>
                {item.category ? <p className="ftw-card-cat">{item.category.title}</p> : null}
              </article>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-center gap-4">
          <button type="button" onClick={() => scrollBy(-1)} aria-label={sliderPrev} className="slider-nav-btn">
            ‹
          </button>
          <span className="slider-dots">
            {Array.from({ length: Math.min(pages, 8) }).map((_, i) => (
              <button
                key={i}
                type="button"
                className={`slider-dot ${i === page ? "on" : ""}`}
                aria-label={`${sliderNext} ${i + 1}`}
                aria-current={i === page ? "true" : undefined}
                onClick={() => scrollToFrac(pages > 1 ? i / (pages - 1) : 0)}
              />
            ))}
          </span>
          <button type="button" onClick={() => scrollBy(1)} aria-label={sliderNext} className="slider-nav-btn">
            ›
          </button>
        </div>
      </div>
    </section>
  );
}
