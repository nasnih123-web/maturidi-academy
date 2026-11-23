'use client';

/**
 * quran-children — logic for the Quran children section (Phase 4).
 *
 * Presentation/logic separation (§15.6): every API call, download and
 * scoring helper lives here; components only render and wire events.
 *
 * API contract: /api/v1/quran/children (see apps/api/app/modules/quran/
 * children/). Videos + quiz are public; progress, dashboard and quiz
 * submit need a signed-in user (401 → the UI shows the sign-in hint
 * and, for the quiz, scores locally from the payload instead).
 *
 * Offline packs: the backend returns a MANIFEST (self-hosted ayah
 * texts + the surah audio URL + word timings when available). The
 * audio bytes are never bundled or mirrored — the client downloads
 * the same URL the player streams and the service worker caches it
 * (public/sw.js, ma-audio-v1) so the surah plays offline. The
 * manifest + texts are stored in IndexedDB (offline-db PackEntry)
 * as the download record.
 */
import { authJson } from '@/lib/auth-client';
import { registerPackEntry } from '@/lib/offline-db';

/** Service-worker audio cache — must match AUDIO_CACHE in public/sw.js. */
export const CHILDREN_AUDIO_CACHE = 'ma-audio-v1';

/** The 12 reciters with real word segments (Quran.com v4 ids). */
export const CHILDREN_LISTEN_RECITERS = [
  'alafasy',
  'husary',
  'minshawi',
  'minshawi_mujawwad',
  'husary_muallim',
  'abdul_basit',
  'abdul_basit_mujawwad',
  'sudais',
  'shatri',
  'hani_rifai',
  'shuraym',
  'tablawi',
] as const;

export const CHILDREN_DEFAULT_RECITER = 'alafasy';
export const CHILDREN_RECITER_STORAGE_KEY = 'children-reciter';
export const CHILDREN_DAILY_GOAL_SURAHS = 3;

export type LocalizedText = Record<string, string>;

/** Persian-first text resolution — mirrors the backend `_text`. */
export function pickLocalizedText(
  d: LocalizedText | null | undefined,
  locale: string,
): string {
  if (!d || typeof d !== 'object') return '';
  return (
    d[locale] ?? d.fa ?? d.ar ?? d.en ?? Object.values(d)[0] ?? ''
  );
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function toFaDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Locale-aware digits (fa → ۱۲۳, ar → ١٢٣, en → 123). */
export function formatNum(n: number | string, locale: string): string {
  try {
    return new Intl.NumberFormat(
      locale === 'fa' ? 'fa-IR' : locale,
    ).format(Number(n));
  } catch {
    return String(n);
  }
}

/** Deterministic shuffle (seeded by surah) — stable across renders. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function isAuthError401(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: unknown }).status === 401
  );
}

// ---------------------------------------------------------------------------
// API types (snake_case wire, as the backend returns it)
// ---------------------------------------------------------------------------

export interface ChildrenVideo {
  id: string;
  surah: number;
  position: number;
  item_id: string;
  title: LocalizedText;
  /** youtube | aparat | direct | upload */
  source: string;
  source_label: string;
  external_url: string | null;
  embed_url: string | null;
  stream_url: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
}

export interface ChildrenMcqPayload {
  question: LocalizedText;
  options: LocalizedText[];
  correct_index: number;
  explanation?: LocalizedText | null;
}

export interface ChildrenMatchingPair {
  /** Plain Arabic word — the answer-map key. */
  word: string;
  meaning: LocalizedText;
}

export interface ChildrenMatchingPayload {
  pairs: ChildrenMatchingPair[];
}

export interface ChildrenQuestion {
  id: string;
  surah: number;
  question_type: 'mcq' | 'matching';
  source: 'auto' | 'crm';
  payload: ChildrenMcqPayload | ChildrenMatchingPayload;
}

