import { getApiBaseUrl, ApiError } from './api';

/**
 * Quran domain layer (Phase 5 — Track 2/web).
 *
 * Server-safe fetch client for the `/api/v1/quran/*` contract (Track 1,
 * apps/api/app/modules/quran). Per ADR-001 components never fetch here
 * directly: pages (RSC) call the `get*` functions and pass plain data to
 * components; browser code uses `quran-client.ts` for the authenticated
 * note endpoints.
 *
 * Wire contract (source of truth: apps/api/app/modules/quran/{router,schemas}.py):
 * - GET /api/v1/quran/surahs
 *     → { items: [{ number, name_ar, name_en, ayahs, revelation }], total }
 * - GET /api/v1/quran/surah/{n}?translation=<edition>&tafsir=<edition>
 *     → { surah, name_ar, name_en, ayahs: [{ surah, ayah,
 *         editions: [{ edition, text, audio_url, juz, page }] }], edition_ids }
 *     The Arabic text is the `quran-uthmani` edition; translation/tafsir are
 *     separate editions; per-ayah audio lives on the reciter edition.
 * - GET /api/v1/quran/providers
 *     → { providers, active_provider, text_edition, translations, tafsirs,
 *         reciters, active_languages, show_translation, show_tafsir,
 *         highlight_mode, font_size, playback }
 * - Notes (auth, see quran-client.ts):
 *     POST /api/v1/quran/notes { surah, ayah, note_text, is_private }
 *     GET  /api/v1/quran/notes?surah=&ayah= → { items, next_cursor }
 *     PUT  /api/v1/quran/notes/{id} { note_text?, is_private? }
 *     DELETE /api/v1/quran/notes/{id} → 204
 *
 * Quran text is NEVER hardcoded: every ayah string arrives from the API.
 */

export interface SurahSummary {
  number: number;
  /** Arabic name, e.g. "الفاتحة". */
  nameAr: string;
  /** Localized display name. */
  name: string;
  englishName: string;
  ayahCount: number;
  revelationType: 'Meccan' | 'Medinan' | string;
  /** Juz numbers this surah spans (empty when the API omits them). */
  juz: number[];
}

export interface WordTiming {
  /** 1-based word index inside the ayah. */
  word: number;
  /** Start/end in seconds within the ayah audio. */
  start: number;
  end: number;
}

export interface Ayah {
  /** 1-based ayah number inside the surah. */
  number: number;
  /** Global mushaf number (1..6236), nullable when the provider omits it. */
  globalNumber: number | null;
  /** Arabic Uthmani text — from the API, never local. */
  text: string;
  /** Translation in the requested edition (null when disabled/unavailable). */
  translation: string | null;
  /** Tafsir excerpt (null when disabled/unavailable). */
  tafsir: string | null;
  /** Direct audio URL for this ayah (null when the provider has none). */
  audioUrl: string | null;
  /** Word-level timings when the provider supplies them. */
  wordTimings: WordTiming[] | null;
  /** Duration of the ayah audio in seconds (null when unknown). */
  audioDuration: number | null;
  juz: number | null;
  page: number | null;
}

export interface SurahDetail {
  number: number;
  nameAr: string;
  name: string;
  englishName: string;
  ayahCount: number;
  revelationType: string;
  /** Full-surah audio URL (single file), when the provider supplies one. */
  audioUrl: string | null;
  bismillahPre: boolean;
}

/** Reciter entry resolved from the providers config (`quran.reciters`). */
export interface Reciter {
  id: string;
  name: string;
  /** e.g. "Hafs 'an 'Asim". */
  rewaya: string | null;
  /** Locale of the display name (fa/ar/en). */
  locale: string | null;
  /**
   * Portrait URL for the player bar. The providers payload carries no
   * photo today, so this is null in practice and the player renders a
   * neutral placeholder instead of a broken image. A CRM reciter-photo
   * field (upload or URL) is a later-phase item, not Phase 1 scope.
   */
  photoUrl?: string | null;
}

/** Display configuration resolved from GET /api/v1/quran/providers. */
export interface QuranDisplayConfig {
  showTranslation: boolean;
  showTafsir: boolean;
  highlightMode: 'word' | 'ayah';
  fontSize: number;
  textEdition: string;
  /** Edition id used for the translation column. */
  translationEdition: string | null;
  /** Edition id used for the tafsir column. */
  tafsirEdition: string | null;
  /** Full CRM-enabled translation list (selector options, CRM order). */
  translationEditions: string[];
  /** Full CRM-enabled tafsir list (selector options, CRM order). */
  tafsirEditions: string[];
  /** CRM playback repeat default (quran.playback.repeat), or null. */
  repeatDefault: 'off' | 'ayah' | 'surah' | null;
  reciters: Reciter[];
  activeReciter: string | null;
}

