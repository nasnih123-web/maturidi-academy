"use client";

/**
 * SiteHeader — imperial glass header: brand, primary nav (CMS-driven with
 * nested submenus), header search, language dropdown, theme toggle, mobile
 * drawer. Pure presentation — nav entries and every user-visible string
 * arrive as props.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavEntryFinal } from "@/lib/section-data";

export interface NavEntry {
  href: string;
  label: string;
  external?: boolean;
  children?: NavEntryFinal[];
}

export interface HeaderLabels {
  skip: string;
  brandName: string;
  brandSub: string;
  navAria: string;
  mobileNavAria: string;
  searchPlaceholder: string;
  searchAria: string;
  langAria: string;
  langNames: Record<string, string>;
  menuAria: string;
  closeAria: string;
  submenuAria: string;
  /** e.g. "Open submenu for {label}" — {label} is substituted client-side */
  submenuExpandTemplate: string;
}

const LOCALES = ["fa", "ar", "en"] as const;

function NavLink({
  entry,
  isActive,
}: {
  entry: NavEntry;
  isActive: (href: string) => boolean;
}) {
  const active = isActive(entry.href);
  return entry.external ? (
    <a href={entry.href} aria-current={active ? "page" : undefined} target="_blank" rel="noopener noreferrer">
      {entry.label}
    </a>
  ) : (
    <Link href={entry.href} aria-current={active ? "page" : undefined}>
      {entry.label}
    </Link>
  );
}

function DesktopNavItem({
  entry,
  isActive,
  submenuAria,
  expandLabel,
}: {
  entry: NavEntry;
  isActive: (href: string) => boolean;
  submenuAria: string;
  expandLabel: (label: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const kids = entry.children && entry.children.length > 0 ? entry.children : null;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!kids) {
    return (
      <li className="nav-item">
        <NavLink entry={entry} isActive={isActive} />
      </li>
    );
  }

  return (
    <li className="nav-item nav-has-children" ref={ref}>
      <NavLink entry={{ ...entry, children: [] }} isActive={isActive} />
      <button
        type="button"
        className="nav-submenu-toggle"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={expandLabel(entry.label)}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {kids && (
        <ul className="nav-submenu" aria-label={submenuAria} hidden={!open}>
          {kids.map((k) => (
            <li key={k.href}>
              <NavLink entry={k} isActive={isActive} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SiteHeader({
  locale,
  labels,
  nav,
}: {
  locale: string;
  labels: HeaderLabels;
  nav: NavEntry[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setLangOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === `/${locale}`) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const swapLocaleHref = (target: string) => (pathname || `/${locale}`).replace(`/${locale}`, `/${target}`);

  return (
    <>
      <header className="site-header">
        <a href="#main-content" className="skip-link">
          {labels.skip}
        </a>
        <div className="header-inner">
          <Link href={`/${locale}`} className="brand" aria-label={labels.brandName}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="" className="brand-mark" />
            <span>
              {labels.brandName}
              <span className="brand-sub">{labels.brandSub}</span>
            </span>
          </Link>

          <nav className="primary-nav" aria-label={labels.navAria}>
            <ul className="nav-list">
              {nav.map((n) => (
                <DesktopNavItem
                  key={n.href}
                  entry={n}
                  isActive={isActive}
                  submenuAria={labels.submenuAria}
                  expandLabel={(label) => labels.submenuExpandTemplate.split("{label}").join(label)}
                />
              ))}
            </ul>
          </nav>

          <div className="header-actions">
            <form className="header-search" action={`/${locale}/search`} role="search">
              <input type="search" name="q" placeholder={labels.searchPlaceholder} aria-label={labels.searchAria} />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </form>

            <div className="lang-dd" ref={langRef}>
              <button
                className="icon-btn lang-btn"
                onClick={() => setLangOpen(!langOpen)}
                aria-expanded={langOpen}
                aria-haspopup="listbox"
                aria-label={labels.langAria}
              >
                {labels.langNames[locale] ?? locale}
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {langOpen && (
                <ul className="lang-menu" role="listbox" aria-label={labels.langAria}>
                  {LOCALES.map((loc) => (
                    <li key={loc} role="option" aria-selected={loc === locale}>
                      <Link href={swapLocaleHref(loc)} className={loc === locale ? "on" : ""} onClick={() => setLangOpen(false)}>
                        {labels.langNames[loc] ?? loc}
                        {loc === locale && <span aria-hidden>✓</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              className="icon-btn mobile-only"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls="nav-drawer"
              aria-label={labels.menuAria}
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div id="nav-drawer" className="nav-drawer" role="dialog" aria-modal="true" aria-label={labels.mobileNavAria}>
          <div className="header-inner">
            <span className="brand">{labels.brandName}</span>
            <span className="grow" />
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label={labels.closeAria}>
              ✕
            </button>
          </div>
          <nav aria-label={labels.mobileNavAria}>
            <ul className="nav-drawer-list">
              {nav.map((n) => (
                <li key={n.href} className="nav-drawer-item">
                  <NavLink entry={{ ...n, children: [] }} isActive={isActive} />
                  {n.children && n.children.length > 0 ? (
                    <ul className="nav-drawer-sub">
                      {n.children.map((k) => (
                        <li key={k.href}>
                          <NavLink entry={k} isActive={isActive} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
