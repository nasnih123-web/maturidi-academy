/**
 * Voice assistant API client (Phase 12 — web track).
 *
 * Thin plumbing over the backend contract `POST /api/v1/voice/ask`
 * (multipart `audio` in → `{text, audio_url, audio_kind, intent, lang,
 * citations?}`). The browser never talks to the API directly: it POSTs to
 * the same-origin proxy `/api/voice/ask` (route handler), which forwards to
 * the backend — no CORS, no API_URL leaked to the client (same pattern as
 * `/api/search`, docs/performance-budget.md).
 *
 * CONTRACT (verified against the landed backend — docs/adr/0009 +
 * apps/api/app/modules/voice/schemas.py::AskOut, router.py::ask_voice):
 *   request:  multipart/form-data { file: <audio blob>, lang: "fa"|"ar" }
 *   response: { intent: "quran"|"fatwa"|"general", lang: "fa"|"ar",
 *               text, transcript?, audio_kind: "recitation"|"tts"|"none",
 *               audio_url?, audio_base64?, audio_mime?, notice?,
 *               ayah?, citations: [{chunk_id, excerpt, source_citation?}],
 *               session_id }
 * Notes: TTS audio arrives as base64 (ADR-0009 §4 — never stored server-side);
 * this client converts it to a data: URL for playback. `notice` carries
 * honest degradation codes (e.g. "tts_unavailable"). Recitation audio is a
 * real recitation URL (never synthesized — ADR-0009 §3).
 * This file is the single place the wire shape is normalized; per ADR-001
 * no component touches fetch directly.
 */
import { getAccessToken } from './auth-client';

export type VoiceAudioKind = 'recitation' | 'tts' | 'none';

export interface VoiceCitation {
  chunkId: string | null;
  sourceCitation: string;
  excerpt: string;
}

export type VoiceIntent = 'quran' | 'fatwa' | 'general';

export interface VoiceAyahRef {
  surah: number;
  ayah: number;
  surahLabel: string;
}

export interface VoiceAskResponse {
  /** Assistant answer text. */
  text: string;
  /** Transcribed user utterance (`AskOut.transcript`) for the user bubble. */
  query: string;
  /**
   * Playable audio URL. For `audio_kind: "recitation"` this is the real
   * recitation URL (`audio_url`); for `"tts"` it is a data: URL built from
   * `audio_base64`+`audio_mime` (ADR-0009 §4); null for `"none"`.
   */
  audioUrl: string | null;
  audioKind: VoiceAudioKind;
  intent: VoiceIntent | string;
  lang: 'fa' | 'ar';
  /** Honest degradation code, e.g. "tts_unavailable" (ADR-0009 §4). */
  notice: string | null;
  ayah: VoiceAyahRef | null;
  citations: VoiceCitation[];
}

export class VoiceApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = 'VoiceApiError';
    this.status = status;
    this.code = code;
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asAudioKind(v: unknown): VoiceAudioKind {
  return v === 'recitation' || v === 'tts' ? v : 'none';
}

function asCitation(c: unknown): VoiceCitation | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const source = asString(o.source_citation ?? o.sourceCitation);
  if (!source) return null;
  const chunkId =
    typeof o.chunk_id === 'string' || typeof o.chunkId === 'string'
      ? (o.chunk_id as string) ?? (o.chunkId as string)
      : null;
  return {
    chunkId: typeof chunkId === 'string' ? chunkId : null,
    sourceCitation: source,
    excerpt: asString(o.excerpt),
  };
}

/** Normalize the backend wire shape into VoiceAskResponse (tolerant reader). */
export function asVoiceAskResponse(body: unknown, locale: 'fa' | 'ar'): VoiceAskResponse {
  const o = (body ?? {}) as Record<string, unknown>;
  const langRaw = asString(o.lang);
  const citations = Array.isArray(o.citations)
    ? o.citations.map(asCitation).filter((c): c is VoiceCitation => c !== null)
    : [];
  // TTS audio arrives as base64 (ADR-0009 §4) — convert to a data: URL.
  const audioBase64 = typeof o.audio_base64 === 'string' ? o.audio_base64 : null;
  const audioMime = typeof o.audio_mime === 'string' ? o.audio_mime : 'audio/mpeg';
  const audioUrl =
    typeof o.audio_url === 'string'
      ? o.audio_url
      : audioBase64
        ? `data:${audioMime};base64,${audioBase64}`
        : null;
  const ayahRaw = (o.ayah ?? null) as Record<string, unknown> | null;
  return {
    text: asString(o.text ?? o.answer),
    query: asString(o.transcript ?? o.query),
    audioUrl,
    audioKind: asAudioKind(o.audio_kind ?? o.audioKind),
    intent: asString(o.intent),
    lang: langRaw === 'ar' || langRaw === 'fa' ? langRaw : locale,
    notice: typeof o.notice === 'string' ? o.notice : null,
    ayah:
      ayahRaw && typeof ayahRaw.surah === 'number' && typeof ayahRaw.ayah === 'number'
        ? {
            surah: ayahRaw.surah,
            ayah: ayahRaw.ayah,
            surahLabel: asString(ayahRaw.surah_label),
          }
        : null,
    citations,
  };
}

async function throwForStatus(res: Response): Promise<never> {
  let code: string | null = null;
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = typeof j?.error?.code === 'string' ? j.error.code : null;
    detail = typeof j?.error?.message === 'string' ? j.error.message : '';
  } catch {
    /* non-JSON error body */
  }
  throw new VoiceApiError(detail || `POST /api/voice/ask → ${res.status}`, res.status, code);
}

/**
 * Send a recorded audio blob to the voice assistant. Throws VoiceApiError
 * on failure; rethrows DOMException AbortError on cancellation so the
 * caller (hook) can distinguish cancel from failure.
 */
export async function askVoice(
  audio: Blob,
  opts: { locale: 'fa' | 'ar'; filename?: string; signal?: AbortSignal } = { locale: 'fa' },
): Promise<VoiceAskResponse> {
  const form = new FormData();
  // Field name "file" matches the backend contract (router.py::ask_voice).
  form.append('file', audio, opts.filename ?? `voice-${Date.now()}.webm`);
  form.append('lang', opts.locale);

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    // Same-origin proxy (app/api/voice/ask/route.ts) — never the API host.
    res = await fetch('/api/voice/ask', {
      method: 'POST',
      headers,
      body: form,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new VoiceApiError('Voice service unreachable', 0);
  }
  if (!res.ok) await throwForStatus(res);
  const body = (await res.json()) as unknown;
  return asVoiceAskResponse(body, opts.locale);
}

/** Browser capability check — MediaRecorder + getUserMedia. Pure, SSR-safe. */
export function isVoiceCaptureSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return (
    typeof window.MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/** Pick the best MediaRecorder mime type the browser accepts. Pure. */
export function pickAudioMimeType(): string | undefined {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const mime of candidates) {
    try {
      if (window.MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}
