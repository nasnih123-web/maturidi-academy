import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import { errText } from "./library";

/**
 * Phase 12 (CRM) — voice assistant (fa/ar) provider settings + usage logs.
 *
 * Management-plane client over the REAL Phase-12 backend contract
 * (Track 1 landed 2026-10-19; ADR-0009; apps/api/app/modules/voice):
 *
 * - GET    /api/v1/admin/voice/settings
 *          → {settings: {"voice.stt_provider": "auto"|"faster_whisper"|"none",
 *                        "voice.tts_provider": "none"|"coqui"|"cloud"|"auto",
 *                        "voice.max_audio_seconds": int,
 *                        "voice.max_audio_mb": int,
 *                        "voice.tts_voice_fa": str, "voice.tts_voice_ar": str,
 *                        "voice.tts_cloud_endpoint": str}}
 * - PUT    /api/v1/admin/voice/settings   {settings: {key: value}}
 *          → {updated: [keys]}  (unknown keys → 400 unknown_setting)
 * - GET    /api/v1/admin/voice/usage?cursor=&limit=&intent=
 *          → {items: [{id, session_id, intent, lang, stt_ms, tts_provider,
 *                      created_at}], next_cursor}   (cursor-based, §1 —
 *          no offset, no total)
 *
 * All endpoints require the `voice.manage` permission (seeded by the backend).
 *
 * HONEST-STATUS NOTE: the backend exposes no dedicated provider-probe
 * endpoint, and the public /voice/transcribe|ask endpoints require an audio
 * file upload. The "test" buttons therefore re-fetch the LIVE settings from
 * the backend at click time and report the effective provider state
 * (configured / unavailable) from the actual backend values — never a
 * fabricated success. A real probe endpoint (e.g.
 * POST /api/v1/admin/voice/test) is recommended as backend follow-up.
 *
 * INVARIANT (surfaced in the UI too): Quran ayahs are always real recitation,
 * never TTS (backend NEVER-TTS rule, ADR-0009 §3).
 */

export { errText };

/** Backend vocabularies (ADR-0009 §1, §4). */
export type SttProvider = "auto" | "faster_whisper" | "none";
export type TtsProvider = "none" | "coqui" | "cloud" | "auto";

export const STT_PROVIDERS: SttProvider[] = ["auto", "faster_whisper", "none"];
export const TTS_PROVIDERS: TtsProvider[] = ["none", "coqui", "cloud", "auto"];

export function parseSttProvider(v: unknown): SttProvider {
  return STT_PROVIDERS.includes(v as SttProvider) ? (v as SttProvider) : "none";
}

export function parseTtsProvider(v: unknown): TtsProvider {
  return TTS_PROVIDERS.includes(v as TtsProvider) ? (v as TtsProvider) : "none";
}

/** Flat voice.* settings as the backend returns them. */
export interface VoiceSettings {
  stt_provider: SttProvider;
  tts_provider: TtsProvider;
  max_audio_seconds: number;
  max_audio_mb: number;
  tts_voice_fa: string;
  tts_voice_ar: string;
  tts_cloud_endpoint: string;
}

const SETTINGS_DEFAULTS: VoiceSettings = {
  stt_provider: "auto",
  tts_provider: "none",
  max_audio_seconds: 120,
  max_audio_mb: 25,
  tts_voice_fa: "default",
  tts_voice_ar: "default",
  tts_cloud_endpoint: "",
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Accepts either the backend's {settings: {...}} envelope or a bare map. */
export function parseSettings(v: unknown): VoiceSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const m =
    o.settings && typeof o.settings === "object"
      ? (o.settings as Record<string, unknown>)
      : o;
  return {
    stt_provider: parseSttProvider(m["voice.stt_provider"] ?? SETTINGS_DEFAULTS.stt_provider),
    tts_provider: parseTtsProvider(m["voice.tts_provider"] ?? SETTINGS_DEFAULTS.tts_provider),
    max_audio_seconds: Math.max(
      1,
      Math.floor(num(m["voice.max_audio_seconds"], SETTINGS_DEFAULTS.max_audio_seconds)),
    ),
    max_audio_mb: Math.max(
      1,
      Math.floor(num(m["voice.max_audio_mb"], SETTINGS_DEFAULTS.max_audio_mb)),
    ),
    tts_voice_fa: str(m["voice.tts_voice_fa"]) || "default",
    tts_voice_ar: str(m["voice.tts_voice_ar"]) || "default",
    tts_cloud_endpoint: str(m["voice.tts_cloud_endpoint"]),
  };
}

