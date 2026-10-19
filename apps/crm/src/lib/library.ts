import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, apiUpload, apiUrl, getAccessToken } from "./api";
import {
  EMPTY_L10N,
  WORKFLOW_TRANSITIONS,
  type LocalizedText,
  type WorkflowStatus,
} from "./contentApi";

/**
 * Library DMS service — Phase 9 (Track 3, CRM).
 *
 * Management-plane client over the Track 1 backend contract
 * (`/api/v1/admin/library/*`). ADR-001: all parsing, defaults, workflow
 * rules, and API access live here — components only render.
 *
 * Contract (exact):
 * - GET    /api/v1/admin/library/items?kind=&workflow_status=&q=  (paginated)
 * - POST   /api/v1/admin/library/items            (multipart: file + metadata JSON) → draft
 * - PUT    /api/v1/admin/library/items/{id}       (edit; backend archives a version)
 * - POST   /api/v1/admin/library/items/{id}/transition   {to[, note]}
 * - GET    /api/v1/admin/library/items/{id}/versions
 * - POST   /api/v1/admin/library/items/{id}/versions/{v}/revert   {note?}
 * - POST   /api/v1/admin/library/items/{id}/index-ai
 * - POST   /api/v1/admin/library/import           (programmatic create → in_review)
 *
 * Assumptions beyond the contract (flagged for Track 1 confirmation):
 * - GET /api/v1/admin/library/items/{id} exists for the detail tabs.
 * - PUT accepts multipart (file + metadata) when a replacement media file
 *   or a new cover is attached; JSON otherwise.
 * - transition accepts an optional `note` (review audit note).
 * - Re-running transcription/OCR is expressed as PUT resetting
 *   transcript_status to "pending" — the spec's `media` queue picks up
 *   pending items (STT Whisper / Tesseract OCR).
 */

export function errText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type LibraryKind = "video" | "video_360" | "pdf" | "audio" | "mindmap";
/** The shared Phase-0 workflow state machine (spec: no separate implementation). */
export type LibraryWorkflow = WorkflowStatus;
export type LibraryVisibility = "public" | "members" | "scholars_only" | "private";
export type AiScope = "fatwa" | "assistant" | "quiz" | "verification" | "semantic_search";
export type TranscriptStatus = "pending" | "processing" | "done" | "failed";
export type DownloadPolicy = "allowed" | "watermarked" | "disabled";
export type TelegramPolicy = "never" | "manual" | "auto" | "scheduled";
export type SourceType = "upload" | "telegram_import" | "external" | "generated";

export const LIBRARY_KINDS: LibraryKind[] = ["video", "video_360", "pdf", "audio", "mindmap"];
export const LIBRARY_WORKFLOWS: LibraryWorkflow[] = [
  "draft",
  "in_review",
  "approved",
  "published",
  "rejected",
  "archived",
];
export const LIBRARY_VISIBILITIES: LibraryVisibility[] = [
  "public",
  "members",
  "scholars_only",
  "private",
];
export const AI_SCOPES: AiScope[] = ["fatwa", "assistant", "quiz", "verification", "semantic_search"];
export const DOWNLOAD_POLICIES: DownloadPolicy[] = ["allowed", "watermarked", "disabled"];
export const TELEGRAM_POLICIES: TelegramPolicy[] = ["never", "manual", "auto", "scheduled"];

/**
 * The shared Phase-0 workflow state machine, reused verbatim (Phase 9 spec:
 * library items ride the same machine, not a separate implementation).
 * The backend is authoritative; this only decides which buttons the UI offers.
 */
export const NEXT_TRANSITIONS: Record<LibraryWorkflow, LibraryWorkflow[]> = WORKFLOW_TRANSITIONS;

/** AI indexing is a separate step from publication (Phase 9 spec). */
export function canIndexAi(status: LibraryWorkflow): boolean {
  return status === "approved" || status === "published";
}

/** Accept attribute per kind for the file picker (presentation data). */
export const KIND_ACCEPT: Record<LibraryKind, string> = {
  video: "video/*",
  video_360: "video/*",
  pdf: "application/pdf,.pdf",
  audio: "audio/*",
  mindmap: ".json,.mm,image/*,application/json",
};

