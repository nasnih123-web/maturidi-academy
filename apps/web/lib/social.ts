/**
 * Social domain client (Phase 10 — web track).
 *
 * Typed client for the community/social API plus the fatwa question /
 * submission endpoints. ALL fetch logic for /api/v1/social/*,
 * /api/v1/fatwa/questions and /api/v1/fatwa/submissions lives here —
 * components and hooks never call fetch directly (ADR-001).
 *
 * Wire contract (source of truth: backend track, Phase 10):
 * - GET    /api/v1/social/groups?cursor=
 *          → {items:[{id,name,description,member_count}], next_cursor}
 * - GET    /api/v1/social/groups/{id}          → SocialGroup
 * - POST   /api/v1/social/groups/{id}/join     → 200 GroupOut
 * - POST   /api/v1/social/groups/{id}/leave    → 200 GroupOut
 * - GET    /api/v1/social/groups/{id}/posts?cursor= → {items:[post], next_cursor}
 * - GET    /api/v1/social/feed?cursor=          → {items:[post], next_cursor}
 * - POST   /api/v1/social/posts {group_id?, body}
 *          → 201 post; 422 {error:{code:"content_policy_violation"}} on banned words
 * - GET    /api/v1/social/posts/{id}           → post (with liked flag)
 * - POST   /api/v1/social/posts/{id}/comments {body} → 201 comment
 * - POST   /api/v1/social/report {target_type:"post"|"comment", target_id, reason}
 *          → 201 ReportOut {id, sla_due_at, ...} (mapped to {report_id, sla_hours} in lib)
 * - POST   /api/v1/social/posts/{id}/like      → 200 {liked, likes_count}
 * - DELETE /api/v1/social/posts/{id}/like      → 200 {liked, likes_count}
 * - POST   /api/v1/social/follows {followed_id} → 201 FollowOut
 * - DELETE /api/v1/social/follows/{followed_id} → 200 {unfollowed}
 * - POST   /api/v1/fatwa/questions {text}
 *          → {cluster_id, matched, similarity, suggestion: {answer, answered_at} | null}
 * - POST   /api/v1/fatwa/submissions {title, body, madhab, evidence}
 *          → 201 {id, workflow_state} (scholar_author only)
 *
 * Wire contract verified against the Phase-10 backend during integration.
 *
 * Demo mode: when NEXT_PUBLIC_SOCIAL_DEMO=1, every call is served from
 * in-fixture data (lib/demo-social.ts) so the routes can be exercised
 * and screenshotted without a live backend. This is an explicit,
 * screenshot-only switch — OFF by default, never production data
 * (engineering contract §15.9).
 */

import { getAccessToken, getRefreshToken, refreshTokens } from './auth-client';
import { apiBaseUrl } from './api-base';
import {
  demoAskQuestion,
  demoCommentOnPost,
  demoCreatePost,
  demoFollowAuthor,
  demoGetFeed,
  demoGetGroupPosts,
  demoGetGroups,
  demoGetPost,
  demoJoinGroup,
  demoLeaveGroup,
  demoLikePost,
  demoReportContent,
  demoSubmitFatwa,
  demoUnlikePost,
  demoUnfollowAuthor,
} from './demo-social';

export interface SocialAuthor {
  id: string;
  display_name: string;
}

export interface SocialGroup {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  /** Whether the current user is a member (server-provided when known). */
  joined?: boolean;
}

export interface SocialPost {
  id: string;
  author: SocialAuthor;
  group_id: string | null;
  group_name: string | null;
  body: string;
  comments_count: number;
  likes_count?: number;
  liked?: boolean;
  following_author?: boolean;
  created_at: string;
}

export interface SocialComment {
  id: string;
  author: SocialAuthor;
  body: string;
  created_at: string;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface PostDetail {
  post: SocialPost;
  comments: SocialComment[];
}

export interface QuestionSuggestion {
  answer: string;
  answered_at: string | null;
}

export interface AskQuestionResult {
  cluster_id: string;
  suggestion: QuestionSuggestion | null;
}

export interface FatwaSubmissionResult {
  id: string;
  workflow_state: string;
}

export interface ReportResult {
  report_id: string;
  /** Moderation SLA in hours, when the backend advertises one. */
  sla_hours: number | null;
}

export type ReportTargetType = 'post' | 'comment';

export interface CreatePostInput {
  group_id?: string | null;
  body: string;
}

export interface ReportInput {
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
}

export interface AskQuestionInput {
  text: string;
}

export interface FatwaSubmissionInput {
  title: string;
  body: string;
  madhab: string;
  evidence: string;
}

/** Backend error code for the pre-publish banned-word filter. */
export const CONTENT_POLICY_VIOLATION = 'content_policy_violation';

export class SocialApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = 'SocialApiError';
    this.status = status;
    this.code = code;
  }
}