export function settingsToBody(s: VoiceSettings): Record<string, unknown> {
  return {
    "voice.stt_provider": s.stt_provider,
    "voice.tts_provider": s.tts_provider,
    "voice.max_audio_seconds": s.max_audio_seconds,
    "voice.max_audio_mb": s.max_audio_mb,
    "voice.tts_voice_fa": s.tts_voice_fa,
    "voice.tts_voice_ar": s.tts_voice_ar,
    "voice.tts_cloud_endpoint": s.tts_cloud_endpoint,
  };
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export const VOICE_SETTINGS_KEY = ["voice", "settings"] as const;

export function useVoiceSettings() {
  return useQuery({
    queryKey: VOICE_SETTINGS_KEY,
    queryFn: () =>
      apiFetch<unknown>("/api/v1/admin/voice/settings").then(parseSettings),
  });
}

export function useSaveVoiceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VoiceSettings) =>
      apiFetch<{ updated: string[] }>("/api/v1/admin/voice/settings", {
        method: "PUT",
        body: { settings: settingsToBody(body) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VOICE_SETTINGS_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* honest provider status — live backend config, re-read on every click */
/* ------------------------------------------------------------------ */

export type VoiceTestComponent = "stt" | "tts";

export interface VoiceProviderStatus {
  component: VoiceTestComponent;
  /** Raw provider value straight from the backend. */
  provider: string;
  /** Effective status derived from the backend value — never invented. */
  configured: boolean;
  /** Extra honest nuance, e.g. cloud TTS without an endpoint. */
  note: string | null;
}

export function useProbeVoiceProvider() {
  return useMutation({
    mutationFn: async (
      component: VoiceTestComponent,
    ): Promise<VoiceProviderStatus> => {
      // Live read — not the cached form state.
      const live = await apiFetch<unknown>("/api/v1/admin/voice/settings").then(
        parseSettings,
      );
      if (component === "stt") {
        const p = live.stt_provider;
        return {
          component,
          provider: p,
          configured: p !== "none",
          note: p === "auto" ? "auto" : null,
        };
      }
      const p = live.tts_provider;
      const endpointMissing =
        p === "cloud" && live.tts_cloud_endpoint.trim() === "";
      return {
        component,
        provider: p,
        configured: p !== "none" && !endpointMissing,
        note:
          p === "auto" ? "auto" : endpointMissing ? "missing_endpoint" : null,
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* usage log — cursor pagination (§1), optional intent filter           */
/* ------------------------------------------------------------------ */

export type VoiceIntent = "quran" | "fatwa" | "general";

export const VOICE_INTENTS: VoiceIntent[] = ["quran", "fatwa", "general"];

export interface VoiceUsageEntry {
  id: string;
  session_id: string;
  intent: string;
  lang: string;
  stt_ms: number | null;
  tts_provider: string | null;
  created_at: string;
}

function parseUsageEntry(v: unknown): VoiceUsageEntry {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    session_id: String(o.session_id ?? ""),
    intent: typeof o.intent === "string" ? o.intent : "",
    lang: typeof o.lang === "string" ? o.lang : "",
    stt_ms: typeof o.stt_ms === "number" ? o.stt_ms : null,
    tts_provider: typeof o.tts_provider === "string" ? o.tts_provider : null,
    created_at: typeof o.created_at === "string" ? o.created_at : "",
  };
}

export interface VoiceUsagePage {
  items: VoiceUsageEntry[];
  next_cursor: string | null;
}

export function voiceUsageKey(intent: string | null): readonly string[] {
  return ["voice", "usage", "infinite", intent ?? "all"] as const;
}

async function fetchUsagePage(
  intent: VoiceIntent | null,
  cursor: string | null,
  limit: number,
): Promise<VoiceUsagePage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (intent) params.set("intent", intent);
  const payload = await apiFetch<unknown>(
    `/api/v1/admin/voice/usage?${params.toString()}`,
  );
  const o = (payload ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    items: items.map(parseUsageEntry),
    next_cursor: typeof o.next_cursor === "string" ? o.next_cursor : null,
  };
}

/**
 * Cursor-chained usage log (contract §1). `fetchNextPage` appends;
 * `hasNextPage` is false when the backend returns no next_cursor.
 */
export function useVoiceUsageInfinite(intent: VoiceIntent | null, limit = 20) {
  return useInfiniteQuery({
    queryKey: voiceUsageKey(intent),
    queryFn: ({ pageParam }) =>
      fetchUsagePage(intent, pageParam, limit),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: null as string | null,
  });
}
