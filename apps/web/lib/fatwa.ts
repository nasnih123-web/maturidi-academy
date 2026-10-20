/**
 * Fatwa domain client (Phase 6 — web track).
 *
 * Typed client for the AI fatwa RAG API. ALL fetch logic for
 * /api/v1/fatwa/* and /api/v1/verify lives here or in lib/verify.ts —
 * components and hooks never call fetch directly (ADR-001).
 *
 * Wire contract (source of truth: backend track, apps/api/app/modules/fatwa):
 * - POST /api/v1/fatwa/ask {question, session_id?, stream?}
 *     → {answer, citations:[{chunk_id, source_citation, excerpt}], session_id,
 *        status: ok|llm_unavailable|idk, usage}
 *   with stream=true the response is an SSE stream; see streamFatwa.
 * - GET  /api/v1/fatwa/categories → {items:[{id,title,description}]}
 * - GET  /api/v1/fatwa/compare/{topic_id}
 *     → {topic, positions:[{madhab, position_text, evidence_refs}]}
 * - POST /api/v1/fatwa/quiz/generate {count?, category?}
 *     → {attempt_id, questions:[{id, question_text, options[]}]} (no answers)
 * - POST /api/v1/fatwa/quiz/submit {attempt_id, answers}
 *     → {score, total, review:[{question_id, correct, explanation_citation}]}
 *
 * Base URL: NEXT_PUBLIC_API_URL (browser-safe) falling back to localhost.
 */

import { apiBaseUrl } from './api-base';
export type FatwaStatus = 'ok' | 'llm_unavailable' | 'idk';

/** Backend status wire values: answered|llm_unavailable|no_sources. */
type FatwaStatusWire = 'answered' | 'llm_unavailable' | 'no_sources';

export interface Citation {
  chunk_id: string;
  /** Localized rendering of the backend's source_citation dict. */
  source_citation: string;
  excerpt: string;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
  session_id: string | null;
  status: FatwaStatus;
  /** Backend-provided AI-assistant label (ai_label) — shown under the answer. */
  aiLabel: string | null;
  usage: Usage | null;
}

export interface FatwaCategory {
  id: string;
  title: string;
  description: string;
}

export interface MadhabPosition {
  madhab: string;
  position_text: string;
  evidence_refs: string[];
}

export interface MadhabComparison {
  topic: string;
  description: string;
  positions: MadhabPosition[];
}

export interface QuizQuestionWire {
  id: string;
  question_text: string;
  options: string[];
  /** Localized source citation backing the question (for the review step). */
  source_citation: string;
}

export interface QuizGenerateResult {
  attempt_id: string;
  questions: QuizQuestionWire[];
}

export interface QuizReviewItem {
  question_id: string;
  correct: boolean;
  /** Index chosen by the user (may be undefined when unanswered). */
  given: number | null;
  /** Index of the correct option. */
  correct_option: number | null;
}

export interface QuizSubmitResult {
  /** Percentage score as returned by the API (float). */
  score_percent: number;
  total: number;
  correct: number;
  review: QuizReviewItem[];
}

export class FatwaApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = 'FatwaApiError';
    this.status = status;
    this.code = code;
  }
}

function apiBase(): string {
  return apiBaseUrl();
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Localize a backend LocalizedText value (plain string or {fa,ar,en,…}
 * dict) for the active locale. Fallback chain: locale → en → fa → first
 * non-empty value.
 */
export function localizeDict(v: unknown, locale: string): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const m = v as Record<string, unknown>;
    for (const k of [locale, 'en', 'fa']) {
      if (typeof m[k] === 'string' && (m[k] as string).trim() !== '') {
        return m[k] as string;
      }
    }
    const first = Object.values(m).find(
      (x): x is string => typeof x === 'string' && x.trim() !== '',
    );
    if (first) return first;
  }
  return '';
}

