/**
 * apps/mobile — src/services/social.ts
 *
 * Social network client (Phase 10): feed, posts, likes.
 */
import { api } from "../lib/api";
import type { FeedPage, SocialPost } from "../types";

export async function getFeed(cursor?: string, limit = 20): Promise<FeedPage> {
  const res = await api.get<FeedPage>("/api/v1/social/feed", {
    query: { after: cursor, limit },
  });
  return { items: res.items ?? [], next_cursor: res.next_cursor ?? null };
}

export async function createPost(body: string, groupId?: string): Promise<SocialPost> {
  return api.post<SocialPost>("/api/v1/social/posts", {
    body,
    ...(groupId ? { group_id: groupId } : {}),
  });
}

export async function toggleLike(post: SocialPost): Promise<{ liked: boolean; likesCount: number }> {
  if (post.liked) {
    const res = await api.del<{ liked: boolean; likes_count: number }>(`/api/v1/social/posts/${post.id}/like`);
    return { liked: res.liked, likesCount: res.likes_count };
  }
  const res = await api.post<{ liked: boolean; likes_count: number }>(`/api/v1/social/posts/${post.id}/like`);
  return { liked: res.liked, likesCount: res.likes_count };
}

export interface SocialComment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export async function getComments(postId: string): Promise<SocialComment[]> {
  const res = await api.get<{ items: SocialComment[] }>(`/api/v1/social/posts/${postId}/comments`);
  return res.items ?? [];
}

export async function addComment(postId: string, body: string): Promise<SocialComment> {
  return api.post<SocialComment>(`/api/v1/social/posts/${postId}/comments`, { body });
}