export interface VideoChapter {
  time_seconds: number;
  label: string;
}

/** Per-kind editor settings, round-tripped inside the metadata JSON. */
export interface LibrarySettings {
  // pdf
  pdf_toc?: boolean;
  pdf_search?: boolean;
  pdf_tts?: boolean;
  pdf_download?: boolean;
  pdf_watermark?: boolean;
  related_item_ids?: string[];
  // audio
  audio_speed_control?: boolean;
  audio_seek_allowed?: boolean;
  audio_mini_player?: boolean;
  audio_loudness_note?: string;
  // video
  chapters?: VideoChapter[];
  captions_note?: string;
  quality_variants_note?: string;
  // 360°
  projection?: "equirectangular";
  place_ref?: string;
  device_note?: string;
}

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  title: LocalizedText;
  description: LocalizedText;
  scholar_id: string | null;
  /** Tolerant: the backend may enrich the row with a display name. */
  scholar_name: string | null;
  topic_tags: string[];
  visibility: LibraryVisibility;
  workflow_status: LibraryWorkflow;
  version: number;
  ai_scopes: AiScope[];
  include_in_fatwa_rag: boolean;
  ai_indexed: boolean;
  ai_indexed_at: string | null;
  download_policy: DownloadPolicy;
  telegram_policy: TelegramPolicy;
  placements: string[];
  transcript: string;
  transcript_status: TranscriptStatus;
  ocr_text: string;
  duration_seconds: number | null;
  mime_type: string;
  source_type: SourceType;
  source_ref: string;
  cover_url: string;
  media_url: string;
  settings: LibrarySettings;
  created_at: string;
  updated_at: string;
}

export interface LibraryVersion {
  version: number;
  created_at: string;
  created_by: string | null;
  /** Short human summary of what changed in this version. */
  summary: string;
  note: string | null;
}

export interface LibraryPage {
  items: LibraryItem[];
  total: number;
  next_cursor: string | null;
}

export interface LibraryFilters {
  kind?: string;
  workflow_status?: string;
  q?: string;
  cursor?: string;
}

/* ------------------------------------------------------------------ */
/* parsing (tolerant)                                                  */
/* ------------------------------------------------------------------ */

function parseId(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function parseNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseOptStr(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parseBool(v: unknown): boolean {
  return v === true;
}

function parseL10n(v: unknown): LocalizedText {
  const out: LocalizedText = { ...EMPTY_L10N };
  if (!v || typeof v !== "object") return out;
  const r = v as Record<string, unknown>;
  for (const l of ["fa", "ar", "en"] as const) {
    if (typeof r[l] === "string") out[l] = r[l];
  }
  return out;
}

function parseStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && !!x);
}

function parseKind(v: unknown): LibraryKind {
  return (LIBRARY_KINDS as string[]).includes(typeof v === "string" ? v : "")
    ? (v as LibraryKind)
    : "video";
}

function parseWorkflow(v: unknown): LibraryWorkflow {
  return (LIBRARY_WORKFLOWS as string[]).includes(typeof v === "string" ? v : "")
    ? (v as LibraryWorkflow)
    : "draft";
}

function parseVisibility(v: unknown): LibraryVisibility {
  return (LIBRARY_VISIBILITIES as string[]).includes(typeof v === "string" ? v : "")
    ? (v as LibraryVisibility)
    : "private";
}

function parseAiScopes(v: unknown): AiScope[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is AiScope => (AI_SCOPES as string[]).includes(x));
}

function parseTranscriptStatus(v: unknown): TranscriptStatus {
  const ok = ["pending", "processing", "done", "failed"];
  return typeof v === "string" && ok.includes(v) ? (v as TranscriptStatus) : "pending";
}

function parseDownloadPolicy(v: unknown): DownloadPolicy {
  return (DOWNLOAD_POLICIES as string[]).includes(typeof v === "string" ? v : "")
    ? (v as DownloadPolicy)
    : "disabled";
}

