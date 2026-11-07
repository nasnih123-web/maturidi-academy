/**
 * apps/mobile — src/services/hifz.ts
 *
 * Hifz REST client (mirror of apps/api/app/modules/quran/hifz_schemas.py).
 * Transport only — no session state, no audio (see hifzLive.ts,
 * hifzAudio.ts, hooks/useHifz.ts).
 *
 * Endpoints (all under /api/v1/quran/hifz; everything except /status
 * requires a signed-in user):
 * - GET  /status                          engine + phoneme-map availability
 * - POST /attempts {surah, page?}         create an attempt for a surah
 * - GET  /attempts/{id}                   attempt + word scores + mistakes
 * - POST /attempts/{id}/grade             multipart {surah, ayah, audio}
 * - POST /attempts/{id}/grade-word        multipart {surah, ayah, word_index, audio}
 * - POST /attempts/{id}/peek              {surah, ayah, word_index, kind?}
 * - POST /attempts/{id}/complete          finish the attempt
 * - GET  /settings                        per-user hifz settings (Phase 4)
 * - PUT  /settings                        update per-user hifz settings
 * - GET  /attempts/resume                 latest open session, or null
 * - PATCH /attempts/{id}/position         store the live position
 * - POST /attempts/{id}/pause | /resume   server-side pause / resume
 * - GET  /attempts/{id}/mistakes          grouped mistake sheet
 * - DELETE /mistakes/{id}                 delete one mistake
 * - POST /api/v1/auth/ws-ticket           one-time live-socket ticket (60 s)
 *
 * Audio is transient: the grade WAV is written to the cache directory
 * only to build the multipart body, and deleted right after the upload
 * (success or failure). No recording is ever kept.
 */
import { File, Paths } from "expo-file-system";
import { api } from "../lib/api";
import { encodeWav16kMono, parseWavHeader } from "../lib/hifzProtocol";

const HIFZ_BASE = "/api/v1/quran/hifz";

export interface HifzCounts {
  correct: number;
  close: number;
  wrong: number;
  skipped: number;
}

export interface HifzStatus {
  engine: string;
  available: boolean;
  reason: string;
  map_available: boolean;
  map_reason: string;
}

export interface HifzAttempt {
  id: string;
  surah: number;
  page: number | null;
  status: string;
  engine: string;
  counts: HifzCounts;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  // Phase 4 — practice range, stored position, repetition.
  start_ayah: number | null;
  end_ayah: number | null;
  current_surah: number | null;
  current_ayah: number | null;
  current_word_index: number | null;
  repeat_ayah: number;
  repeat_range: number;
}

/** Phase 4 — per-user hifz settings (freeze defaults OFF = premium). */
export interface HifzUserSettings {
  freeze_on_error: boolean;
  mistake_detection: boolean;
  tashkeel_detection: boolean;
  resumable_sessions: boolean;
  hide_ayah_markers: boolean;
}

export interface HifzMistakeGroupItem {
  id: string;
  surah: number;
  ayah: number;
  word_index: number | null;
  expected_text: string;
  heard: string | null;
  mistake_type: string;
}

export interface HifzMistakeGroup {
  surah: number;
  ayah: number;
  category: "wrong_words" | "extra_words";
  items: HifzMistakeGroupItem[];
}

export interface HifzWordScore {
  id: string;
  attempt_id: string;
  surah: number;
  ayah: number;
  word_index: number;
  expected_text: string;
  status: "correct" | "close" | "wrong" | "skipped";
  prob: number;
  heard: string | null;
  mistake_type: string | null;
  disputed: boolean;
}

export interface HifzAttemptDetail {
  attempt: HifzAttempt;
  words: HifzWordScore[];
  mistakes: unknown[];
}

export interface HifzGradeWord {
  word_index: number;
  expected: string;
  status: "correct" | "close" | "wrong" | "skipped";
  prob: number;
  heard: string | null;
  mistake_type: string | null;
}

export interface HifzGrade {
  attempt_id: string;
  surah: number;
  ayah: number;
  word_index: number | null;
  engine_used: string;
  thresholds: { green: number; amber: number };
  words: HifzGradeWord[];
  counts: HifzCounts;
  extra_words: string[];
}

export interface HifzPeek {
  mistake_id: string;
  surah: number;
  ayah: number;
  word_index: number;
  word: string;
}

export interface WsTicket {
  ticket: string;
  expires_in: number;
}

export async function getHifzStatus(): Promise<HifzStatus> {
  return api.get<HifzStatus>(`${HIFZ_BASE}/status`, { auth: false });
}

export async function createAttempt(
  surah: number,
  page?: number,
  opts?: {
    start_ayah?: number;
    end_ayah?: number;
    repeat_ayah?: number;
    repeat_range?: number;
  },
): Promise<HifzAttempt> {
  return api.post<HifzAttempt>(`${HIFZ_BASE}/attempts`, { surah, page, ...opts });
}

export async function getAttemptDetail(attemptId: string): Promise<HifzAttemptDetail> {
  return api.get<HifzAttemptDetail>(`${HIFZ_BASE}/attempts/${attemptId}`);
}

export interface HifzDashboardCounts {
  attempts: number;
  graded_words: number;
  counts: HifzCounts;
  due_count: number;
}

