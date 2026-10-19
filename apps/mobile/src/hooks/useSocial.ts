/**
 * apps/mobile — src/hooks/useSocial.ts
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { createPost as svcCreate, getFeed as svcFeed, toggleLike as svcLike } from "../services/social";
import type { SocialPost } from "../types";

export function useSocialFeed(): {
  posts: SocialPost[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
  publish: (body: string) => Promise<boolean>;
  toggleLike: (post: SocialPost) => Promise<void>;
} {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setCursor(null);
    setHasMore(true);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    svcFeed(undefined, 20)
      .then((page) => {
        if (!alive) return;
        setPosts(page.items);
        setCursor(page.next_cursor);
        setHasMore(page.next_cursor != null);
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await svcFeed(cursor, 20);
      setPosts((p) => [...p, ...page.items]);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor != null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, loadingMore]);

  const publish = useCallback(async (body: string): Promise<boolean> => {
    try {
      const post = await svcCreate(body);
      setPosts((p) => [post, ...p]);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
      return false;
    }
  }, []);

  const toggleLike = useCallback(async (post: SocialPost) => {
    try {
      const res = await svcLike(post);
      setPosts((ps) => ps.map((p) => (p.id === post.id ? { ...p, liked: res.liked, likes_count: res.likesCount } : p)));
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
    }
  }, []);

  return { posts, loading, loadingMore, error, hasMore, refresh, loadMore, publish, toggleLike };
}
