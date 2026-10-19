'use client';

/**
 * useSocial — state machines for the Phase 10 social surfaces.
 *
 * Owns: group lists, group detail, personal feed, post detail, comment
 * creation, like/follow toggles, report submission, fatwa question
 * (already-answered suggestion), fatwa submission, and the scholar_author
 * role check. All network I/O goes through lib/social.ts; components
 * only render (ADR-001).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  askQuestion,
  CONTENT_POLICY_VIOLATION,
  createComment,
  createPost,
  followAuthor,
  getFeed,
  getGroup,
  getPostDetail,
  isSocialDemo,
  joinGroup,
  leaveGroup,
  likePost,
  listGroupPosts,
  listGroups,
  reportContent,
  submitFatwa,
  unlikePost,
  unfollowAuthor,
  type AskQuestionResult,
  type CreatePostInput,
  type CursorPage,
  type FatwaSubmissionInput,
  type FatwaSubmissionResult,
  type PostDetail,
  type ReportInput,
  type SocialComment,
  type SocialGroup,
  type SocialPost,
} from '../social';
import { getAccessToken as tokenOf } from '../auth-client';

/** Pure: role names carried by the access-token payload (RBAC is backend-owned). */
function tokenRoles(): string[] {
  const token = tokenOf();
  if (!token) return [];
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles)
      ? payload.roles.filter((r): r is string => typeof r === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Whether the current user may open the scholar fatwa-submission form. */
export function useIsScholarAuthor(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (isSocialDemo()) {
      setOk(true);
      return;
    }
    setOk(tokenRoles().includes('scholar_author'));
  }, []);
  return ok;
}

export interface LoadState {
  loading: boolean;
  error: boolean;
}