export function isMcqPayload(
  p: ChildrenQuestion['payload'],
): p is ChildrenMcqPayload {
  return Array.isArray((p as ChildrenMcqPayload).options);
}

export interface ChildrenQuizResult {
  correct_count: number;
  total: number;
  stars: number;
  stars_added: number;
  completed: boolean;
}

export interface ChildrenProgress {
  surah: number;
  stars: number;
  /** learning | completed */
  status: string;
  last_ayah: number;
  listened_ayahs: number;
  quiz_done: boolean;
  match_done: boolean;
  updated_at: string | null;
}

export interface ChildrenJuzProgress {
  juz: number;
  total_surahs: number;
  completed_surahs: number;
  started_surahs: number;
  /** done | started | current | locked */
  state: string;
}

export interface ChildrenWeekDay {
  date: string;
  label: string;
  active: boolean;
  is_today: boolean;
}

export interface ChildrenDashboardSurah {
  surah: number;
  name_ar: string;
  name_en: string;
  stars: number;
  last_ayah?: number;
  ayahs?: number;
}

export interface ChildrenDashboard {
  total_stars: number;
  learned_count: number;
  streak_current: number;
  streak_best: number;
  goal_surahs: number;
  goal_today_surahs: number;
  goal_met: boolean;
  today_surahs: ChildrenDashboardSurah[];
  week: ChildrenWeekDay[];
  weak_surahs: ChildrenDashboardSurah[];
  continue_surah: ChildrenDashboardSurah | null;
  juz_progress: ChildrenJuzProgress[];
  progress: ChildrenProgress[];
}

export interface ChildrenOfflinePack {
  surah: number;
  reciter: string;
  audio_url: string | null;
  timing_available: boolean;
  timing: unknown | null;
  ayahs: { number: number; text: string }[];
}

export interface ChildrenWholeQuranPack {
  reciter: string;
  surahs: { surah: number; name_ar: string; pack_url: string }[];
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const BASE = '/api/v1/quran/children';

export async function fetchChildrenVideos(
  surah: number,
): Promise<ChildrenVideo[]> {
  return authJson<ChildrenVideo[]>(`${BASE}/surahs/${surah}/videos`);
}

export async function fetchChildrenQuiz(
  surah: number,
  questionType?: 'mcq' | 'matching',
): Promise<ChildrenQuestion[]> {
  const q = questionType ? `?question_type=${questionType}` : '';
  return authJson<ChildrenQuestion[]>(`${BASE}/surahs/${surah}/quiz${q}`);
}

export async function submitChildrenQuiz(
  surah: number,
  questionType: 'mcq' | 'matching',
  answers: Record<string, unknown>,
): Promise<ChildrenQuizResult> {
  return authJson<ChildrenQuizResult>(`${BASE}/surahs/${surah}/quiz/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_type: questionType, answers }),
  });
}

export async function recordChildrenListen(
  surah: number,
  lastAyah: number,
): Promise<ChildrenProgress> {
  return authJson<ChildrenProgress>(`${BASE}/progress/listen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surah, last_ayah: lastAyah }),
  });
}

export async function fetchChildrenProgress(): Promise<ChildrenProgress[]> {
  return authJson<ChildrenProgress[]>(`${BASE}/progress`);
}

export async function fetchChildrenDashboard(): Promise<ChildrenDashboard> {
  return authJson<ChildrenDashboard>(`${BASE}/dashboard`);
}

export async function fetchChildrenOfflinePack(
  surah: number,
  reciter: string,
): Promise<ChildrenOfflinePack> {
  return authJson<ChildrenOfflinePack>(
    `${BASE}/offline-pack?surah=${surah}&reciter=${encodeURIComponent(reciter)}`,
  );
}

export async function fetchChildrenWholeQuranPack(
  reciter: string,
): Promise<ChildrenWholeQuranPack> {
  return authJson<ChildrenWholeQuranPack>(
    `${BASE}/offline-pack/whole-quran?reciter=${encodeURIComponent(reciter)}`,
  );
}

