import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';

/**
 * Same-origin proxy for global search: GET /api/search?q=&type=&limit=
 * → {API_URL}/api/v1/search. Keeps the browser on the same origin (the API
 * has no CORS policy) and keeps API_URL server-side only. Thin plumbing —
 * no business logic; validation mirrors the backend contract (q 1–200 chars,
 * limit 1–50).
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get('q') ?? '').trim();
  const type = params.get('type') ?? undefined;
  const limit = params.get('limit') ?? undefined;

  if (!q || q.length > 200) {
    return NextResponse.json(
      { error: { code: 'invalid_query', message: 'q must be 1–200 characters' } },
      { status: 422 },
    );
  }
  if (limit !== undefined && !/^\d+$/.test(limit)) {
    return NextResponse.json(
      { error: { code: 'invalid_limit', message: 'limit must be a positive integer' } },
      { status: 422 },
    );
  }

  const target = new URL(`${API_BASE_URL.replace(/\/+$/, '')}/api/v1/search`);
  target.searchParams.set('q', q);
  if (type) target.searchParams.set('type', type);
  if (limit) target.searchParams.set('limit', limit);

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: { Accept: 'application/json' } });
  } catch {
    return NextResponse.json(
      { error: { code: 'search_unavailable', message: 'Search backend unreachable' } },
      { status: 502 },
    );
  }
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