export interface AyahNote {
  id: string;
  surah: number;
  ayah: number;
  text: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}`;
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable at ${getApiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) throw new ApiError(`GET ${path} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

function asSurahSummary(raw: Record<string, unknown>): SurahSummary | null {
  const number = typeof raw.number === 'number' ? raw.number : -1;
  if (number < 1 || number > 114) return null;
  const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
  const juz = Array.isArray(raw.juz)
    ? raw.juz.filter((j): j is number => typeof j === 'number' && j >= 1 && j <= 30)
    : [];
  const englishName = str(raw.name_en);
  return {
    number,
    nameAr: str(raw.name_ar),
    name: englishName || str(raw.name_ar),
    englishName,
    ayahCount: typeof raw.ayahs === 'number' ? raw.ayahs : 0,
    revelationType: str(raw.revelation, 'Meccan'),
    juz,
  };
}

interface EditionRaw {
  edition: string;
  text: string | null;
  audioUrl: string | null;
  juz: number | null;
  page: number | null;
}

function asEdition(raw: unknown): EditionRaw | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.edition !== 'string' || !o.edition) return null;
  return {
    edition: o.edition,
    text: typeof o.text === 'string' ? o.text : null,
    audioUrl: typeof o.audio_url === 'string' ? o.audio_url : null,
    juz: typeof o.juz === 'number' ? o.juz : null,
    page: typeof o.page === 'number' ? o.page : null,
  };
}

/**
 * Round 7: force https on provider audio URLs. The page is served over
 * https, so an http audio URL would die to a mixed-content block with
 * no visible error. The live provider (AlQuran Cloud) already returns
 * https, so this is a defensive normalization, not a rewrite of a
 * known http source — an http URL can only arrive if a provider or
 * CRM override ever supplies one.
 */