function parseTelegramPolicy(v: unknown): TelegramPolicy {
  return (TELEGRAM_POLICIES as string[]).includes(typeof v === "string" ? v : "")
    ? (v as TelegramPolicy)
    : "never";
}

function parseSourceType(v: unknown): SourceType {
  const ok = ["upload", "telegram_import", "external", "generated"];
  return typeof v === "string" && ok.includes(v) ? (v as SourceType) : "upload";
}

function parseChapters(v: unknown): VideoChapter[] {
  if (!Array.isArray(v)) return [];
  const out: VideoChapter[] = [];
  for (const c of v) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const t = typeof r.time_seconds === "number" ? r.time_seconds : NaN;
    const label = typeof r.label === "string" ? r.label : "";
    if (Number.isFinite(t) && t >= 0 && label) out.push({ time_seconds: t, label });
  }
  out.sort((a, b) => a.time_seconds - b.time_seconds);
  return out;
}

function parseSettings(v: unknown): LibrarySettings {
  if (!v || typeof v !== "object") return {};
  const r = v as Record<string, unknown>;
  const b = (k: string): boolean | undefined =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : undefined;
  const s = (k: string): string | undefined =>
    typeof r[k] === "string" ? (r[k] as string) : undefined;
  const out: LibrarySettings = {};
  const pdfToc = b("pdf_toc");
  if (pdfToc !== undefined) out.pdf_toc = pdfToc;
  const pdfSearch = b("pdf_search");
  if (pdfSearch !== undefined) out.pdf_search = pdfSearch;
  const pdfTts = b("pdf_tts");
  if (pdfTts !== undefined) out.pdf_tts = pdfTts;
  const pdfDownload = b("pdf_download");
  if (pdfDownload !== undefined) out.pdf_download = pdfDownload;
  const pdfWatermark = b("pdf_watermark");
  if (pdfWatermark !== undefined) out.pdf_watermark = pdfWatermark;
  const rel = parseStrList(r.related_item_ids);
  if (rel.length > 0) out.related_item_ids = rel;
  const spd = b("audio_speed_control");
  if (spd !== undefined) out.audio_speed_control = spd;
  const seek = b("audio_seek_allowed");
  if (seek !== undefined) out.audio_seek_allowed = seek;
  const mini = b("audio_mini_player");
  if (mini !== undefined) out.audio_mini_player = mini;
  const loud = s("audio_loudness_note");
  if (loud !== undefined) out.audio_loudness_note = loud;
  const chapters = parseChapters(r.chapters);
  if (chapters.length > 0) out.chapters = chapters;
  const cap = s("captions_note");
  if (cap !== undefined) out.captions_note = cap;
  const qv = s("quality_variants_note");
  if (qv !== undefined) out.quality_variants_note = qv;
  if (r.projection === "equirectangular") out.projection = "equirectangular";
  const place = s("place_ref");
  if (place !== undefined) out.place_ref = place;
  const dev = s("device_note");
  if (dev !== undefined) out.device_note = dev;
  return out;
}

export function parseLibraryItem(raw: unknown): LibraryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  return {
    id: parseId(r.id),
    kind: parseKind(r.kind),
    title: parseL10n(r.title),
    description: parseL10n(r.description),
    scholar_id: parseOptStr(r.scholar_id),
    scholar_name: parseOptStr(r.scholar_name),
    topic_tags: parseStrList(r.topic_tags),
    visibility: parseVisibility(r.visibility),
    workflow_status: parseWorkflow(r.workflow_status),
    version: parseNum(r.version, 1),
    ai_scopes: parseAiScopes(r.ai_scopes),
    include_in_fatwa_rag: parseBool(r.include_in_fatwa_rag),
    ai_indexed: parseBool(r.ai_indexed),
    ai_indexed_at: parseOptStr(r.ai_indexed_at),
    download_policy: parseDownloadPolicy(r.download_policy),
    telegram_policy: parseTelegramPolicy(r.telegram_policy),
    placements: parseStrList(r.placements),
    transcript: parseStr(r.transcript),
    transcript_status: parseTranscriptStatus(r.transcript_status),
    ocr_text: parseStr(r.ocr_text),
    duration_seconds:
      typeof r.duration_seconds === "number" && Number.isFinite(r.duration_seconds)
        ? r.duration_seconds
        : null,
    mime_type: parseStr(r.mime_type),
    source_type: parseSourceType(r.source_type),
    source_ref: parseStr(r.source_ref),
    cover_url: parseStr(r.cover_url),
    media_url: parseStr(r.media_url),
    settings: parseSettings(r.settings),
    created_at: parseStr(r.created_at),
    updated_at: parseStr(r.updated_at),
  };
}