function asCitation(raw: unknown, locale: string): Citation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const chunkId =
    typeof o.chunk_id === 'string' ? o.chunk_id : '';
  if (!chunkId && typeof o.source_citation === 'undefined' && typeof o.excerpt === 'undefined') {
    return null;
  }
  return {
    chunk_id: chunkId,
    source_citation: localizeDict(o.source_citation, locale),
    excerpt: asString(o.excerpt),
  };
}

function asStatus(v: unknown): FatwaStatus {
  const w: FatwaStatusWire =
    v === 'llm_unavailable' ? 'llm_unavailable' : v === 'no_sources' ? 'no_sources' : 'answered';
  return w === 'answered' ? 'ok' : w === 'no_sources' ? 'idk' : 'llm_unavailable';
}

function asAskResult(body: unknown, locale: string): AskResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const citations = Array.isArray(o.citations)
    ? o.citations
        .map((c) => asCitation(c, locale))
        .filter((c): c is Citation => c !== null)
    : [];
  return {
    answer: asString(o.answer),
    citations,
    session_id: typeof o.session_id === 'string' ? o.session_id : null,
    status: asStatus(o.status),
    aiLabel: typeof o.ai_label === 'string' ? o.ai_label : null,
    usage: o.usage && typeof o.usage === 'object' ? (o.usage as Usage) : null,
  };
}

async function throwForStatus(res: Response, path: string): Promise<never> {
  let code: string | null = null;
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = typeof j?.error?.code === 'string' ? j.error.code : null;
    detail = typeof j?.error?.message === 'string' ? j.error.message : '';
  } catch {
    /* non-JSON error body */
  }
  throw new FatwaApiError(detail || `${path} → ${res.status}`, res.status, code);
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new FatwaApiError(`API unreachable at ${apiBase()}`, 0);
  }
  if (!res.ok) await throwForStatus(res, `POST ${path}`);
  return (await res.json()) as T;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new FatwaApiError(`API unreachable at ${apiBase()}`, 0);
  }
  if (!res.ok) await throwForStatus(res, `GET ${path}`);
  return (await res.json()) as T;
}

/** Non-streaming ask. Throws FatwaApiError on failure. */
export async function askFatwa(
  question: string,
  opts: {
    sessionId?: string | null;
    category?: string | null;
    locale?: string;
    signal?: AbortSignal;
  } = {},
): Promise<AskResult> {
  const locale = opts.locale ?? 'fa';
  const body = await postJson<unknown>(
    '/api/v1/fatwa/ask',
    {
      question,
      locale,
      ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    },
    opts.signal,
  );
  // NOTE: the backend has no category filter on /ask; category is kept in
  // the signature for forward compatibility and ignored here.
  return asAskResult(body, locale);
}

/* ------------------------------------------------------------------ */
/* Streaming (SSE)                                                     */
/* ------------------------------------------------------------------ */

export interface StreamCallbacks {
  /** Incremental answer text (delta). */
  onToken: (delta: string) => void;
  /** Citations may arrive before or after the text. */
  onCitations?: (citations: Citation[]) => void;
  signal?: AbortSignal;
}

/**
 * Streaming ask over SSE. Returns the final AskResult once the stream
 * completes. Tolerant of the exact wire shape: accepts both type-tagged
 * events ({type:'token',text}, {type:'done',…}) and plain JSON payload
 * lines with an `answer` field as the terminal event.
 *
 * Aborting the passed signal aborts the underlying request — the caller
 * (hook) wires this to the visible cancel button.
 */
