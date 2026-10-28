/**
 * Regular-video embed URLs — the same host allowlist the article body
 * uses (YouTube / Vimeo / Aparat). Anything else yields null and is never
 * rendered as an iframe. Kept as a lib (not imported from ArticleBody)
 * so the globe panel and the place detail page share it without pulling
 * in a component.
 */
export function videoEmbedUrl(src: string): string | null {
  let u: URL;
  try {
    u = new URL(src.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    return null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const v = u.searchParams.get('v');
    if (u.pathname.startsWith('/embed/')) {
      const id = u.pathname.replace('/embed/', '').split('/')[0];
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.replace('/shorts/', '').split('/')[0];
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
    return null;
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    return null;
  }
  if (host === 'aparat.com' || host.endsWith('.aparat.com')) {
    const m = u.pathname.match(/\/v\/([A-Za-z0-9]+)/);
    if (m) return `https://www.aparat.com/video/video/embed/videohash/${m[1]}/vt/frame`;
    return null;
  }
  return null;
}