/**
 * Uthmani ayah texts for one surah (public endpoint) — the V2 mushaf
 * expansion is strict: a page that straddles two surahs needs every
 * ayah's tokens on that page, so the study view fetches the
 * neighbouring surah's texts client-side when the page needs them.
 */
export async function fetchSurahAyahTexts(
  surah: number,
): Promise<Record<number, string>> {
  const body = await authJson<{
    ayahs?: {
      ayah: number;
      editions?: { edition: string; text: string }[];
    }[];
  }>(`/api/v1/quran/surah/${surah}`);
  const out: Record<number, string> = {};
  for (const a of body.ayahs ?? []) {
    const uthmani = (a.editions ?? []).find(
      (e) => e.edition === 'quran-uthmani',
    );
    const first = (a.editions ?? [])[0];
    const text = uthmani?.text ?? first?.text ?? '';
    if (text) out[a.ayah] = text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guest fallback: score locally from the payload (the server scores the
// same way — correct_index for MCQ, every pair exact for matching).
// Stars follow the backend `_mcq_stars`: all → 3, ≥1 → 2, 0 → 1.
// ---------------------------------------------------------------------------

export function mcqStars(correct: number, total: number): number {
  if (total <= 0) return 0;
  if (correct >= total) return 3;
  if (correct >= 1) return 2;
  return 1;
}

export function scoreMcqLocal(
  questions: ChildrenQuestion[],
  answers: Record<string, number>,
): ChildrenQuizResult {
  const mcqs = questions.filter((q) => q.question_type === 'mcq');
  let correct = 0;
  for (const q of mcqs) {
    const p = q.payload as ChildrenMcqPayload;
    if (answers[q.id] === p.correct_index) correct += 1;
  }
  return {
    correct_count: correct,
    total: mcqs.length,
    stars: mcqStars(correct, mcqs.length),
    stars_added: 0,
    completed: correct === mcqs.length && mcqs.length > 0,
  };
}

export function scoreMatchingLocal(
  questions: ChildrenQuestion[],
  answers: Record<string, Record<string, string>>,
): ChildrenQuizResult {
  const matchings = questions.filter((q) => q.question_type === 'matching');
  let correct = 0;
  for (const q of matchings) {
    const pairs = (q.payload as ChildrenMatchingPayload).pairs ?? [];
    const given = answers[q.id] ?? {};
    const ok =
      pairs.length > 0 &&
      pairs.every(
        (pair) =>
          typeof given[pair.word] === 'string' &&
          given[pair.word].trim() ===
            pickLocalizedText(pair.meaning, 'fa').trim(),
      );
    if (ok) correct += 1;
  }
  return {
    correct_count: correct,
    total: matchings.length,
    stars: correct >= matchings.length && matchings.length > 0 ? 1 : 0,
    stars_added: 0,
    completed: correct === matchings.length && matchings.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Offline downloads — the service worker (ma-audio-v1) caches the audio
// URL on any fetch; the page download is a plain no-cors fetch so both
// CDNs work (AlQuran Cloud sends no CORS headers, QuranicAudio does).
// A cached URL plays offline through the worker; the IndexedDB entry
// is the download record (same pattern as OfflineSettingsClient).
// ---------------------------------------------------------------------------

export async function isAudioCached(url: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(CHILDREN_AUDIO_CACHE);
    return (await cache.match(url)) !== undefined;
  } catch {
    return false;
  }
}

async function downloadAudio(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { mode: 'no-cors' });
    // no-cors → opaque; ok is false but the worker cached it when
    // the response arrived (res.type === 'opaque' means it went
    // through). A network failure throws instead.
    return res.type === 'opaque' || res.ok;
  } catch {
    return false;
  }
}

export async function downloadSurahPack(
  surah: number,
  reciter: string,
): Promise<{ ok: boolean; audioUrl: string | null }> {
  const pack = await fetchChildrenOfflinePack(surah, reciter);
  if (!pack.audio_url) return { ok: false, audioUrl: null };
  const ok = await downloadAudio(pack.audio_url);
  if (ok) {
    await registerPackEntry({
      key: `children-surah:${surah}:${reciter}`,
      kind: 'item',
      ref: `children-surah-${surah}`,
      etag: null,
    });
  }
  return { ok, audioUrl: pack.audio_url };
}

export interface WholeQuranDownloadProgress {
  done: number;
  total: number;
  failed: number;
}

export async function downloadWholeQuranPack(
  reciter: string,
  onProgress: (p: WholeQuranDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<WholeQuranDownloadProgress> {
  const manifest = await fetchChildrenWholeQuranPack(reciter);
  const total = manifest.surahs.length;
  let done = 0;
  let failed = 0;
  for (const entry of manifest.surahs) {
    if (signal?.aborted) break;
    try {
      const pack = await fetchChildrenOfflinePack(entry.surah, reciter);
      if (!pack.audio_url) {
        failed += 1;
      } else if (await downloadAudio(pack.audio_url)) {
        done += 1;
        await registerPackEntry({
          key: `children-surah:${entry.surah}:${reciter}`,
          kind: 'item',
          ref: `children-surah-${entry.surah}`,
          etag: null,
        });
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
    onProgress({ done, total, failed });
  }
  return { done, total, failed };
}

// ---------------------------------------------------------------------------
// Labels — one nested object, built by the RSC page (mirrors hifz:).
// ---------------------------------------------------------------------------

export interface ChildrenLabels {
  homeTitle: string;
  homeSubtitle: string;
  goalTitle: string;
  goalOf: string;
  goalMet: string;
  todayTitle: string;
  todayEmpty: string;
  weekTitle: string;
  streakTitle: string;
  starsTitle: string;
  learnedTitle: string;
  juzMapTitle: string;
  continueTitle: string;
  continueFrom: string;
  retryTitle: string;
  weakEmpty: string;
  signInTitle: string;
  signInHint: string;
  signInButton: string;
  error: string;
  retry: string;
  listTitle: string;
  listSearchPlaceholder: string;
  filterAll: string;
  filterJuz30: string;
  filterCompleted: string;
  filterLearning: string;
  listEmpty: string;
  ayahCount: string;
  surahNumber: string;
  tabHome: string;
  tabList: string;
  tabStudy: string;
  tabQuiz: string;
  studyTitle: string;
  pageLabel: string;
  prevPage: string;
  nextPage: string;
  play: string;
  pause: string;
  resume: string;
  stop: string;
  prevAyah: string;
  nextAyah: string;
  speed: string;
  repeat: string;
  repeatOff: string;
  repeatAyah: string;
  repeatSurah: string;
  volume: string;
  reciter: string;
  reciterPick: string;
  reciterClose: string;
  timingEstimated: string;
  audioFailed: string;
  audioLoading: string;
  resumeFrom: string;
  videosTitle: string;
  videosEmpty: string;
  videoWatch: string;
  offlineTitle: string;
  offlineSurah: string;
  offlineWhole: string;
  offlineDownloading: string;
  offlineDone: string;
  offlineFailed: string;
  offlineCancel: string;
  offlineDownloaded: string;
  offlineNote: string;
  pageFailed: string;
  quizTitle: string;
  quizMcqTitle: string;
  quizMatchingTitle: string;
  quizSubmit: string;
  quizResult: string;
  quizCorrect: string;
  quizStarsEarned: string;
  quizRetry: string;
  quizEmpty: string;
  quizMatchingEmpty: string;
  quizSignInHint: string;
  quizPickWord: string;
  quizAllPaired: string;
  /** The 12 listen reciters, in picker order (labels reuse the hifz keys). */
  reciterNames: { id: string; label: string }[];
}
