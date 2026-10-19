/**
 * apps/mobile — src/services/home.ts
 *
 * Home screen data: the CMS-driven sections from GET /api/v1/home/sections.
 * The web storefront renders the same contract — full parity by construction.
 */
import { api } from "../lib/api";
import type { HomeSection } from "../types";

export async function getHomeSections(): Promise<HomeSection[]> {
  const sections = await api.get<HomeSection[]>("/api/v1/home/sections");
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => s.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