function parseLibraryVersion(raw: unknown): LibraryVersion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version == null) return null;
  return {
    version: parseNum(r.version, 0),
    created_at: parseStr(r.created_at),
    created_by: parseOptStr(r.created_by),
    summary: parseStr(r.summary) || `v${parseNum(r.version, 0)}`,
    note: parseOptStr(r.note),
  };
}

function parseLibraryPage(raw: unknown): LibraryPage {
  const items: LibraryItem[] = [];
  let total = 0;
  let nextCursor: string | null = null;
  const push = (v: unknown): void => {
    const p = parseLibraryItem(v);
    if (p) items.push(p);
  };
  if (Array.isArray(raw)) {
    raw.forEach(push);
    total = items.length;
  } else if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const list = Array.isArray(r.items) ? r.items : [];
    list.forEach(push);
    total = parseNum(r.total, items.length);
    nextCursor = parseOptStr(r.next_cursor);
  }
  return { items, total, next_cursor: nextCursor };
}

/** Convert a canvas data-URL (captured video frame) into a File for upload. */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head ?? "")?.[1] ?? "image/png";
  const bin = atob(b64 ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes.buffer], name, { type: mime });
}

/** mm:ss (or h:mm:ss) — pure presentation formatting, kept out of components. */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ------------------------------------------------------------------ */
/* query keys                                                          */
/* ------------------------------------------------------------------ */

export const LIBRARY_KEYS = {
  items: (filters: LibraryFilters) =>
    ["library", "items", filters.kind ?? "", filters.workflow_status ?? "", filters.q ?? "", filters.cursor ?? ""] as const,
  item: (id: string) => ["library", "item", id] as const,
  versions: (id: string) => ["library", "versions", id] as const,
};

/* ------------------------------------------------------------------ */
/* fetchers                                                            */
/* ------------------------------------------------------------------ */

const BASE = "/api/v1/admin/library";

function itemsQuery(filters: LibraryFilters): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.workflow_status) params.set("workflow_status", filters.workflow_status);
  if (filters.q) params.set("q", filters.q);
  if (filters.cursor) params.set("cursor", filters.cursor);
  const s = params.toString();
  return s ? `${BASE}/items?${s}` : `${BASE}/items`;
}

export async function fetchLibraryItems(filters: LibraryFilters): Promise<LibraryPage> {
  const raw = await apiFetch<unknown>(itemsQuery(filters));
  return parseLibraryPage(raw);
}

export async function fetchLibraryItem(id: string): Promise<LibraryItem> {
  const raw = await apiFetch<unknown>(`${BASE}/items/${encodeURIComponent(id)}`);
  const item = parseLibraryItem(raw);
  if (!item) throw new Error("malformed library item");
  return item;
}

export async function fetchLibraryVersions(id: string): Promise<LibraryVersion[]> {
  const raw = await apiFetch<unknown>(`${BASE}/items/${encodeURIComponent(id)}/versions`);
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).versions)
      ? ((raw as Record<string, unknown>).versions as unknown[])
      : [];
  const out: LibraryVersion[] = [];
  for (const v of list) {
    const p = parseLibraryVersion(v);
    if (p) out.push(p);
  }
  out.sort((a, b) => b.version - a.version);
  return out;
}

/* ------------------------------------------------------------------ */
/* react-query hooks                                                   */
/* ------------------------------------------------------------------ */

export function useLibraryItemsQuery(filters: LibraryFilters) {
  return useQuery({
    queryKey: LIBRARY_KEYS.items(filters),
    queryFn: () => fetchLibraryItems(filters),
    retry: false,
  });
}