/** True only for the explicit screenshot/test switch. */
export function isSocialDemo(): boolean {
  return process.env.NEXT_PUBLIC_SOCIAL_DEMO === '1';
}

function apiBase(): string {
  return apiBaseUrl();
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
  request_id?: string;
}

async function readErrorCode(res: Response): Promise<{ code: string | null; message: string }> {
  let code: string | null = null;
  let message = `request failed (${res.status})`;
  try {
    const j = (await res.clone().json()) as ErrorEnvelope;
    if (j?.error?.code) code = j.error.code;
    if (j?.error?.message) message = j.error.message;
  } catch {
    /* non-JSON error body */
  }
  return { code, message };
}

/**
 * Auth-aware raw fetch: attaches the access token, refreshes once on 401
 * (same lifecycle as authFetch in auth-client.ts) and returns the raw
 * Response so callers can read structured error codes (e.g. 422
 * content_policy_violation) instead of a flattened message.
 */
async function authedRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${apiBase()}${path}`, { ...init, headers });
  };
  let res = await doFetch(getAccessToken());
  if (res.status === 401 && getRefreshToken()) {
    try {
      const pair = await refreshTokens();
      res = await doFetch(pair.access_token);
    } catch {
      /* refresh failed — fall through with the original 401 */
    }
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authedRaw(path, init);
  } catch (err) {
    throw new SocialApiError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    const { code, message } = await readErrorCode(res);
    throw new SocialApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new SocialApiError('invalid JSON response', res.status);
  }
}

function qs(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function asPage<T>(v: unknown): CursorPage<T> {
  const items = Array.isArray((v as { items?: unknown })?.items)
    ? ((v as { items: T[] }).items as T[])
    : [];
  const nextCursor = (v as { next_cursor?: unknown })?.next_cursor;
  return {
    items,
    next_cursor: typeof nextCursor === 'string' && nextCursor ? nextCursor : null,
  };
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

/** GET /api/v1/social/groups — topic-group directory. */
export async function listGroups(cursor?: string): Promise<CursorPage<SocialGroup>> {
  if (isSocialDemo()) return demoGetGroups(cursor);
  return asPage<SocialGroup>(await request<unknown>(`/api/v1/social/groups${qs({ cursor })}`));
}

/** GET /api/v1/social/groups/{id}. */
export async function getGroup(id: string): Promise<SocialGroup> {
  if (isSocialDemo()) {
    const page = await demoGetGroups();
    const g = page.items.find((x) => x.id === id);
    if (!g) throw new SocialApiError('group not found', 404);
    return g;
  }
  return request<SocialGroup>(`/api/v1/social/groups/${encodeURIComponent(id)}`);
}

/** POST /api/v1/social/groups/{id}/join. */
export async function joinGroup(id: string): Promise<void> {
  if (isSocialDemo()) {
    await demoJoinGroup(id);
    return;
  }
  await request<unknown>(`/api/v1/social/groups/${encodeURIComponent(id)}/join`, {
    method: 'POST',
  });
}

/** POST /api/v1/social/groups/{id}/leave */
export async function leaveGroup(id: string): Promise<void> {
  if (isSocialDemo()) {
    await demoLeaveGroup(id);
    return;
  }
  await request<unknown>(`/api/v1/social/groups/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
  });
}

/** GET /api/v1/social/groups/{id}/posts. */
export async function listGroupPosts(
  groupId: string,
  cursor?: string,
): Promise<CursorPage<SocialPost>> {
  if (isSocialDemo()) return demoGetGroupPosts(groupId, cursor);
  return asPage<SocialPost>(
    await request<unknown>(`/api/v1/social/groups/${encodeURIComponent(groupId)}/posts${qs({ cursor })}`),
  );
}

/* ------------------------------------------------------------------ */
/* Feed & posts                                                        */
/* ------------------------------------------------------------------ */

/** GET /api/v1/social/feed — personal feed (follows + groups). */
export async function getFeed(cursor?: string): Promise<CursorPage<SocialPost>> {
  if (isSocialDemo()) return demoGetFeed(cursor);
  return asPage<SocialPost>(await request<unknown>(`/api/v1/social/feed${qs({ cursor })}`));
}

/**
 * POST /api/v1/social/posts — publish a post.
 * Throws SocialApiError with code `content_policy_violation` (422)
 * when the pre-publish banned-word filter rejects the body.
 */
export async function createPost(input: CreatePostInput): Promise<SocialPost> {
  if (isSocialDemo()) return demoCreatePost(input);
  return request<SocialPost>('/api/v1/social/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id: input.group_id ?? null, body: input.body }),
  });
}

