/**
 * Phase 4 — react-query hooks for the Content Center.
 *
 * Thin data layer: components consume these hooks; they never touch
 * `apiFetch` or reason about URLs/field shapes (ADR-001/0002). Query keys
 * are exported so SSR harnesses and tests can pre-seed the cache.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminListFilters,
  Announcement,
  Banner,
  CalendarTheme,
  ContentPageResource,
  HomeSectionsOut,
  IslamicEvent,
  ResourceName,
  ScholarQuote,
  SectionOrderPatch,
  VersionRecord,
  WorkflowStatus,
  archiveResource,
  createResource,
  getCalendarTheme,
  getHomeSections,
  getPublicAnnouncements,
  getPublicBanners,
  getPublicEvents,
  getPublicNav,
  getPublicPage,
  getPublicQuotes,
  getResource,
  listResources,
  listVersions,
  reorderHomeSections,
  transitionResource,
  updateResource,
} from "./contentApi";

export const contentKeys = {
  all: ["content4"] as const,
  list: (r: ResourceName) => ["content4", r, "list"] as const,
  one: (r: ResourceName, id: string) => ["content4", r, "one", id] as const,
  versions: (r: ResourceName, id: string) => ["content4", r, "versions", id] as const,
  homeSections: ["content4", "home", "sections"] as const,
  publicNav: (locale?: string) => ["content4", "public", "nav", locale ?? "all"] as const,
  publicBanners: (placement?: string) =>
    ["content4", "public", "banners", placement ?? "all"] as const,
  publicAnnouncements: (placement?: string) =>
    ["content4", "public", "announcements", placement ?? "all"] as const,
  publicPage: (slug: string) => ["content4", "public", "page", slug] as const,
  publicEvents: (month?: number, day?: number) =>
    ["content4", "public", "events", month ?? 0, day ?? 0] as const,
  publicQuotes: (placement?: string) =>
    ["content4", "public", "quotes", placement ?? "all"] as const,
  calendarTheme: ["content4", "public", "calendar-theme"] as const,
};

export function useContentList<T>(resource: ResourceName, filters: AdminListFilters = {}) {
  return useQuery({
    queryKey: [...contentKeys.list(resource), JSON.stringify(filters)],
    queryFn: () => listResources<T>(resource, filters),
  });
}

export function useContentOne<T>(resource: ResourceName, id: string | null) {
  return useQuery({
    queryKey: contentKeys.one(resource, id ?? "none"),
    queryFn: () => getResource<T>(resource, id as string),
    enabled: id !== null,
  });
}

export function useContentVersions(resource: ResourceName, id: string | null) {
  return useQuery({
    queryKey: contentKeys.versions(resource, id ?? "none"),
    queryFn: () => listVersions(resource, id as string),
    enabled: id !== null,
  });
}

function useInvalidator() {
  const qc = useQueryClient();
  return (resource: ResourceName, id?: string) => {
    void qc.invalidateQueries({ queryKey: contentKeys.list(resource) });
    if (id) void qc.invalidateQueries({ queryKey: contentKeys.one(resource, id) });
    if (id) void qc.invalidateQueries({ queryKey: contentKeys.versions(resource, id) });
    // The generic phase-2 control-center list also reflects publish state.
    void qc.invalidateQueries({ queryKey: ["content-items"] });
  };
}

export function useCreateContent<T>(resource: ResourceName) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createResource<T>(resource, body),
    onSuccess: () => invalidate(resource),
  });
}

export function useUpdateContent<T>(resource: ResourceName) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      updateResource<T>(resource, id, body),
    onSuccess: (_d, v) => invalidate(resource, v.id),
  });
}

export function useArchiveContent<T>(resource: ResourceName) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (id: string) => archiveResource<T>(resource, id),
    onSuccess: (_d, id) => invalidate(resource, id),
  });
}

/**
 * §9 workflow transition. The backend emits the domain event
 * (content.<resource>.published …) that the CRM live feed shows —
 * publications therefore surface in the feed without any client-side emit.
 */
export function useTransitionContent<T>(resource: ResourceName) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: WorkflowStatus }) =>
      transitionResource<T>(resource, id, to),
    onSuccess: (_d, v) => invalidate(resource, v.id),
  });
}

export function useHomeSections() {
  return useQuery({
    queryKey: contentKeys.homeSections,
    queryFn: getHomeSections,
  });
}

export function useReorderHomeSections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sections: SectionOrderPatch[]) => reorderHomeSections(sections),
    onSuccess: (data: HomeSectionsOut) => {
      qc.setQueryData(contentKeys.homeSections, data);
      void qc.invalidateQueries({ queryKey: contentKeys.homeSections });
    },
  });
}

/* Resource-specific aliases keep call-sites readable. */
export const useEvents = () => useContentList<IslamicEvent>("events");
export const useEvent = (id: string | null) => useContentOne<IslamicEvent>("events", id);
export const useBanners = () => useContentList<Banner>("banners");
export const useBanner = (id: string | null) => useContentOne<Banner>("banners", id);
export const useQuotes = () => useContentList<ScholarQuote>("quotes");
export const useQuote = (id: string | null) => useContentOne<ScholarQuote>("quotes", id);
export const usePages = () => useContentList<ContentPageResource>("pages");
export const usePage = (id: string | null) => useContentOne<ContentPageResource>("pages", id);
export const useAnnouncements = () => useContentList<Announcement>("announcements");
export const useAnnouncement = (id: string | null) =>
  useContentOne<Announcement>("announcements", id);

/* Public reads — published-only views, used by previews and status widgets. */
export const usePublicNav = (locale?: string) =>
  useQuery({
    queryKey: contentKeys.publicNav(locale),
    queryFn: () => getPublicNav(locale),
  });
export const usePublicBanners = (placement?: string) =>
  useQuery({
    queryKey: contentKeys.publicBanners(placement),
    queryFn: () => getPublicBanners(placement),
  });
export const usePublicAnnouncements = (placement?: string) =>
  useQuery({
    queryKey: contentKeys.publicAnnouncements(placement),
    queryFn: () => getPublicAnnouncements(placement),
  });
export const usePublicPage = (slug: string | null) =>
  useQuery({
    queryKey: contentKeys.publicPage(slug ?? "none"),
    queryFn: () => getPublicPage(slug as string),
    enabled: slug !== null,
  });
export const usePublicEvents = (month?: number, day?: number) =>
  useQuery({
    queryKey: contentKeys.publicEvents(month, day),
    queryFn: () => getPublicEvents(month, day),
  });
export const usePublicQuotes = (placement?: string) =>
  useQuery({
    queryKey: contentKeys.publicQuotes(placement),
    queryFn: () => getPublicQuotes(placement),
  });
export const useCalendarTheme = () =>
  useQuery({
    queryKey: contentKeys.calendarTheme,
    queryFn: (): Promise<CalendarTheme> => getCalendarTheme(),
    staleTime: 5 * 60 * 1000,
  });
export type { VersionRecord };