function forceHttps(url: string | null): string | null {
  if (url && url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
}

/**
 * Resolve one ayah's display fields from its editions bundle:
 * Arabic text (quran-uthmani), the requested translation/tafsir editions,
 * and the reciter edition's audio URL.
 */
function resolveAyah(
  number: number,
  editions: EditionRaw[],
  opts: { translationEdition: string | null; tafsirEdition: string | null },
): Ayah {
  const arabic =
    editions.find((e) => e.edition === 'quran-uthmani') ??
    editions.find((e) => /quran/i.test(e.edition) && e.text) ??
    editions.find((e) => e.text);
  const audio =
    editions.find((e) => e.audioUrl && e !== arabic) ?? editions.find((e) => e.audioUrl);
  const translation = opts.translationEdition
    ? editions.find((e) => e.edition === opts.translationEdition)?.text ?? null
    : null;
  const tafsir = opts.tafsirEdition
    ? editions.find((e) => e.edition === opts.tafsirEdition)?.text ?? null
    : null;
  return {
    number,
    globalNumber: null,
    text: arabic?.text ?? '',
    translation,
    tafsir,
    audioUrl: forceHttps(audio?.audioUrl ?? null),
    wordTimings: null,
    audioDuration: null,
    juz: arabic?.juz ?? null,
    page: arabic?.page ?? null,
  };
}

/** Fetch the 114-surah index. Throws ApiError — pages render an error state. */
export async function getSurahs(): Promise<SurahSummary[]> {
  const body = await getJson<{ items?: unknown }>(`/api/v1/quran/surahs`);
  if (!Array.isArray(body?.items)) return [];
  return body.items
    .map((s) => (s && typeof s === 'object' ? asSurahSummary(s as Record<string, unknown>) : null))
    .filter((s): s is SurahSummary => s !== null)
    .sort((a, b) => a.number - b.number);
}

export interface SurahView {
  surah: SurahDetail;
  ayahs: Ayah[];
}

export interface SurahViewBody {
  surah?: unknown;
  name_ar?: unknown;
  name_en?: unknown;
  ayahs?: unknown;
}

/**
 * Pure parser for the surah-view wire shape — shared by the server
 * getSurah and the browser range fetcher (lib/quran-range-client.ts),
 * so both parse identically. No I/O here.
 */
export function parseSurahView(
  body: SurahViewBody,
  number: number,
  opts: {
    translationEdition?: string | null;
    tafsirEdition?: string | null;
  } = {},
): SurahView {
  const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
  const surah: SurahDetail = {
    number: typeof body?.surah === 'number' ? body.surah : number,
    nameAr: str(body?.name_ar),
    name: str(body?.name_en) || str(body?.name_ar),
    englishName: str(body?.name_en),
    ayahCount: Array.isArray(body?.ayahs) ? body.ayahs.length : 0,
    revelationType: '',
    audioUrl: null,
    bismillahPre: true,
  };
  const ayahs = Array.isArray(body?.ayahs)
    ? body.ayahs
        .map((a) => {
          if (!a || typeof a !== 'object') return null;
          const o = a as Record<string, unknown>;
          const n = typeof o.ayah === 'number' ? o.ayah : -1;
          if (n < 1) return null;
          const editions = Array.isArray(o.editions)
            ? o.editions.map(asEdition).filter((e): e is EditionRaw => e !== null)
            : [];
          return resolveAyah(n, editions, {
            translationEdition: opts.translationEdition ?? null,
            tafsirEdition: opts.tafsirEdition ?? null,
          });
        })
        .filter((a): a is Ayah => a !== null)
        .sort((a, b) => a.number - b.number)
    : [];
  return { surah, ayahs };
}

/** Fetch one surah with ayahs, translation, tafsir and audio references. */
export async function getSurah(
  number: number,
  opts: {
    translation?: string | null;
    tafsir?: string | null;
    translationEdition?: string | null;
    tafsirEdition?: string | null;
  } = {},
): Promise<SurahView> {
  const params = new URLSearchParams();
  if (opts.translation) params.set('translation', opts.translation);
  if (opts.tafsir) params.set('tafsir', opts.tafsir);
  const qs = params.toString();
  const body = await getJson<SurahViewBody>(
    `/api/v1/quran/surah/${number}${qs ? `?${qs}` : ''}`,
  );
  return parseSurahView(body, number, {
    translationEdition: opts.translationEdition ?? null,
    tafsirEdition: opts.tafsirEdition ?? null,
  });
}

/**
 * Fetch the providers/display config (CRM-driven: enabled translations,
 * tafsirs, reciters, visibility flags). Non-throwing — null when the
 * endpoint is missing so pages fall back to the quran.* settings defaults.
 */
export async function getQuranProviders(): Promise<QuranDisplayConfig | null> {
  let body: Record<string, unknown>;
  try {
    body = await getJson<Record<string, unknown>>(`/api/v1/quran/providers`);
  } catch {
    return null;
  }
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  const translations = strList(body.translations);
  const tafsirs = strList(body.tafsirs);
  const reciterIds = strList(body.reciters);
  const mode = body.highlight_mode === 'word' ? 'word' : 'ayah';
  const playback =
    body.playback && typeof body.playback === 'object'
      ? (body.playback as Record<string, unknown>)
      : null;
  const repeatRaw = playback?.repeat;
  return {
    showTranslation: body.show_translation !== false,
    showTafsir: body.show_tafsir === true,
    highlightMode: mode,
    fontSize:
      typeof body.font_size === 'number' && Number.isFinite(body.font_size) ? body.font_size : 20,
    textEdition: typeof body.text_edition === 'string' ? body.text_edition : 'quran-uthmani',
    translationEdition: translations[0] ?? null,
    tafsirEdition: tafsirs[0] ?? null,
    translationEditions: translations,
    tafsirEditions: tafsirs,
    repeatDefault:
      repeatRaw === 'ayah' || repeatRaw === 'surah' || repeatRaw === 'off' ? repeatRaw : null,
    reciters: reciterIds.map((id) => ({ id, name: id, rewaya: null, locale: null, photoUrl: null })),
    activeReciter: reciterIds[0] ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers (no I/O — safe for client bundles and unit tests)       */
/* ------------------------------------------------------------------ */

/**
 * Filter the surah index by a free-text query (number, Arabic name,
 * English transliteration). Pure — the component only renders the result.
 */
export function filterSurahs(surahs: SurahSummary[], query: string): SurahSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return surahs;
  const digits = q.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString());
  return surahs.filter(
    (s) =>
      String(s.number) === digits ||
      s.nameAr.includes(query.trim()) ||
      s.name.toLowerCase().includes(q) ||
      s.englishName.toLowerCase().includes(q),
  );
}

/**
 * Map an audio timestamp to the current ayah. When the provider supplies
 * word-level timings AND per-ayah audio durations, the caller converts the
 * global time to per-ayah time first; this function maps a per-ayah time to
 * a word index. Returns -1 when nothing matches.
 */
export function wordIndexAtTime(timings: WordTiming[], t: number): number {
  for (const w of timings) {
    if (t >= w.start && t < w.end) return w.word;
  }
  return -1;
}

/**
 * Given ayahs with known audio durations (in order) and a global playback
 * time `t` (seconds since the track started), return the 0-based ayah index
 * currently playing, or -1 when unknown. This is the ayah-level fallback
 * used when the provider has no word timings.
 */
export function ayahIndexAtTime(durations: (number | null)[], t: number): number {
  let cursor = 0;
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i];
    if (d === null || d <= 0) return -1;
    if (t >= cursor && t < cursor + d) return i;
    cursor += d;
  }
  return -1;
}

/** Juz shortcut list (1..30) for the surah index header. */
export const JUZ_LIST: number[] = Array.from({ length: 30 }, (_, i) => i + 1);