/** GET /api/v1/social/posts/{id} — post + comments. */
export async function getPostDetail(id: string): Promise<PostDetail> {
  if (isSocialDemo()) return demoGetPost(id);
  const wire = await request<unknown>(`/api/v1/social/posts/${encodeURIComponent(id)}`);
  const w = wire as { post?: SocialPost; comments?: SocialComment[] };
  return { post: w.post as SocialPost, comments: Array.isArray(w.comments) ? w.comments : [] };
}

/** POST /api/v1/social/posts/{id}/comments. */
export async function createComment(postId: string, body: string): Promise<SocialComment> {
  if (isSocialDemo()) return demoCommentOnPost(postId, body);
  return request<SocialComment>(`/api/v1/social/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

/** POST /api/v1/social/report — flag a post or comment for moderation. */
export async function reportContent(input: ReportInput): Promise<ReportResult> {
  if (isSocialDemo()) return demoReportContent(input);
  const wire = await request<unknown>('/api/v1/social/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  // Backend returns ReportOut {id, sla_due_at, ...}; map to the UI shape.
  const w = wire as { id?: string; sla_due_at?: string };
  let sla_hours: number | null = null;
  if (w.sla_due_at) {
    const ms = new Date(w.sla_due_at).getTime() - Date.now();
    if (Number.isFinite(ms) && ms > 0) sla_hours = Math.round(ms / 3600000);
  }
  return {
    report_id: typeof w.id === 'string' ? w.id : '',
    sla_hours,
  };
}

/** POST /api/v1/social/posts/{id}/like */
export async function likePost(id: string): Promise<void> {
  if (isSocialDemo()) {
    await demoLikePost(id);
    return;
  }
  await request<unknown>(`/api/v1/social/posts/${encodeURIComponent(id)}/like`, {
    method: 'POST',
  });
}

/** DELETE /api/v1/social/posts/{id}/like. */
export async function unlikePost(id: string): Promise<void> {
  if (isSocialDemo()) {
    await demoUnlikePost(id);
    return;
  }
  await request<unknown>(`/api/v1/social/posts/${encodeURIComponent(id)}/like`, {
    method: 'DELETE',
  });
}

/** POST /api/v1/social/follows {followed_id}. */
export async function followAuthor(authorId: string): Promise<void> {
  if (isSocialDemo()) {
    await demoFollowAuthor(authorId);
    return;
  }
  await request<unknown>('/api/v1/social/follows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ followed_id: authorId }),
  });
}

/** DELETE /api/v1/social/follows/{followed_id}. */
export async function unfollowAuthor(authorId: string): Promise<void> {
  if (isSocialDemo()) {
    await demoUnfollowAuthor(authorId);
    return;
  }
  await request<unknown>(`/api/v1/social/follows/${encodeURIComponent(authorId)}`, {
    method: 'DELETE',
  });
}

/* ------------------------------------------------------------------ */
/* Fatwa question & submission                                         */
/* ------------------------------------------------------------------ */

/**
 * POST /api/v1/fatwa/questions — submit a question; similar questions are
 * matched by embedding. When the question was already answered, the
 * response carries the prior answer as `suggestion`.
 */
export async function askQuestion(input: AskQuestionInput): Promise<AskQuestionResult> {
  if (isSocialDemo()) return demoAskQuestion(input);
  const wire = await request<unknown>('/api/v1/fatwa/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input.text }),
  });
  const w = wire as {
    cluster_id?: string;
    suggestion?: { answer?: string; answered_at?: string | null } | null;
  };
  return {
    cluster_id: typeof w.cluster_id === 'string' ? w.cluster_id : '',
    suggestion: w.suggestion
      ? {
          answer: typeof w.suggestion.answer === 'string' ? w.suggestion.answer : '',
          answered_at: typeof w.suggestion.answered_at === 'string' ? w.suggestion.answered_at : null,
        }
      : null,
  };
}

/**
 * POST /api/v1/fatwa/submissions — scholar-author fatwa submission.
 * Enters the shared workflow (draft → in_review → …).
 */
export async function submitFatwa(input: FatwaSubmissionInput): Promise<FatwaSubmissionResult> {
  if (isSocialDemo()) return demoSubmitFatwa(input);
  const wire = await request<unknown>('/api/v1/fatwa/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const w = wire as { id?: string; workflow_state?: string };
  return {
    id: typeof w.id === 'string' ? w.id : '',
    workflow_state: typeof w.workflow_state === 'string' ? w.workflow_state : 'draft',
  };
}

/* ------------------------------------------------------------------ */
/* Pure presentation helpers (no I/O)                                  */
/* ------------------------------------------------------------------ */

/** Localized display of an ISO 8601 timestamp. Presentation-only. */
export function formatSocialDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tag = locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fa-IR';
  try {
    return new Intl.DateTimeFormat(tag, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return iso;
  }
}