export async function streamFatwa(
  question: string,
  opts: {
    sessionId?: string | null;
    category?: string | null;
    locale?: string;
    signal?: AbortSignal;
    onToken: (delta: string) => void;
    onCitations?: (citations: Citation[]) => void;
  },
): Promise<AskResult> {
  const locale = opts.locale ?? 'fa';
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/fatwa/ask?stream=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        question,
        locale,
        ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new FatwaApiError(`API unreachable at ${apiBase()}`, 0);
  }
  if (!res.ok) await throwForStatus(res, 'POST /api/v1/fatwa/ask?stream=true');
  if (!res.body) throw new FatwaApiError('empty stream body', 0);

  // Non-SSE fallback: some deployments may answer with a single JSON body.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return asAskResult(await res.json(), locale);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let citations: Citation[] = [];
  let sessionId: string | null = null;
  let status: FatwaStatus = 'ok';
  let aiLabel: string | null = null;
  let usage: Usage | null = null;

  const handleEvent = (data: string): void => {
    const trimmed = data.trim();
    if (!trimmed || trimmed === '[DONE]') return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof evt.type === 'string' ? evt.type : null;
    // Token events: backend sends {"token": piece}; also accept
    // text/delta/content aliases for forward compatibility.
    const delta =
      typeof evt.token === 'string'
        ? evt.token
        : typeof evt.text === 'string'
          ? evt.text
          : typeof evt.delta === 'string'
            ? evt.delta
            : typeof evt.content === 'string'
              ? evt.content
              : null;
    if (type === 'token' || type === 'answer_chunk' || (type === null && delta !== null)) {
      if (delta !== null) {
        answer += delta;
        opts.onToken(delta);
      }
    }
    if (Array.isArray(evt.citations)) {
      citations = evt.citations
        .map((c) => asCitation(c, locale))
        .filter((c): c is Citation => c !== null);
      opts.onCitations?.(citations);
    }
    if (type === 'done' || typeof evt.answer === 'string' || typeof evt.status === 'string') {
      if (typeof evt.answer === 'string') {
        // Cumulative answer replaces deltas when the terminal event is complete.
        const full = evt.answer;
        if (full.length >= answer.length) {
          opts.onToken(full.slice(answer.length));
          answer = full;
        }
      }
      if (typeof evt.session_id === 'string') sessionId = evt.session_id;
      if (typeof evt.status === 'string') status = asStatus(evt.status);
      if (typeof evt.ai_label === 'string') aiLabel = evt.ai_label;
      if (evt.usage && typeof evt.usage === 'object') usage = evt.usage as Usage;
    }
    if (type === 'error' || typeof evt.error === 'string') {
      throw new FatwaApiError(
        typeof evt.error === 'string'
          ? evt.error
          : typeof evt.message === 'string'
            ? evt.message
            : 'stream error',
        0,
      );
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by blank lines; JSON-line streams by newline.
    const frames = buffer.split(/\r?\n\r?\n|\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/);
      for (const line of lines) {
        const payload = line.startsWith('data:') ? line.slice(5) : line;
        handleEvent(payload);
      }
    }
  }
  if (buffer.trim()) handleEvent(buffer);

  return { answer, citations, session_id: sessionId, status, aiLabel, usage };
}

/* ------------------------------------------------------------------ */
/* Categories / comparison / quiz                                      */
/* ------------------------------------------------------------------ */

/**
 * GET /api/v1/fatwa/categories.
 * Backend returns a bare array of {key, count} (CategoryOut) — also
 * accepts the {items:[…]} envelope for forward compatibility.
 */
export async function getFatwaCategories(
  signal?: AbortSignal,
): Promise<FatwaCategory[]> {
  const body = await getJson<unknown>('/api/v1/fatwa/categories', signal);
  const raw: unknown[] = Array.isArray(body)
    ? body
    : (body as { items?: unknown })?.items && Array.isArray((body as { items: unknown }).items)
      ? ((body as { items: unknown[] }).items as unknown[])
      : [];
  return raw
    .map((item): FatwaCategory | null => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const id = typeof o.key === 'string' ? o.key : typeof o.id === 'string' ? o.id : null;
      if (!id) return null;
      return {
        id,
        title: typeof o.title === 'string' ? o.title : id,
        description: typeof o.description === 'string' ? o.description : '',
      };
    })
    .filter((c): c is FatwaCategory => c !== null);
}

