import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { EMPTY_L10N, LocalizedText, WorkflowStatus } from "./contentApi";
import { errText } from "./quran";

export { errText };

/**
 * Articles service — WordPress-style catalog (CRM track).
 *
 * Typed client over the backend contract (mirrors lib/fatwa.ts topics):
 *   GET/POST /api/v1/admin/articles, PUT /{id}, PATCH /{id}/status
 *   GET/POST/PUT/DELETE /api/v1/admin/articles/categories
 *
 * ADR-001: all parsing / defaults / API access live here, never in
 * components.
 */

/* ------------------------------------------------------------------ */
/* shared shapes                                                       */
/* ------------------------------------------------------------------ */

export function parseL10n(raw: unknown): LocalizedText {
  if (!raw || typeof raw !== "object") return { ...EMPTY_L10N };
  const r = raw as Record<string, unknown>;
  const pick = (k: string): string =>
    typeof r[k] === "string" ? (r[k] as string) : "";
  return { fa: pick("fa"), ar: pick("ar"), en: pick("en") };
}

function parseWorkflowStatus(raw: unknown): WorkflowStatus {
  const s = [
    "draft",
    "in_review",
    "approved",
    "published",
    "rejected",
    "archived",
  ];
  return typeof raw === "string" && s.includes(raw) ? (raw as WorkflowStatus) : "draft";
}

export interface ArticleCategoryRef {
  slug: string;
  title: LocalizedText;
}

export interface Article {
  id: string;
  title: LocalizedText;
  body: Record<string, unknown>;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  workflow_status: WorkflowStatus;
  category_id: string | null;
  category: ArticleCategoryRef | null;
  author_name: string | null;
  featured_image_url: string | null;
  view_count: number;
  share_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export function parseArticle(raw: unknown): Article | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.slug !== "string" || !r.slug) return null;
  let category: Article["category"] = null;
  if (r.category && typeof r.category === "object") {
    const c = r.category as Record<string, unknown>;
    if (typeof c.slug === "string" && c.slug) {
      category = { slug: c.slug, title: parseL10n(c.title) };
    }
  }
  const body =
    r.body && typeof r.body === "object" && !Array.isArray(r.body)
      ? (r.body as Record<string, unknown>)
      : {};
  return {
    id: r.id,
    title: parseL10n(r.title),
    body,
    slug: r.slug,
    seo_title: typeof r.seo_title === "string" ? r.seo_title : null,
    seo_description:
      typeof r.seo_description === "string" ? r.seo_description : null,
    workflow_status: parseWorkflowStatus(r.workflow_status),
    category_id: typeof r.category_id === "string" ? r.category_id : null,
    category,
    author_name: typeof r.author_name === "string" ? r.author_name : null,
    featured_image_url:
      typeof r.featured_image_url === "string" ? r.featured_image_url : null,
    view_count: typeof r.view_count === "number" ? r.view_count : 0,
    share_count: typeof r.share_count === "number" ? r.share_count : 0,
    published_at: typeof r.published_at === "string" ? r.published_at : null,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

export const ARTICLE_KEY = ["articles"];

export interface ArticleFilters {
  status?: string;
  category?: string;
  q?: string;
  perPage?: number;
}

export function useArticles(filters?: ArticleFilters) {
  const { status, category, q, perPage } = filters ?? {};
  return useQuery({
    queryKey: [...ARTICLE_KEY, status ?? "", category ?? "", q ?? "", perPage ?? 100],
    queryFn: async (): Promise<Article[]> => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      if (q) params.set("q", q);
      params.set("per_page", String(perPage ?? 100));
      const qs = params.toString();
      const raw = await apiFetch<unknown>(`/api/v1/admin/articles${qs ? `?${qs}` : ""}`);
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      return items.map(parseArticle).filter((x): x is Article => x !== null);
    },
    retry: false,
  });
}

export interface ArticleBody {
  title: LocalizedText;
  body: Record<string, unknown>;
  slug: string;
  seo_title?: string | null;
  seo_description?: string | null;
  category_id?: string | null;
  author_name?: string | null;
  featured_image_url?: string | null;
}

export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ArticleBody) =>
      apiFetch<unknown>("/api/v1/admin/articles", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ARTICLE_KEY });
    },
  });
}

export function useUpdateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ArticleBody }) =>
      apiFetch<unknown>(`/api/v1/admin/articles/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ARTICLE_KEY });
    },
  });
}

/**
 * Workflow transition for an article. The backend enforces the §9 machine
 * (no jumps): approve from review means two sequential PATCHes here in
 * the CRM (approved, then published); reject → rejected; archive →
 * archived; restore → draft. No backend bypass.
 */
export function useSetArticleStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch<unknown>(`/api/v1/admin/articles/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ARTICLE_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* categories                                                          */
/* ------------------------------------------------------------------ */

export interface ArticleCategory {
  id: string;
  slug: string;
  title: LocalizedText;
  created_at: string;
}

export function parseArticleCategory(raw: unknown): ArticleCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.slug !== "string" || !r.slug) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: parseL10n(r.title),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

export const ARTICLE_CATEGORY_KEY = ["article-categories"];

export function useArticleCategories() {
  return useQuery({
    queryKey: ARTICLE_CATEGORY_KEY,
    queryFn: async (): Promise<ArticleCategory[]> => {
      const raw = await apiFetch<unknown>("/api/v1/admin/articles/categories");
      const items = Array.isArray(raw) ? raw : [];
      return items
        .map(parseArticleCategory)
        .filter((x): x is ArticleCategory => x !== null);
    },
    retry: false,
  });
}

export interface ArticleCategoryBody {
  slug: string;
  title: LocalizedText;
}

export function useCreateArticleCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ArticleCategoryBody) =>
      apiFetch<unknown>("/api/v1/admin/articles/categories", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ARTICLE_CATEGORY_KEY });
    },
  });
}

export function useUpdateArticleCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ArticleCategoryBody }) =>
      apiFetch<unknown>(`/api/v1/admin/articles/categories/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ARTICLE_CATEGORY_KEY });
    },
  });
}

export function useDeleteArticleCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/admin/articles/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ARTICLE_CATEGORY_KEY });
    },
  });
}