/** Phase 4 — hub progress counts (the same /dashboard the web hub uses). */
export async function getHifzDashboard(): Promise<HifzDashboardCounts> {
  return api.get<HifzDashboardCounts>(`${HIFZ_BASE}/dashboard`);
}

/** Phase 4 — per-user settings (server-side; guest = local defaults). */
export async function getUserSettings(): Promise<HifzUserSettings> {
  return api.get<HifzUserSettings>(`${HIFZ_BASE}/settings`);
}

export async function updateUserSettings(
  settings: Partial<HifzUserSettings>,
): Promise<HifzUserSettings> {
  return api.put<HifzUserSettings>(`${HIFZ_BASE}/settings`, settings);
}

/** Phase 4 — the latest open session, or null (never a 404). */
export async function getResumableAttempt(): Promise<HifzAttempt | null> {
  return api.get<HifzAttempt | null>(`${HIFZ_BASE}/attempts/resume`);
}

/** Phase 4 — store the live position for resume-after-leaving. */
export async function updatePosition(
  attemptId: string,
  position: { current_surah?: number; current_ayah?: number; current_word_index?: number },
): Promise<HifzAttempt> {
  return api.patch<HifzAttempt>(`${HIFZ_BASE}/attempts/${attemptId}/position`, position);
}

/** Phase 4 — server-side pause / resume (the study page used to pause client-only). */
export async function pauseAttempt(attemptId: string): Promise<HifzAttempt> {
  return api.post<HifzAttempt>(`${HIFZ_BASE}/attempts/${attemptId}/pause`);
}

export async function resumeAttempt(attemptId: string): Promise<HifzAttempt> {
  return api.post<HifzAttempt>(`${HIFZ_BASE}/attempts/${attemptId}/resume`);
}

/** Phase 4 — grouped mistake sheet (one card per ayah). */
export async function getGroupedMistakes(attemptId: string): Promise<HifzMistakeGroup[]> {
  return api.get<HifzMistakeGroup[]>(`${HIFZ_BASE}/attempts/${attemptId}/mistakes`);
}

/** Phase 4 — delete one mistake from the sheet (no bulk delete). */
export async function deleteMistake(mistakeId: string): Promise<void> {
  await api.del(`${HIFZ_BASE}/mistakes/${mistakeId}`);
}

export async function completeAttempt(attemptId: string): Promise<HifzAttempt> {
  return api.post<HifzAttempt>(`${HIFZ_BASE}/attempts/${attemptId}/complete`);
}

export async function peekWord(
  attemptId: string,
  surah: number,
  ayah: number,
  wordIndex: number,
  kind: "word" | "ayah" = "word",
): Promise<HifzPeek> {
  return api.post<HifzPeek>(`${HIFZ_BASE}/attempts/${attemptId}/peek`, {
    surah,
    ayah,
    word_index: wordIndex,
    kind,
  });
}

export async function issueWsTicket(): Promise<WsTicket> {
  return api.post<WsTicket>("/api/v1/auth/ws-ticket");
}

/**
 * Upload one ayah's recitation for grading. `pcm` must be raw PCM16
 * mono 16 kHz (the capture layer records at that rate natively).
 * The WAV is built locally, written to the cache dir for the multipart
 * body, and deleted immediately after the upload — in all cases.
 */
export async function gradeAyah(
  attemptId: string,
  surah: number,
  ayah: number,
  pcm: Uint8Array,
): Promise<HifzGrade> {
  return uploadGrade(`${HIFZ_BASE}/attempts/${attemptId}/grade`, { surah, ayah }, pcm);
}

export async function gradeWord(
  attemptId: string,
  surah: number,
  ayah: number,
  wordIndex: number,
  pcm: Uint8Array,
): Promise<HifzGrade> {
  return uploadGrade(
    `${HIFZ_BASE}/attempts/${attemptId}/grade-word`,
    { surah, ayah, word_index: wordIndex },
    pcm,
  );
}

async function uploadGrade(
  path: string,
  fields: { surah: number; ayah: number; word_index?: number },
  pcm: Uint8Array,
): Promise<HifzGrade> {
  if (pcm.length === 0) throw new Error("empty-audio");
  const wav = encodeWav16kMono(pcm);
  const header = parseWavHeader(wav);
  if (!header || header.channels !== 1 || header.sampleRate !== 16000 || header.bitsPerSample !== 16) {
    throw new Error("invalid-wav");
  }
  const file = new File(Paths.cache, `hifz-grade-${Date.now()}.wav`);
  try {
    file.create({ overwrite: true });
    await file.write(wav);
    const form = new FormData();
    form.append("surah", String(fields.surah));
    form.append("ayah", String(fields.ayah));
    if (fields.word_index !== undefined) form.append("word_index", String(fields.word_index));
    // React Native FormData file part (uri/name/type).
    form.append("audio", { uri: file.uri, name: "recitation.wav", type: "audio/wav" } as unknown as Blob);
    return await api.postForm<HifzGrade>(path, form);
  } finally {
    // Transient by design: the recording never outlives the grade call.
    try {
      file.delete();
    } catch {
      // Already gone — nothing to clean up.
    }
  }
}
