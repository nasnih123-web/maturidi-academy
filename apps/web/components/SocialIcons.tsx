/**
 * SocialIcons — built-in brand glyphs for the drawer's social row.
 *
 * The network set mirrors the API's SOCIAL_NETWORKS (platform setting
 * `site.social_links`): the CRM manages each network's URL, enabled flag
 * and order; the glyph itself is fixed here so the row always renders
 * on-brand. Unknown networks render nothing (the API validates the set,
 * so this is only a defensive fallback).
 */
import type { JSX } from 'react';

const PATHS: Record<string, JSX.Element> = {
  telegram: (
    <path d="M21.9 3.4c.3-1.2-.7-2.2-1.9-1.8L2.3 9.1c-1.2.4-1.2 2 .1 2.4l4.6 1.5 1.8 5.6c.3.9 1.4 1.2 2.1.5l2.5-2.4 4.9 3.6c.9.7 2.2.2 2.4-.9l1.2-16zM8.6 12.6l9.3-6.3c.2-.1.4.2.2.3l-7.8 7.4-.3 3-1.4-4.4z" />
  ),
  instagram: (
    <path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9-.1-1.3-.1-1.6-.1-4.8s0-3.6.1-4.8C2.4 4 4 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zm0 3.6a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.9 1.4 1.4 0 0 0 0-2.9z" />
  ),
  whatsapp: (
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5s.8 1.9.8 2c.1.1.1.3 0 .5-.3.6-.6.8-.4 1.1.7 1.2 1.6 2 2.7 2.6.3.2.5.1.7-.1l.9-1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.4 0 .1 0 .7-.2 1.2z" />
  ),
  youtube: (
    <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.5 12 4.5 12 4.5s-7 0-8.9.6A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.6 8.9.6 8.9.6s7 0 8.9-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.2zM9.8 15.5v-7l6 3.5-6 3.5z" />
  ),
  aparat: (
    <>
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M10 8.2v7.6c0 .6.7 1 1.2.7l6-3.8c.5-.3.5-1 0-1.3l-6-3.9c-.5-.3-1.2.1-1.2.7z" />
    </>
  ),
  eitaa: (
    <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5h-6.9a2.9 2.9 0 1 1 .8-2.9h6.1a9.5 9.5 0 0 0-9.5-6.6zm-2.6 9.5a2.6 2.6 0 0 1 2.6-2.6c1 0 1.9.6 2.3 1.4H9.6c.1.4-.2.8-.2 1.2z" />
  ),
  bale: (
    <path d="M12 2.5c5.2 0 9.5 4.3 9.5 9.5s-4.3 9.5-9.5 9.5c-1.1 0-2.2-.2-3.2-.6L3 22l1.2-4.1a9.5 9.5 0 0 1-.7-3.6C3.5 6.8 6.8 2.5 12 2.5zm-4.2 9.3a1.3 1.3 0 0 0 0 1.9l2.9 2.9a1.3 1.3 0 0 0 1.9 0l4.6-4.6a1.3 1.3 0 1 0-1.9-1.9l-3.7 3.7-2-2a1.3 1.3 0 0 0-1.8 0z" />
  ),
  x: (
    <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.8 2h6.4l4.4 5.9L18.9 2zm-1.1 18h1.7L7.4 3.9H5.6L17.8 20z" />
  ),
  facebook: (
    <path d="M13.5 21.5v-8h2.7l.4-3.1h-3.1V8.4c0-.9.3-1.5 1.6-1.5h1.6V4.1c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.4H7.8v3.1h2.7v8h3z" />
  ),
};

export function SocialIcon({ network }: { network: string }) {
  const glyph = PATHS[network];
  if (!glyph) return null;
  return (
    <svg viewBox="0 0 24 24" width="1.45rem" height="1.45rem" fill="currentColor" aria-hidden="true">
      {glyph}
    </svg>
  );
}