function usePaginated<T>(loader: (cursor?: string) => Promise<CursorPage<T>>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const page = await loaderRef.current(undefined);
      setItems(page.items);
      setCursor(page.next_cursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || cursor === null) return;
    setLoadingMore(true);
    try {
      const page = await loaderRef.current(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, setItems, cursor, loading, loadingMore, error, retry: load, loadMore };
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export function useSocialGroups() {
  const page = usePaginated<SocialGroup>(useCallback((c) => listGroups(c), []));
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleJoin = useCallback(
    async (group: SocialGroup) => {
      if (busyId) return;
      setBusyId(group.id);
      // Optimistic flip; reverted on failure.
      page.setItems((prev) =>
        prev.map((g) =>
          g.id === group.id
            ? { ...g, joined: !g.joined, member_count: g.member_count + (g.joined ? -1 : 1) }
            : g,
        ),
      );
      try {
        if (group.joined) await leaveGroup(group.id);
        else await joinGroup(group.id);
      } catch {
        page.setItems((prev) => prev.map((g) => (g.id === group.id ? group : g)));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, page],
  );

  return { ...page, busyId, toggleJoin };
}

export interface GroupViewState extends LoadState {
  group: SocialGroup | null;
  posts: SocialPost[];
  postsLoading: boolean;
  postsError: boolean;
  loadMorePosts: () => void;
  loadingMorePosts: boolean;
  hasMorePosts: boolean;
  retryAll: () => void;
  busyId: string | null;
  toggleJoin: () => void;
}

export function useGroupView(groupId: string): GroupViewState {
  const [group, setGroup] = useState<SocialGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const posts = usePaginated<SocialPost>(
    useCallback((c) => listGroupPosts(groupId, c), [groupId]),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setGroup(await getGroup(groupId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleJoin = useCallback(async () => {
    if (!group || busy) return;
    setBusy(true);
    const prev = group;
    setGroup({ ...group, joined: !group.joined, member_count: group.member_count + (group.joined ? -1 : 1) });
    try {
      if (prev.joined) await leaveGroup(prev.id);
      else await joinGroup(prev.id);
    } catch {
      setGroup(prev);
    } finally {
      setBusy(false);
    }
  }, [group, busy]);

  const retryAll = useCallback(() => {
    void load();
    void posts.retry();
  }, [load, posts]);

  return {
    group,
    posts: posts.items,
    postsLoading: posts.loading,
    postsError: posts.error,
    loadMorePosts: posts.loadMore,
    loadingMorePosts: posts.loadingMore,
    hasMorePosts: posts.cursor !== null,
    loading,
    error,
    retryAll,
    busyId: busy ? groupId : null,
    toggleJoin,
  };
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

export interface FeedState extends LoadState {
  posts: SocialPost[];
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  retry: () => void;
  prependPost: (post: SocialPost) => void;
  toggleLike: (post: SocialPost) => void;
  toggleFollow: (post: SocialPost) => void;
}

export function useSocialFeed(): FeedState {
  const page = usePaginated<SocialPost>(useCallback((c) => getFeed(c), []));

  const prependPost = useCallback(
    (post: SocialPost) => page.setItems((prev) => [post, ...prev]),
    [page],
  );

  const toggleLike = useCallback(
    async (post: SocialPost) => {
      page.setItems((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                liked: !p.liked,
                likes_count: (p.likes_count ?? 0) + (p.liked ? -1 : 1),
              }
            : p,
        ),
      );
      try {
        if (post.liked) await unlikePost(post.id);
        else await likePost(post.id);
      } catch {
        page.setItems((prev) => prev.map((p) => (p.id === post.id ? post : p)));
      }
    },
    [page],
  );

  const toggleFollow = useCallback(
    async (post: SocialPost) => {
      const following = !post.following_author;
      page.setItems((prev) =>
        prev.map((p) =>
          p.author.id === post.author.id ? { ...p, following_author: following } : p,
        ),
      );
      try {
        if (following) await followAuthor(post.author.id);
        else await unfollowAuthor(post.author.id);
      } catch {
        page.setItems((prev) =>
          prev.map((p) =>
            p.author.id === post.author.id ? { ...p, following_author: post.following_author } : p,
          ),
        );
      }
    },
    [page],
  );

  return {
    posts: page.items,
    hasMore: page.cursor !== null,
    loadMore: page.loadMore,
    loadingMore: page.loadingMore,
    loading: page.loading,
    error: page.error,
    retry: page.retry,
    prependPost,
    toggleLike,
    toggleFollow,
  };
}

/* ------------------------------------------------------------------ */
/* Composer (post publishing + banned-word handling)                   */
/* ------------------------------------------------------------------ */

export interface ComposerState {
  body: string;
  setBody: (v: string) => void;
  posting: boolean;
  /** Backend error code, e.g. `content_policy_violation`. */
  errorCode: string | null;
  failed: boolean;
  publish: (groupId?: string | null) => Promise<boolean>;
  reset: () => void;
}

export function useComposer(onPublished: (post: SocialPost) => void): ComposerState {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const onPublishedRef = useRef(onPublished);
  onPublishedRef.current = onPublished;

  const reset = useCallback(() => {
    setBody('');
    setErrorCode(null);
    setFailed(false);
  }, []);

  const publish = useCallback(
    async (groupId?: string | null) => {
      const text = body.trim();
      if (!text || posting) return false;
      setPosting(true);
      setErrorCode(null);
      setFailed(false);
      try {
        const input: CreatePostInput = { group_id: groupId ?? null, body: text };
        const post = await createPost(input);
        onPublishedRef.current(post);
        reset();
        return true;
      } catch (err) {
        if (err instanceof Error && 'code' in err) {
          setErrorCode((err as { code: string | null }).code);
        }
        setFailed(true);
        return false;
      } finally {
        setPosting(false);
      }
    },
    [body, posting, reset],
  );

  return { body, setBody, posting, errorCode, failed, publish, reset };
}

export { CONTENT_POLICY_VIOLATION };

/* ------------------------------------------------------------------ */
/* Post detail + comments + report                                     */
/* ------------------------------------------------------------------ */

export interface PostViewState extends LoadState {
  detail: PostDetail | null;
  retry: () => void;
  commentBody: string;
  setCommentBody: (v: string) => void;
  commenting: boolean;
  commentErrorCode: string | null;
  commentFailed: boolean;
  submitComment: () => Promise<void>;
  toggleLike: () => void;
  toggleFollow: () => void;
}

export function usePostView(postId: string): PostViewState {
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentErrorCode, setCommentErrorCode] = useState<string | null>(null);
  const [commentFailed, setCommentFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setDetail(await getPostDetail(postId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitComment = useCallback(async () => {
    const text = commentBody.trim();
    if (!text || commenting || !detail) return;
    setCommenting(true);
    setCommentErrorCode(null);
    setCommentFailed(false);
    try {
      const comment: SocialComment = await createComment(postId, text);
      setDetail((d) =>
        d
          ? {
              post: { ...d.post, comments_count: d.post.comments_count + 1 },
              comments: [...d.comments, comment],
            }
          : d,
      );
      setCommentBody('');
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        setCommentErrorCode((err as { code: string | null }).code);
      }
      setCommentFailed(true);
    } finally {
      setCommenting(false);
    }
  }, [commentBody, commenting, detail, postId]);

  const toggleLike = useCallback(async () => {
    if (!detail) return;
    const prev = detail.post;
    setDetail((d) =>
      d
        ? {
            ...d,
            post: {
              ...d.post,
              liked: !d.post.liked,
              likes_count: (d.post.likes_count ?? 0) + (d.post.liked ? -1 : 1),
            },
          }
        : d,
    );
    try {
      if (prev.liked) await unlikePost(prev.id);
      else await likePost(prev.id);
    } catch {
      setDetail((d) => (d ? { ...d, post: prev } : d));
    }
  }, [detail]);

  const toggleFollow = useCallback(async () => {
    if (!detail) return;
    const prev = detail.post;
    const following = !prev.following_author;
    setDetail((d) =>
      d ? { ...d, post: { ...d.post, following_author: following } } : d,
    );
    try {
      if (following) await followAuthor(prev.author.id);
      else await unfollowAuthor(prev.author.id);
    } catch {
      setDetail((d) => (d ? { ...d, post: prev } : d));
    }
  }, [detail]);

  return {
    detail,
    loading,
    error,
    retry: load,
    commentBody,
    setCommentBody,
    commenting,
    commentErrorCode,
    commentFailed,
    submitComment,
    toggleLike,
    toggleFollow,
  };
}

export interface ReportState {
  open: boolean;
  setOpen: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
  submitting: boolean;
  succeeded: boolean;
  failed: boolean;
  slaHours: number | null;
  submit: (target: ReportInput) => Promise<void>;
  reset: () => void;
}

export function useReport(): ReportState {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slaHours, setSlaHours] = useState<number | null>(null);

  const reset = useCallback(() => {
    setOpen(false);
    setReason('spam');
    setSucceeded(false);
    setFailed(false);
    setSlaHours(null);
  }, []);

  const submit = useCallback(
    async (target: ReportInput) => {
      if (submitting) return;
      setSubmitting(true);
      setFailed(false);
      try {
        const res = await reportContent({ ...target, reason });
        setSlaHours(res.sla_hours);
        setSucceeded(true);
      } catch {
        setFailed(true);
      } finally {
        setSubmitting(false);
      }
    },
    [reason, submitting],
  );

  return { open, setOpen, reason, setReason, submitting, succeeded, failed, slaHours, submit, reset };
}

/* ------------------------------------------------------------------ */
/* Fatwa question (already-answered suggestion)                         */
/* ------------------------------------------------------------------ */

export interface QuestionFormState {
  text: string;
  setText: (v: string) => void;
  asking: boolean;
  failed: boolean;
  result: AskQuestionResult | null;
  ask: () => Promise<void>;
  reset: () => void;
}

export function useQuestionForm(): QuestionFormState {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AskQuestionResult | null>(null);

  const reset = useCallback(() => {
    setText('');
    setResult(null);
    setFailed(false);
  }, []);

  const ask = useCallback(async () => {
    const q = text.trim();
    if (!q || asking) return;
    setAsking(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await askQuestion({ text: q }));
    } catch {
      setFailed(true);
    } finally {
      setAsking(false);
    }
  }, [text, asking]);

  return { text, setText, asking, failed, result, ask, reset };
}

/* ------------------------------------------------------------------ */
/* Fatwa submission (scholar_author)                                   */
/* ------------------------------------------------------------------ */

export interface FatwaSubmissionState {
  title: string;
  setTitle: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  madhab: string;
  setMadhab: (v: string) => void;
  evidence: string;
  setEvidence: (v: string) => void;
  submitting: boolean;
  failed: boolean;
  result: FatwaSubmissionResult | null;
  submit: () => Promise<void>;
}

export function useFatwaSubmission(): FatwaSubmissionState {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [madhab, setMadhab] = useState('hanafi');
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<FatwaSubmissionResult | null>(null);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      const input: FatwaSubmissionInput = {
        title: title.trim(),
        body: body.trim(),
        madhab,
        evidence: evidence.trim(),
      };
      setResult(await submitFatwa(input));
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }, [title, body, madhab, evidence, submitting]);

  const canSubmit = useMemo(
    () => title.trim() !== '' && body.trim() !== '' && madhab !== '',
    [title, body, madhab],
  );

  return {
    title,
    setTitle,
    body,
    setBody,
    madhab,
    setMadhab,
    evidence,
    setEvidence,
    submitting,
    failed,
    result,
    submit: canSubmit ? submit : async () => {},
  };
}