export function useLibraryItemQuery(id: string | null) {
  return useQuery({
    queryKey: LIBRARY_KEYS.item(id ?? ""),
    queryFn: () => fetchLibraryItem(id as string),
    enabled: !!id,
    retry: false,
  });
}

export function useLibraryVersionsQuery(id: string | null) {
  return useQuery({
    queryKey: LIBRARY_KEYS.versions(id ?? ""),
    queryFn: () => fetchLibraryVersions(id as string),
    enabled: !!id,
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* mutation bodies                                                     */
/* ------------------------------------------------------------------ */

export interface LibraryMetadata {
  kind: LibraryKind;
  title: LocalizedText;
  description: LocalizedText;
  scholar_id: string | null;
  topic_tags: string[];
  visibility: LibraryVisibility;
  download_policy: DownloadPolicy;
  telegram_policy: TelegramPolicy;
  placements: string[];
  ai_scopes: AiScope[];
  include_in_fatwa_rag: boolean;
  transcript: string;
  transcript_status: TranscriptStatus;
  ocr_text: string;
  duration_seconds: number | null;
  settings: LibrarySettings;
}

export function defaultMetadata(kind: LibraryKind): LibraryMetadata {
  return {
    kind,
    title: { ...EMPTY_L10N },
    description: { ...EMPTY_L10N },
    scholar_id: null,
    topic_tags: [],
    visibility: "private",
    download_policy: "disabled",
    telegram_policy: "never",
    placements: [],
    ai_scopes: [],
    include_in_fatwa_rag: false,
    transcript: "",
    transcript_status: "pending",
    ocr_text: "",
    duration_seconds: null,
    settings: {},
  };
}

export function metadataFromItem(item: LibraryItem): LibraryMetadata {
  return {
    kind: item.kind,
    title: { ...item.title },
    description: { ...item.description },
    scholar_id: item.scholar_id,
    topic_tags: [...item.topic_tags],
    visibility: item.visibility,
    download_policy: item.download_policy,
    telegram_policy: item.telegram_policy,
    placements: [...item.placements],
    ai_scopes: [...item.ai_scopes],
    include_in_fatwa_rag: item.include_in_fatwa_rag,
    transcript: item.transcript,
    transcript_status: item.transcript_status,
    ocr_text: item.ocr_text,
    duration_seconds: item.duration_seconds,
    settings: { ...item.settings, chapters: item.settings.chapters?.map((c) => ({ ...c })) },
  };
}

/** Build the multipart body for create (file + metadata JSON). */
export function buildCreateForm(
  file: File,
  metadata: LibraryMetadata,
  cover: File | null,
): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("metadata", JSON.stringify(metadata));
  if (cover) form.append("cover", cover, cover.name);
  return form;
}

function useLibraryMutation<TArgs, TOut>(fn: (args: TArgs) => Promise<TOut>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

/** POST multipart → creates in `draft`. */
export function useCreateLibraryItem() {
  return useLibraryMutation((form: FormData) =>
    apiUpload<LibraryItem>(`${BASE}/items`, form).then((raw) => {
      const item = parseLibraryItem(raw);
      if (!item) throw new Error("malformed library item");
      return item;
    }),
  );
}

export interface UpdateLibraryItemArgs {
  id: string;
  metadata: LibraryMetadata;
  /** Replacement media file (optional). Sent as multipart with the metadata. */
  file?: File | null;
  /** New cover image (optional). Sent as multipart with the metadata. */
  cover?: File | null;
}

/** PUT — metadata-only edit (backend archives a version). */
export function useUpdateLibraryItem() {
  return useLibraryMutation(({ id, metadata }: UpdateLibraryItemArgs) =>
    apiFetch<unknown>(`${BASE}/items/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: metadata,
    }).then((raw) => {
      const item = parseLibraryItem(raw);
      if (!item) throw new Error("malformed library item");
      return item;
    }),
  );
}

/**
 * File-replacing update: PUT multipart (file + metadata). Kept separate from
 * the JSON edit path because apiUpload only supports POST; the bearer header
 * is attached directly (same contract as apiUpload's auth cycle).
 */
export async function putLibraryItemMultipart(
  id: string,
  metadata: LibraryMetadata,
  file: File | null,
  cover: File | null,
): Promise<LibraryItem> {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  if (file) form.append("file", file, file.name);
  if (cover) form.append("cover", cover, cover.name);
  const token = getAccessToken();
  const res = await fetch(`${apiUrl()}${BASE}/items/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = body.error.message;
    } catch {
      /* keep the status text */
    }
    const err = new Error(msg);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  const item = parseLibraryItem(await res.json());
  if (!item) throw new Error("malformed library item");
  return item;
}

export function useReplaceLibraryItem() {
  return useLibraryMutation(({ id, metadata, file, cover }: UpdateLibraryItemArgs) =>
    putLibraryItemMultipart(id, metadata, file ?? null, cover ?? null),
  );
}

/** POST /transition {to[, note]} — the shared state machine step. */
export function useTransitionLibraryItem() {
  return useLibraryMutation(
    ({ id, to, note }: { id: string; to: LibraryWorkflow; note?: string }) =>
      apiFetch<LibraryItem>(`${BASE}/items/${encodeURIComponent(id)}/transition`, {
        method: "POST",
        body: note ? { to, note } : { to },
      }).then((raw) => {
        const item = parseLibraryItem(raw);
        if (!item) throw new Error("malformed library item");
        return item;
      }),
  );
}

/** POST /versions/{v}/revert {note?} */
export function useRevertLibraryVersion() {
  return useLibraryMutation(
    ({ id, version, note }: { id: string; version: number; note?: string }) =>
      apiFetch<LibraryItem>(
        `${BASE}/items/${encodeURIComponent(id)}/versions/${version}/revert`,
        { method: "POST", body: note ? { note } : {} },
      ).then((raw) => {
        const item = parseLibraryItem(raw);
        if (!item) throw new Error("malformed library item");
        return item;
      }),
  );
}

/** POST /index-ai — AI indexing, independent of publication. */
export function useIndexLibraryItemAi() {
  return useLibraryMutation((id: string) =>
    apiFetch<LibraryItem>(`${BASE}/items/${encodeURIComponent(id)}/index-ai`, {
      method: "POST",
      body: {},
    }).then((raw) => {
      const item = parseLibraryItem(raw);
      if (!item) throw new Error("malformed library item");
      return item;
    }),
  );
}

export interface LibraryImportBody {
  kind: LibraryKind;
  title: LocalizedText;
  description: LocalizedText;
  scholar_id: string | null;
  topic_tags: string[];
  source_type: SourceType;
  source_ref: string;
  media_url: string;
  cover_url?: string;
  duration_seconds?: number | null;
}

/** POST /import — programmatic create, lands in `in_review`. */
export function useImportLibraryItem() {
  return useLibraryMutation((body: LibraryImportBody) =>
    apiFetch<LibraryItem>(`${BASE}/import`, { method: "POST", body }).then((raw) => {
      const item = parseLibraryItem(raw);
      if (!item) throw new Error("malformed library item");
      return item;
    }),
  );
}

/**
 * Re-queue transcription: POST /reprocess {job:"transcribe"} — resets status to
 * pending and enqueues the Whisper job on the `media` queue.
 */
export function useRequeueTranscription() {
  return useLibraryMutation(({ id }: { id: string; clearText: boolean }) =>
    apiFetch<LibraryItem>(`${BASE}/items/${encodeURIComponent(id)}/reprocess`, {
      method: "POST",
      body: { job: "transcribe" },
    }).then((raw) => {
      const item = parseLibraryItem(raw);
      if (!item) throw new Error("malformed library item");
      return item;
    }),
  );
}

/** Re-queue OCR: POST /reprocess {job:"ocr"} — resets status and enqueues Tesseract. */
export function useRequeueOcr() {
  return useLibraryMutation((id: string) =>
    apiFetch<LibraryItem>(`${BASE}/items/${encodeURIComponent(id)}/reprocess`, {
      method: "POST",
      body: { job: "ocr" },
    }).then((raw) => {
      const item = parseLibraryItem(raw);
      if (!item) throw new Error("malformed library item");
      return item;
    }),
  );
}
