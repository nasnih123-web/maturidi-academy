/**
 * Same-origin host for the quran-ws printed-page SVGs (step 6,
 * Tarteel-parity PR — defect 5).
 *
 * The reader used to fetch every page straight from
 * raw.githubusercontent.com, whose reachability from inside Iran is
 * unverified; a blocked CDN meant the (load-bearing) text fallback
 * for every page. This route serves the SAME files same-origin:
 * the browser only talks to this site, the server fetches upstream
 * once and the response carries a one-year immutable cache header,
 * so repeat views are served from the browser/edge cache.
 *
 * Strict allowlist — this is not an open proxy: the mushaf key must
 * be one of the five known keys, the kind svg|json, and the file a
 * 3-digit page (NNN.svg / NNN.json) or the surah index. Anything
 * else is a 400; an upstream failure is a 502 (the client then
 * falls back to the raw URL, then to the text page — see
 * lib/quran-svg-page.ts).
 */
import { SVG_MUSHAF_KEYS } from '@/lib/quran-svg-page';

export const dynamic = 'force-dynamic';

const RAW = 'https://raw.githubusercontent.com/quran-ws/quran-svg/main/mushafs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  if (!path || path.length !== 4) {
    return new Response('bad path', { status: 400 });
  }
  const [a, b, kind, file] = path;
  const mushaf = `${a}/${b}`;
  if (!(SVG_MUSHAF_KEYS as readonly string[]).includes(mushaf)) {
    return new Response('unknown mushaf', { status: 400 });
  }
  const fileOk =
    kind === 'svg'
      ? /^\d{3}\.svg$/.test(file)
      : kind === 'json'
        ? /^\d{3}\.json$/.test(file) || file === 'surah.json'
        : false;
  if (!fileOk) {
    return new Response('bad file', { status: 400 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${RAW}/${mushaf}/${kind}/${file}`);
  } catch {
    return new Response('upstream unreachable', { status: 502 });
  }
  if (!upstream.ok) {
    return new Response(`upstream ${upstream.status}`, { status: 502 });
  }
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type':
        kind === 'svg' ? 'image/svg+xml; charset=utf-8' : 'application/json',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
