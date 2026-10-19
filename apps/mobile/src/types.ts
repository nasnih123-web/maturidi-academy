/**
 * apps/mobile — src/types.ts
 *
 * Client-side mirror of the backend API contracts (/api/v1/*, FastAPI +
 * Pydantic v2). These are a *subset* of the server schemas: only the fields
 * the mobile app consumes are typed; extra server fields are ignored at
 * runtime. If the server adds a field, this file does not need to change
 * (engineering-contract §1 — additive changes are backward compatible).
 *
 * Pure data types — no business logic (ADR-001).
 */

export type Locale = "fa" | "ar" | "en";

/** Backend LocalizedText: either a plain string or a per-locale map. */
export type LocalizedText = string | Partial<Record<Locale, string>>;

/** Resolve a LocalizedText for a locale with fa → en fallback. */
export function resolveText(t: LocalizedText | null | undefined, locale: Locale): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  return t[locale] ?? t.fa ?? t.en ?? t.ar ?? "";
}

// ── Auth ──────────────────────────────────────────────────────────────

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  must_enroll_2fa?: boolean;
}

export interface UserMe {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  locale: Locale;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}

// ── Home ──────────────────────────────────────────────────────────────

export interface HomeSection {
  key: string;
  order: number;
  visible: boolean;
  title: LocalizedText;
  subtitle: LocalizedText | null;
  data: Record<string, unknown> | null;
}

// ── Quran ─────────────────────────────────────────────────────────────

export interface SurahSummary {
  number: number;
  name_ar: string;
  name_en: string;
  ayahs: number;
  revelation: string;
}

export interface AyahEdition {
  edition: string;
  text: string;
  audio_url: string | null;
  juz: number | null;
  page: number | null;
}

export interface Ayah {
  surah: number;
  ayah: number;
  editions: AyahEdition[];
}

export interface SurahDetail {
  surah: number;
  name_ar: string;
  name_en: string;
  ayahs: Ayah[];
  edition_ids: string[];
}

export interface QuranNote {
  id: string;
  surah: number;
  ayah: number;
  note_text: string;
  is_private: boolean;
  /** Numeric version used by the sync conflict protocol (Phase 13). */
  version: number;
  updated_at: string;
}

// ── Tasbih ────────────────────────────────────────────────────────────

export interface TasbihSession {
  id: string;
  dhikr_text: string;
  target_count: number | null;
  count: number;
  started_at: string;
  ended_at: string | null;
  completed: boolean;
}

export interface DhikrTotal {
  dhikr_text: string;
  total_count: number;
}

// ── Adhan ─────────────────────────────────────────────────────────────

export interface AdhanTimes {
  imsak: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  midnight: string;
}

export interface AdhanTimesOut {
  date: string;
  latitude: number;
  longitude: number;
  timezone_offset: number;
  method: string;
  method_label: string;
  madhab: string;
  times: AdhanTimes;
}

export type PrayerKey = keyof AdhanTimes;

// ── Fatwa ─────────────────────────────────────────────────────────────

export interface FatwaCitation {
  chunk_id: string;
  excerpt: string;
  source_citation: Record<string, unknown> | null;
  topic_category: string | null;
  madhab_scope: string | null;
}

export interface FatwaAnswer {
  session_id: string;
  answer: string | null;
  status: "answered" | "llm_unavailable" | "no_sources";
  citations: FatwaCitation[];
  ai_label: string;
  model: string | null;
}

// ── Library ───────────────────────────────────────────────────────────

export interface LibraryItem {
  id: string;
  kind: string;
  title: LocalizedText;
  description: LocalizedText | null;
  topic_tags: string[];
  visibility: string;
  workflow_status: string;
  version: number;
}

// ── LMS ───────────────────────────────────────────────────────────────

export type LessonProgressStatus = "not_started" | "in_progress" | "completed";

export interface Course {
  id: string;
  curriculum_id: string | null;
  title: LocalizedText;
  description: LocalizedText | null;
  level: string;
  visibility: string;
  lesson_count: number;
  progress_pct: number | null;
}

export interface Lesson {
  id: string;
  course_id: string;
  title: LocalizedText;
  body: unknown[];
  duration_minutes: number;
  sort_order: number;
  is_free_preview: boolean;
  status: LessonProgressStatus | null;
  position_seconds: number;
  prev_lesson_id: string | null;
  next_lesson_id: string | null;
}

// ── Social ────────────────────────────────────────────────────────────

export interface SocialPost {
  id: string;
  group_id: string | null;
  author_id: string;
  body: string;
  status: string;
  comment_count: number;
  likes_count: number;
  liked: boolean;
  created_at: string;
}

export interface FeedPage {
  items: SocialPost[];
  next_cursor: string | null;
}

// ── Sync (Phase 13 contract — ADR-0010) ────────────────────────────────

/**
 * Server entity types (apps/api/app/modules/sync/schemas.py).
 * The client maps its domain objects onto these — it never invents its own.
 */
export type SyncEntityType = "user_ayah_note" | "user_progress" | "dhikr_daily_count";
export type SyncOpType = "upsert" | "delete";
export type SyncOpStatus = "pending" | "applied" | "conflicted" | "rejected";
export type SyncConflictResolution = "keep_local" | "keep_remote" | "merged";

export interface SyncPushResult {
  client_op_id: string;
  status: SyncOpStatus;
  entity_type: string;
  entity_id: string;
  version: number | null;
  conflict_id: string | null;
  detail: string | null;
}

export interface SyncChange {
  seq: number;
  entity_type: string;
  entity_id: string;
  op_type: string;
  payload: Record<string, unknown> | null;
  version: number;
}
