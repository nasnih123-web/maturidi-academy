import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';

/**
 * Same-origin proxy for the Phase 12 voice assistant:
 * POST /api/voice/ask (multipart `file` + `lang`) → {API_URL}/api/v1/voice/ask.
 *
 * Keeps the browser on the same origin (the API has no CORS policy) and
 * keeps API_URL server-side only — same pattern as /api/search. Thin
 * plumbing: forwards the multipart body and the Authorization header
 * untouched, streams the backend JSON back. No business logic.
 *
 * Field names match the backend contract exactly
 * (apps/api/app/modules/voice/router.py::ask_voice): `file`, `lang`.
 */

export const dynamic = 'force-dynamic';

/** Max voice upload: 25 MB (a few minutes of Opus audio). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'expected multipart/form-data' } },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: { code: 'missing_file', message: 'multipart field "file" is required' } },
      { status: 422 },
    );
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: { code: 'audio_too_large', message: 'audio exceeds 25 MB' } },
      { status: 413 },
    );
  }

  const lang = form.get('lang');
  if (lang !== null && lang !== 'fa' && lang !== 'ar') {
    return NextResponse.json(
      { error: { code: 'invalid_lang', message: 'lang must be "fa" or "ar"' } },
      { status: 422 },
    );
  }

  const target = `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/voice/ask`;
  const upstream = new FormData();
  upstream.append('file', file, file.name || 'voice.webm');
  if (typeof lang === 'string') upstream.append('lang', lang);

  const headers: Record<string, string> = { Accept: 'application/json' };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;

  let res: Response;
  try {
    res = await fetch(target, { method: 'POST', headers, body: upstream });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'upstream_unreachable',
          message: `voice API unreachable: ${err instanceof Error ? err.message : String(err)}`,
        },
      },
      { status: 502 },
    );
  }

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}