/** GET /api/v1/fatwa/compare/{topic_id}. */
export async function getMadhabComparison(
  topicId: string,
  locale = 'fa',
  signal?: AbortSignal,
): Promise<MadhabComparison> {
  const body = await getJson<unknown>(
    `/api/v1/fatwa/compare/${encodeURIComponent(topicId)}`,
    signal,
  );
  const o = (body ?? {}) as Record<string, unknown>;
  const positions = Array.isArray(o.positions)
    ? o.positions
        .map((raw): MadhabPosition | null => {
          if (!raw || typeof raw !== 'object') return null;
          const p = raw as Record<string, unknown>;
          return {
            madhab: asString(p.madhab),
            position_text: localizeDict(p.position_text, locale),
            evidence_refs: Array.isArray(p.evidence_refs)
              ? p.evidence_refs.filter((x): x is string => typeof x === 'string')
              : [],
          };
        })
        .filter((p): p is MadhabPosition => p !== null)
    : [];
  return {
    topic: localizeDict(o.title ?? o.topic, locale),
    description: localizeDict(o.description, locale),
    positions,
  };
}

/**
 * POST /api/v1/fatwa/quiz/generate?count={n} — count is a query param;
 * the backend has no category filter. Question texts are LocalizedText
 * dicts — localized for the active locale. No correct answers are leaked.
 */
export async function generateQuiz(
  opts: { count?: number; locale?: string; signal?: AbortSignal } = {},
): Promise<QuizGenerateResult> {
  const locale = opts.locale ?? 'fa';
  const count = Math.max(1, Math.min(20, opts.count ?? 5));
  const body = await postJson<unknown>(
    `/api/v1/fatwa/quiz/generate?count=${count}`,
    {},
    opts.signal,
  );
  const o = (body ?? {}) as Record<string, unknown>;
  const questions = Array.isArray(o.questions)
    ? o.questions
        .map((raw): QuizQuestionWire | null => {
          if (!raw || typeof raw !== 'object') return null;
          const q = raw as Record<string, unknown>;
          if (typeof q.id !== 'string') return null;
          const qtext = localizeDict(q.question_text, locale);
          if (!qtext) return null;
          return {
            id: q.id,
            question_text: qtext,
            options: Array.isArray(q.options)
              ? q.options
                  .map((x) => localizeDict(x, locale))
                  .filter((x) => x !== '')
              : [],
            source_citation: localizeDict(q.source_citation, locale),
          };
        })
        .filter((q): q is QuizQuestionWire => q !== null)
    : [];
  return {
    attempt_id: typeof o.attempt_id === 'string' ? o.attempt_id : '',
    questions,
  };
}

/**
 * POST /api/v1/fatwa/quiz/submit.
 * Backend returns {score (percent float), total, correct, details}.
 */
export async function submitQuiz(
  attemptId: string,
  answers: Record<string, number>,
  signal?: AbortSignal,
): Promise<QuizSubmitResult> {
  const body = await postJson<unknown>(
    '/api/v1/fatwa/quiz/submit',
    { attempt_id: attemptId, answers },
    signal,
  );
  const o = (body ?? {}) as Record<string, unknown>;
  const review = Array.isArray(o.details)
    ? o.details
        .map((raw): QuizReviewItem | null => {
          if (!raw || typeof raw !== 'object') return null;
          const r = raw as Record<string, unknown>;
          if (typeof r.question_id !== 'string') return null;
          const num = (v: unknown): number | null =>
            typeof v === 'number' && Number.isInteger(v) ? v : null;
          return {
            question_id: r.question_id,
            correct: r.is_correct === true,
            given: num(r.given),
            correct_option: num(r.correct_option),
          };
        })
        .filter((r): r is QuizReviewItem => r !== null)
    : [];
  return {
    score_percent: typeof o.score === 'number' ? o.score : 0,
    total: typeof o.total === 'number' ? o.total : review.length,
    correct: typeof o.correct === 'number' ? o.correct : 0,
    review,
  };
}
