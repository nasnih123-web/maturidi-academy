'use client';

/**
 * VideosSlider — homepage «ویدیوها» band (approved design): dark-green
 * band, gold «نمایش همهٔ ویدیوها» pill linking to /videos, and a
 * horizontal rail of the latest published videos. Items come from
 * GET /api/v1/videos via the page — never section JSON. Renders
 * nothing when there are no items (the caller also gates on the
 * `videos.home_enabled` CRM setting).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface VideoSliderItem {
  id: string;
  title: string;
  scholar: string | null;
  duration: string | null;
  image: string | null;
  kindLabel: string;
  inPlaylist: boolean;
  href: string;
}

function isRtl(el: HTMLElement): boolean {
  return getComputedStyle(el).direction === 'rtl';
}

export function VideosSlider({
  sectionId,
  title,
  subtitle,
  items,
  viewAllHref,
  viewAllLabel,
  playlistLabel,
  prevLabel,
  nextLabel,
}: {
  sectionId: string;
  title: string;
  subtitle?: string;
  items: VideoSliderItem[];
  viewAllHref: string;
  viewAllLabel: string;
  playlistLabel: string;
  prevLabel: string;
  nextLabel: string;
}): React.ReactElement | null {
  const trackRef = useRef<HTMLUListElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);

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

  const scrollToFrac = useCallback((frac: number) => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const clamped = Math.max(0, Math.min(1, frac));
    el.scrollTo({ left: (isRtl(el) ? -1 : 1) * clamped * max, behavior: 'smooth' });
    setPage(Math.round(clamped * Math.max(pages - 1, 0)));
  }, [pages]);

  if (items.length === 0) return null;

  return (
    <section className="vid-band" id={sectionId} aria-label={title}>
      <div className="vid-band-inner">
        <div className="vid-band-head">
          <div className="vid-band-title">
            <span className="vid-band-badge" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#06120e">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <Link className="vid-band-all" href={viewAllHref}>
            {viewAllLabel}
          </Link>
        </div>
        <ul className="vid-band-track" ref={trackRef}>
          {items.map((item) => (
            <li key={item.id} className="vid-band-slide">
              <Link href={item.href} className="vid-band-card">
                <span className="vid-thumb">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" loading="lazy" className="vid-thumb-img" />
                  ) : (
                    <span className="vid-thumb-fallback" aria-hidden="true">
                      {item.kindLabel}
                    </span>
                  )}
                  <span className="vid-thumb-play" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#e5c07b">
                      <path d="M8 5.5v13l11-6.5z" />
                    </svg>
                  </span>
                  {item.inPlaylist ? (
                    <span className="vid-thumb-pltag">{playlistLabel}</span>
                  ) : null}
                  {item.duration ? (
                    <span className="vid-thumb-dur" dir="ltr">
                      {item.duration}
                    </span>
                  ) : null}
                </span>
                <span className="vid-band-card-title">{item.title}</span>
                {item.scholar ? (
                  <span className="vid-band-card-meta">{item.scholar}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        {pages > 1 ? (
          <div className="vid-band-nav">
            <button
              type="button"
              className="vid-band-navbtn"
              aria-label={prevLabel}
              onClick={() => scrollToFrac((page - 1) / Math.max(pages - 1, 1))}
            >
              ‹
            </button>
            <span className="vid-band-dots" aria-hidden="true">
              {Array.from({ length: pages }).map((_, i) => (
                <span key={i} className={i === page ? 'vid-band-dot on' : 'vid-band-dot'} />
              ))}
            </span>
            <button
              type="button"
              className="vid-band-navbtn"
              aria-label={nextLabel}
              onClick={() => scrollToFrac((page + 1) / Math.max(pages - 1, 1))}
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
