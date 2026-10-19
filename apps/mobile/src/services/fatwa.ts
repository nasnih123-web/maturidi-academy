/**
 * apps/mobile — src/services/fatwa.ts
 *
 * Fatwa Q&A against the Phase-6 RAG engine: POST /api/v1/fatwa/ask returns
 * the answer plus provenance citations. The mobile client surfaces the
 * `ai_label` disclaimer verbatim — it must never be hidden or reworded by
 * the client (governance: answers are AI-assisted, not scholarly fatwas).
 */
import { api } from "../lib/api";
import type { FatwaAnswer, Locale } from "../types";

export async function askFatwa(question: string, locale: Locale = "fa", topK = 5): Promise<FatwaAnswer> {
  return api.post<FatwaAnswer>("/api/v1/fatwa/ask", {
    question,
    locale,
    top_k: topK,
  });
}

export interface FatwaSubmission {
  id: string;
  question_text: string;
  status: string;
  created_at: string;
}

/** The user's own submitted questions (workflow-tracked). */
export async function mySubmissions(): Promise<FatwaSubmission[]> {
  const res = await api.get<{ items: FatwaSubmission[] }>("/api/v1/fatwa/submissions");
  return res.items ?? [];
}

export async function getCategories(): Promise<{ key: string; count: number }[]> {
  return api.get("/api/v1/fatwa/categories");
}
