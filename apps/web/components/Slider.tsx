"use client";

/** Slider primitive — RTL/LTR-آگاه، کیبورد، نقاط، autoplay با pause، reduced-motion (§۲۴).
 *  نکتهٔ RTL: در Chrome/Firefox مدرن scrollLeft در حالت راست‌به‌چپ منفی می‌شود؛
 *  همهٔ محاسبات با Math.abs + ضریب جهت نرمال می‌شوند تا در fa/ar و en یکسان کار کند. */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface SliderConfig {
  slideWidth: string;
  autoplayMs?: number;
  labels: { prev: string; next: string; region: string };
  className?: string;
}

function isRtl(el: HTMLElement): boolean {
  return getComputedStyle(el).direction === "rtl";
}

export function Slider({
  config,
  children,
}: {
  config: SliderConfig;
  children: React.ReactNode[];
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
  }, [children]);

  /** جابه‌جایی به یک فاصلهٔ نرمال‌شده (۰..۱) — مستقل از جهت */
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

  useEffect(() => {
    if (!config.autoplayMs || paused || reducedMotion) return;
    const id = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      const max = el.scrollWidth - el.clientWidth;
      const pos = Math.abs(el.scrollLeft);
      const target = pos + el.clientWidth >= max - 4 ? 0 : pos + el.clientWidth;
      scrollToFrac(max > 0 ? target / max : 0);
    }, config.autoplayMs);
    return () => clearInterval(id);
  }, [config.autoplayMs, paused, reducedMotion, children, scrollToFrac]);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const frac = max > 0 ? Math.abs(el.scrollLeft) / max : 0;
    setPage(Math.round(frac * Math.max(1, pages - 1)));
  }, [pages]);

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={config.labels.region}
      className="relative w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <ul
        ref={trackRef}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={(e) => {
          const el = trackRef.current;
          const rtl = el ? isRtl(el) : false;
          const forwardKey = rtl ? "ArrowLeft" : "ArrowRight";
          const backKey = rtl ? "ArrowRight" : "ArrowLeft";
          if (e.key === forwardKey) { e.preventDefault(); scrollBy(1); }
          if (e.key === backKey) { e.preventDefault(); scrollBy(-1); }
        }}
        className={cn(
          "flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          config.className,
        )}
        style={{ ["--slide-w" as string]: config.slideWidth }}
      >
        {children.map((child, i) => (
          <li key={i} className="shrink-0 snap-start" style={{ width: config.slideWidth, maxWidth: "85vw" }}>
            {child}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-center gap-4">
        <button type="button" onClick={() => scrollBy(-1)} aria-label={config.labels.prev} className="slider-nav-btn">‹</button>
        <span className="slider-dots">
          {Array.from({ length: Math.min(pages, 8) }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`slider-dot ${i === page ? "on" : ""}`}
              aria-label={`${config.labels.next} ${i + 1}`}
              aria-current={i === page ? "true" : undefined}
              onClick={() => scrollToFrac(pages > 1 ? i / (pages - 1) : 0)}
            />
          ))}
        </span>
        <button type="button" onClick={() => scrollBy(1)} aria-label={config.labels.next} className="slider-nav-btn">›</button>
      </div>
    </div>
  );
}
