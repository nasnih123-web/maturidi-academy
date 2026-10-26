import React from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import { useAuth } from "../lib/auth";
import { taskPriorityTone, taskStatusTone, useTasksByEntity } from "../lib/projects16";
import { formatDate, useI18n, type Locale } from "../lib/i18n";
import { type LocalizedText } from "../lib/contentApi";
import LocalizedInput from "../components/LocalizedInput";
import {
  AI_SCOPES,
  DOWNLOAD_POLICIES,
  KIND_ACCEPT,
  LIBRARY_KINDS,
  LIBRARY_VISIBILITIES,
  LIBRARY_WORKFLOWS,
  NEXT_TRANSITIONS,
  TELEGRAM_POLICIES,
  buildCreateForm,
  canIndexAi,
  dataUrlToFile,
  defaultMetadata,
  errText,
  formatDuration,
  metadataFromItem,
  useCreateLibraryItem,
  useIndexLibraryItemAi,
  useLibraryItemQuery,
  useLibraryItemsQuery,
  useLibraryVersionsQuery,
  useReplaceLibraryItem,
  useRequeueOcr,
  useRequeueTranscription,
  useRevertLibraryVersion,
  useTransitionLibraryItem,
  useUpdateLibraryItem,
  type AiScope,
  type DownloadPolicy,
  type LibraryFilters,
  type LibraryItem,
  type LibraryKind,
  type LibraryMetadata,
  type LibraryVisibility,
  type LibraryWorkflow,
  type TelegramPolicy,
  type VideoChapter,
} from "../lib/library";

/**
 * Media Manager — Phase 9 (Track 3, CRM).
 *
 * Central DMS console for the scholars' multimedia library (video, 360°
 * video, PDF, audio, mind maps): library list · upload/edit with instant
 * music-player-like preview · transcript/OCR · AI scopes (publication ≠ AI
 * indexing) · versions · human review queue · placement & distribution.
 *
 * ADR-001: this page only renders. All parsing, workflow rules, duration
 * formatting, and API access live in ../lib/library.
 */

type MediaTab =
  | "list"
  | "upload"
  | "transcript"
  | "ai"
  | "versions"
  | "review"
  | "placement"
  | "tasks";
const TABS: MediaTab[] = ["list", "upload", "transcript", "ai", "versions", "review", "placement", "tasks"];

const TAB_KEY: Record<MediaTab, string> = {
  list: "media.tabList",
  upload: "media.tabUpload",
  transcript: "media.tabTranscript",
  ai: "media.tabAi",
  versions: "media.tabVersions",
  review: "media.tabReview",
  placement: "media.tabPlacement",
  tasks: "media.tabTasks",
};

function initialTab(): MediaTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as string[]).includes(t)) return t as MediaTab;
  } catch {
    // ignore (SSR)
  }
  return "list";
}

function initialSelectedId(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get("id");
    return id || null;
  } catch {
    return null;
  }
}

function l10n(locale: Locale, v: LocalizedText): string {
  return v[locale] || v.fa || v.en || v.ar || "";
}

/* ------------------------------------------------------------------ */
/* shared bits                                                          */
/* ------------------------------------------------------------------ */

function QueryState({
  isLoading,
  isError,
  error,
  empty,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  empty: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  if (isLoading) return <p className="hint">{t("common.loading")}</p>;
  if (isError)
    return (
      <p className="form-error" style={{ marginBottom: "1rem" }}>
        {t("media.errorLoad")}: {errText(error)}
      </p>
    );
  if (empty) return <p className="hint">{t("media.emptyNone")}</p>;
  return <>{children}</>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? (
        <p className="hint" style={{ margin: "0.25rem 0 0" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: "0.9rem",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

const KIND_ICONS: Record<LibraryKind, string> = {
  video: "M4 5h16v14H4zM10 9l5 3-5 3z",
  video_360: "M12 4a8 8 0 018 8M12 4a8 8 0 00-8 8M12 4v3M12 17a5 5 0 015 5M12 17a5 5 0 00-5 5",
  pdf: "M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 16h4",
  audio: "M9 18V6l10-2v11M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM19 15a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  mindmap: "M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0M12 10V4M12 14v6M4 6l4.5 3.5M20 6l-4.5 3.5M4 18l4.5-3.5M20 18l-4.5-3.5",
};

function KindIcon({ kind }: { kind: LibraryKind }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      width="16"
      height="16"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={KIND_ICONS[kind]} />
    </svg>
  );
}

function KindBadge({ kind }: { kind: LibraryKind }): React.ReactElement {
  const { t } = useI18n();
  return (
    <Badge tone="info">
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
        <KindIcon kind={kind} />
        {t(`media.kind_${kind}`)}
      </span>
    </Badge>
  );
}

function VisibilityBadge({ v }: { v: LibraryVisibility }): React.ReactElement {
  const { t } = useI18n();
  const tone = v === "public" ? "success" : v === "registered" ? "neutral" : "warning";
  return <Badge tone={tone}>{t(`media.vis_${v}`)}</Badge>;
}

function AiBadge({ item }: { item: LibraryItem }): React.ReactElement {
  const { t } = useI18n();
  return item.ai_indexed ? (
    <Badge tone="success">{t("media.aiIndexed")}</Badge>
  ) : (
    <Badge tone="neutral">{t("media.aiNotIndexed")}</Badge>
  );
}

function SourceBadge({ item }: { item: LibraryItem }): React.ReactElement {
  const { t } = useI18n();
  const tone = item.source_type === "telegram_import" ? "warning" : "neutral";
  return (
    <Badge tone={tone} title={item.source_ref || undefined}>
      {t(`media.source_${item.source_type}`)}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* audio preview — music-player-like, instant via object URL            */
/* ------------------------------------------------------------------ */

/**
 * Instant audio preview (spec acceptance criterion): built from an object
 * URL the moment a file is picked — no upload involved. Playback controls
 * are presentational UI state.
 */
function AudioPreview({
  file,
  title,
  coverUrl,
}: {
  file: File;
  title: string;
  coverUrl: string | null;
}): React.ReactElement {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [url, setUrl] = React.useState<string>("");
  const [playing, setPlaying] = React.useState(false);
  const [cur, setCur] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [rate, setRate] = React.useState(1);

  React.useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setPlaying(false);
    setCur(0);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  React.useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = (): void => setCur(el.currentTime);
    const onMeta = (): void => setDur(el.duration || 0);
    const onEnd = (): void => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, [url]);

  const toggle = (): void => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const seek = (v: number): void => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = v;
    setCur(v);
  };

  const changeRate = (r: number): void => {
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  return (
    <div
      data-testid="audio-preview"
      style={{
        display: "flex",
        gap: "0.9rem",
        alignItems: "center",
        padding: "0.9rem 1rem",
        border: "1px solid var(--x-border)",
        borderRadius: "var(--x-radius)",
        background: "var(--x-glass)",
      }}
    >
      <audio ref={audioRef} src={url} preload="metadata" style={{ display: "none" }} />
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "12px",
          overflow: "hidden",
          flexShrink: 0,
          background: "var(--x-bg2)",
          border: "1px solid var(--x-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--x-gold)",
        }}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <KindIcon kind="audio" />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            color: "var(--x-text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title || file.name}
        </div>
        <div className="hint" style={{ margin: "0.15rem 0 0.5rem" }} dir="ltr">
          {file.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "pause" : "play"}
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "50%",
              border: "1px solid var(--x-gold)",
              background: "var(--x-gold)",
              color: "#1a1408",
              fontSize: "1rem",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <span className="hint" dir="ltr" style={{ margin: 0, minWidth: "3.2rem" }}>
            {formatDuration(cur)}
          </span>
          <input
            type="range"
            min={0}
            max={dur || 0}
            step={0.1}
            value={cur}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label="seek"
          />
          <span className="hint" dir="ltr" style={{ margin: 0, minWidth: "3.2rem" }}>
            {formatDuration(dur)}
          </span>
          <select
            className="input"
            dir="ltr"
            value={rate}
            onChange={(e) => changeRate(Number(e.target.value))}
            style={{ width: "auto", padding: "0.2rem 0.4rem" }}
            aria-label="speed"
          >
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* video preview + frame capture                                       */
/* ------------------------------------------------------------------ */

function VideoPreview({
  file,
  onCapture,
  captureLabel,
}: {
  file: File;
  onCapture: (dataUrl: string) => void;
  captureLabel: string;
}): React.ReactElement {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [url, setUrl] = React.useState<string>("");

  React.useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const capture = (): void => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    onCapture(canvas.toDataURL("image/jpeg", 0.85));
  };

  return (
    <div data-testid="video-preview">
      <video
        ref={videoRef}
        src={url}
        controls
        preload="metadata"
        style={{ width: "100%", maxHeight: "320px", borderRadius: "var(--x-radius)", background: "#000" }}
      />
      <div style={{ marginTop: "0.5rem" }}>
        <Button size="sm" variant="secondary" onClick={capture}>
          {captureLabel}
        </Button>
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* per-kind settings editor                                            */
/* ------------------------------------------------------------------ */

function KindSettings({
  meta,
  onChange,
}: {
  meta: LibraryMetadata;
  onChange: (m: LibraryMetadata) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const set = (patch: Partial<LibraryMetadata["settings"]>): void =>
    onChange({ ...meta, settings: { ...meta.settings, ...patch } });
  const s = meta.settings;

  if (meta.kind === "pdf") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("media.settingsPdf")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Toggle checked={s.pdf_toc !== false} onChange={(v) => set({ pdf_toc: v })} label={t("media.setPdfToc")} />
            <Toggle checked={s.pdf_search !== false} onChange={(v) => set({ pdf_search: v })} label={t("media.setPdfSearch")} />
            <Toggle checked={!!s.pdf_tts} onChange={(v) => set({ pdf_tts: v })} label={t("media.setPdfTts")} />
            <Toggle checked={s.pdf_download !== false} onChange={(v) => set({ pdf_download: v })} label={t("media.setPdfDownload")} />
            <Toggle checked={!!s.pdf_watermark} onChange={(v) => set({ pdf_watermark: v })} label={t("media.setPdfWatermark")} />
            <Field label={t("media.setRelated")}>
              <input
                className="input"
                dir="ltr"
                value={(s.related_item_ids ?? []).join(", ")}
                onChange={(e) =>
                  set({
                    related_item_ids: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                  })
                }
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (meta.kind === "audio") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("media.settingsAudio")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Toggle checked={s.audio_speed_control !== false} onChange={(v) => set({ audio_speed_control: v })} label={t("media.setAudioSpeed")} />
            <Toggle checked={s.audio_seek_allowed !== false} onChange={(v) => set({ audio_seek_allowed: v })} label={t("media.setAudioSeek")} />
            <Toggle checked={!!s.audio_mini_player} onChange={(v) => set({ audio_mini_player: v })} label={t("media.setAudioMini")} />
            <Field label={t("media.setAudioLoudness")}>
              <input
                className="input"
                value={s.audio_loudness_note ?? ""}
                onChange={(e) => set({ audio_loudness_note: e.target.value })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (meta.kind === "video") {
    const chapters = s.chapters ?? [];
    const setChapters = (cs: VideoChapter[]): void => set({ chapters: cs });
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("media.settingsVideo")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="hint" style={{ marginBottom: "0.5rem" }}>
            {t("media.chaptersTitle")}
          </div>
          {chapters.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input
                className="input"
                dir="ltr"
                type="number"
                min={0}
                step={1}
                style={{ width: "7rem" }}
                value={c.time_seconds}
                aria-label={t("media.chapterTime")}
                onChange={(e) => {
                  const next = [...chapters];
                  next[i] = { ...c, time_seconds: Math.max(0, Number(e.target.value) || 0) };
                  setChapters(next);
                }}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                value={c.label}
                aria-label={t("media.chapterLabel")}
                onChange={(e) => {
                  const next = [...chapters];
                  next[i] = { ...c, label: e.target.value };
                  setChapters(next);
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChapters(chapters.filter((_, j) => j !== i))}
              >
                {t("media.removeChapter")}
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setChapters([...chapters, { time_seconds: 0, label: "" }].sort((a, b) => a.time_seconds - b.time_seconds))
            }
          >
            {t("media.addChapter")}
          </Button>
          <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.8rem" }}>
            <Field label={t("media.setCaptions")}>
              <input
                className="input"
                value={s.captions_note ?? ""}
                onChange={(e) => set({ captions_note: e.target.value })}
              />
            </Field>
            <Field label={t("media.setQuality")}>
              <input
                className="input"
                value={s.quality_variants_note ?? ""}
                onChange={(e) => set({ quality_variants_note: e.target.value })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (meta.kind === "video_360") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("media.settings360")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Field label={t("media.setProjection")}>
              <select
                className="input"
                dir="ltr"
                value={s.projection ?? "equirectangular"}
                onChange={() => set({ projection: "equirectangular" })}
              >
                <option value="equirectangular">{t("media.projectionEquirect")}</option>
              </select>
            </Field>
            <Field label={t("media.setPlaceRef")} hint={t("media.placeRefHint")}>
              <input
                className="input"
                dir="ltr"
                value={s.place_ref ?? ""}
                onChange={(e) => set({ place_ref: e.target.value })}
              />
            </Field>
            <Field label={t("media.setDeviceNote")}>
              <input
                className="input"
                value={s.device_note ?? ""}
                onChange={(e) => set({ device_note: e.target.value })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <></>;
}

/* ------------------------------------------------------------------ */
/* upload / edit form                                                  */
/* ------------------------------------------------------------------ */

function UploadTab({
  item,
  onCreated,
  onSelectItem,
}: {
  item: LibraryItem | null;
  onCreated: (id: string) => void;
  onSelectItem: (id: string | null) => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const createMut = useCreateLibraryItem();
  const updateMut = useUpdateLibraryItem();
  const replaceMut = useReplaceLibraryItem();

  const [kind, setKind] = React.useState<LibraryKind>(item?.kind ?? "audio");
  const [file, setFile] = React.useState<File | null>(null);
  const [cover, setCover] = React.useState<File | null>(null);
  const [coverPreview, setCoverPreview] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<LibraryMetadata>(() =>
    item ? metadataFromItem(item) : defaultMetadata("audio"),
  );
  const [loadedId, setLoadedId] = React.useState<string | null>(item?.id ?? null);
  const [error, setError] = React.useState<string>("");

  // When a different item is selected, re-seed the form.
  if (item && item.id !== loadedId) {
    setLoadedId(item.id);
    setKind(item.kind);
    setMeta(metadataFromItem(item));
    setFile(null);
    setCover(null);
    setCoverPreview(null);
    setError("");
  }

  // Cover preview object URL lifecycle.
  React.useEffect(() => {
    if (!cover) {
      setCoverPreview(null);
      return;
    }
    const u = URL.createObjectURL(cover);
    setCoverPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [cover]);

  const changeKind = (k: LibraryKind): void => {
    setKind(k);
    // keep the human-written text, reset kind-specific settings
    setMeta((m) => ({ ...defaultMetadata(k), title: m.title, description: m.description, topic_tags: m.topic_tags }));
    setFile(null);
  };

  const onCaptureFrame = (dataUrl: string): void => {
    setCover(dataUrlToFile(dataUrl, "thumbnail.jpg"));
  };

  const submit = async (): Promise<void> => {
    setError("");
    try {
      if (!item) {
        if (!file) {
          setError(t("media.dropHint"));
          return;
        }
        const created = await createMut.mutateAsync(buildCreateForm(file, { ...meta, kind }, cover));
        onCreated(created.id);
      } else if (file || cover) {
        await replaceMut.mutateAsync({ id: item.id, metadata: { ...meta, kind }, file, cover });
        onCreated(item.id);
      } else {
        await updateMut.mutateAsync({ id: item.id, metadata: { ...meta, kind } });
        onCreated(item.id);
      }
    } catch (e) {
      setError(`${t("media.uploadError")}: ${errText(e)}`);
    }
  };

  const pending = createMut.isPending || updateMut.isPending || replaceMut.isPending;
  const titleLive = l10n(locale, meta.title);

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "880px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
          {item ? t("media.editTitle") : t("media.createTitle")}
        </h2>
        {item ? (
          <Button size="sm" variant="secondary" onClick={() => onSelectItem(null)}>
            {t("media.newItem")}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent>
          <div style={{ display: "grid", gap: "0.9rem" }}>
            <Field label={t("media.fieldKind")}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {LIBRARY_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => changeKind(k)}
                    className="input"
                    style={{
                      width: "auto",
                      padding: "0.4rem 0.8rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      background: kind === k ? "var(--x-gold)" : "transparent",
                      color: kind === k ? "#1a1408" : "var(--x-text2)",
                      border: kind === k ? "1px solid var(--x-gold)" : "1px solid var(--x-line)",
                      borderRadius: "999px",
                    }}
                  >
                    <KindIcon kind={k} />
                    {t(`media.kind_${k}`)}
                  </button>
                ))}
              </div>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
              <Field label={item ? t("media.fieldFileReplace") : t("media.fieldFile")}>
                <input
                  type="file"
                  data-testid="media-file"
                  className="input"
                  accept={KIND_ACCEPT[kind]}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <p className="hint" dir="ltr" style={{ margin: "0.25rem 0 0" }}>
                    {file.name}
                  </p>
                ) : null}
              </Field>
              <Field label={t("media.fieldCover")}>
                <input
                  type="file"
                  className="input"
                  accept="image/*"
                  onChange={(e) => setCover(e.target.files?.[0] ?? null)}
                />
                {(coverPreview || item?.cover_url) && (
                  <img
                    src={coverPreview ?? item?.cover_url}
                    alt=""
                    style={{
                      marginTop: "0.4rem",
                      width: "96px",
                      height: "96px",
                      objectFit: "cover",
                      borderRadius: "10px",
                      border: "1px solid var(--x-border)",
                    }}
                  />
                )}
              </Field>
            </div>

            {(kind === "audio" || kind === "video" || kind === "video_360") && (
              <div>
                <div className="hint" style={{ marginBottom: "0.4rem" }}>
                  {t("media.previewTitle")} — {t("media.audioPreviewNote")}
                </div>
                {file ? (
                  kind === "audio" ? (
                    <AudioPreview file={file} title={titleLive} coverUrl={coverPreview} />
                  ) : (
                    <VideoPreview file={file} onCapture={onCaptureFrame} captureLabel={t("media.captureThumbnail")} />
                  )
                ) : (
                  <p className="hint">{t("media.dropHint")}</p>
                )}
              </div>
            )}
            {kind === "pdf" && (
              <p className="hint" style={{ margin: 0 }}>
                {t("media.pdfPreviewNote")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div style={{ display: "grid", gap: "0.9rem" }}>
            <LocalizedInput
              id="lib-title"
              label={t("media.fieldTitle")}
              value={meta.title}
              onChange={(v) => setMeta({ ...meta, title: v })}
            />
            <LocalizedInput
              id="lib-desc"
              label={t("media.fieldDescription")}
              value={meta.description}
              onChange={(v) => setMeta({ ...meta, description: v })}
              multiline
              rows={3}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
              <Field label={t("media.fieldScholar")} hint={t("media.scholarHint")}>
                <input
                  className="input"
                  dir="ltr"
                  value={meta.scholar_id ?? ""}
                  onChange={(e) => setMeta({ ...meta, scholar_id: e.target.value || null })}
                />
              </Field>
              <Field label={t("media.fieldTags")} hint={t("media.tagsHint")}>
                <input
                  className="input"
                  value={meta.topic_tags.join(", ")}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      topic_tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
              <Field label={t("media.fieldVisibility")}>
                <select
                  className="input"
                  value={meta.visibility}
                  onChange={(e) => setMeta({ ...meta, visibility: e.target.value as LibraryVisibility })}
                >
                  {LIBRARY_VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {t(`media.vis_${v}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("media.fieldDownloadPolicy")}>
                <select
                  className="input"
                  value={meta.download_policy}
                  onChange={(e) => setMeta({ ...meta, download_policy: e.target.value as DownloadPolicy })}
                >
                  {DOWNLOAD_POLICIES.map((d) => (
                    <option key={d} value={d}>
                      {t(`media.dl_${d}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </CardContent>
      </Card>

      <KindSettings meta={meta} onChange={setMeta} />

      {error ? (
        <p className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <p className="hint" style={{ margin: 0 }}>
        {t("media.versionNote")}
      </p>
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <Button onClick={() => void submit()} disabled={pending || !canManage}>
          {pending ? t("media.saving") : item ? t("media.save") : t("media.create")}
        </Button>
        {item ? (
          <Button variant="secondary" onClick={() => onSelectItem(item.id)} disabled={pending}>
            {t("media.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* library list                                                        */
/* ------------------------------------------------------------------ */

function LibraryListTab({
  onSelect,
}: {
  onSelect: (id: string) => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const [kind, setKind] = React.useState("");
  const [workflow, setWorkflow] = React.useState("");
  const [q, setQ] = React.useState("");
  const [appliedQ, setAppliedQ] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = React.useState("");
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkError, setBulkError] = React.useState("");

  const filters: LibraryFilters = {
    kind: kind || undefined,
    workflow_status: workflow || undefined,
    q: appliedQ || undefined,
  };
  const query = useLibraryItemsQuery(filters);
  const transitionMut = useTransitionLibraryItem();
  const queryClient = useQueryClient();

  const items = query.data?.items ?? [];

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = items.filter((it) => selected.has(it.id));
  const commonTransitions: LibraryWorkflow[] = (() => {
    if (selectedItems.length === 0) return [];
    let acc: LibraryWorkflow[] = [...NEXT_TRANSITIONS[selectedItems[0].workflow_status]];
    for (const it of selectedItems.slice(1)) {
      const next = NEXT_TRANSITIONS[it.workflow_status];
      acc = acc.filter((s) => next.includes(s));
    }
    return acc;
  })();

  const applyBulk = async (): Promise<void> => {
    if (!bulkTo || selectedItems.length === 0) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      for (const it of selectedItems) {
        // Sequential: keeps the audit trail ordered.
        await transitionMut.mutateAsync({ id: it.id, to: bulkTo as LibraryWorkflow });
      }
      setSelected(new Set());
      setBulkTo("");
    } catch (e) {
      setBulkError(errText(e));
    } finally {
      setBulkBusy(false);
      queryClient.invalidateQueries({ queryKey: ["library"] });
    }
  };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          flexWrap: "wrap",
          alignItems: "end",
        }}
      >
        <Field label={t("media.filterKind")}>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto", minWidth: "10rem" }}>
            <option value="">{t("media.all")}</option>
            {LIBRARY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`media.kind_${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("media.filterWorkflow")}>
          <select className="input" value={workflow} onChange={(e) => setWorkflow(e.target.value)} style={{ width: "auto", minWidth: "10rem" }}>
            <option value="">{t("media.all")}</option>
            {LIBRARY_WORKFLOWS.map((w) => (
              <option key={w} value={w}>
                {t(`status.${w}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("media.filterSearch")}>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setAppliedQ(q.trim());
              }}
              placeholder={t("media.filterSearch")}
            />
            <Button size="sm" variant="secondary" onClick={() => setAppliedQ(q.trim())}>
              {t("media.filterSearch").replace("…", "")}
            </Button>
          </div>
        </Field>
      </div>

      {selected.size > 0 && (
        <Card>
          <CardContent>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <span className="hint" style={{ margin: 0 }}>
                {t("media.bulkSelected").replace("{n}", String(selected.size))}
              </span>
              {commonTransitions.length > 0 ? (
                <>
                  <select
                    className="input"
                    value={bulkTo}
                    onChange={(e) => setBulkTo(e.target.value)}
                    style={{ width: "auto" }}
                    aria-label={t("media.bulkMoveTo")}
                  >
                    <option value="">{t("media.bulkMoveTo")}</option>
                    {commonTransitions.map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={() => void applyBulk()} disabled={!bulkTo || bulkBusy || !canManage}>
                    {t("media.bulkApply")}
                  </Button>
                </>
              ) : (
                <span className="hint" style={{ margin: 0 }}>
                  {t("media.noCommonTransition")}
                </span>
              )}
              {bulkError ? <span className="form-error">{bulkError}</span> : null}
            </div>
          </CardContent>
        </Card>
      )}

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        empty={!query.isLoading && !query.isError && items.length === 0}
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                    }
                    aria-label={t("media.bulkSelected").replace("{n}", "")}
                  />
                </th>
                <th>{t("media.tableKind")}</th>
                <th>{t("media.tableTitle")}</th>
                <th>{t("media.tableScholar")}</th>
                <th>{t("media.tableVisibility")}</th>
                <th>{t("media.tableWorkflow")}</th>
                <th>{t("media.tableVersion")}</th>
                <th>{t("media.tableAi")}</th>
                <th>{t("media.tableActions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleSelect(it.id)}
                      aria-label={l10n(locale, it.title)}
                    />
                  </td>
                  <td>
                    <KindBadge kind={it.kind} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--x-text)" }}>
                      {l10n(locale, it.title) || <span className="hint">—</span>}
                    </div>
                    <div className="hint" dir="ltr" style={{ margin: 0, fontSize: "0.75rem" }}>
                      {it.mime_type || it.id.slice(0, 8)}
                    </div>
                  </td>
                  <td>{it.scholar_name || it.scholar_id || <span className="hint">—</span>}</td>
                  <td>
                    <VisibilityBadge v={it.visibility} />
                  </td>
                  <td>
                    <Badge tone={statusTone(it.workflow_status)}>{t(`status.${it.workflow_status}`)}</Badge>
                  </td>
                  <td dir="ltr">v{it.version}</td>
                  <td>
                    <AiBadge item={it} />
                  </td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => onSelect(it.id)}>
                      {t("media.manage")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* transcript / OCR                                                    */
/* ------------------------------------------------------------------ */

function TranscriptTab({ item }: { item: LibraryItem }): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const updateMut = useUpdateLibraryItem();
  const sttMut = useRequeueTranscription();
  const ocrMut = useRequeueOcr();

  const [transcript, setTranscript] = React.useState(item.transcript);
  const [ocrText, setOcrText] = React.useState(item.ocr_text);
  const [loadedId, setLoadedId] = React.useState(item.id);
  const [msg, setMsg] = React.useState("");
  const [error, setError] = React.useState("");

  if (item.id !== loadedId) {
    setLoadedId(item.id);
    setTranscript(item.transcript);
    setOcrText(item.ocr_text);
    setMsg("");
    setError("");
  }

  const dirty = transcript !== item.transcript || ocrText !== item.ocr_text;

  const save = async (): Promise<void> => {
    setError("");
    setMsg("");
    try {
      await updateMut.mutateAsync({
        id: item.id,
        metadata: { ...metadataFromItem(item), transcript, ocr_text: ocrText },
      });
      setMsg(t("media.savedPlacement"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const rerun = async (which: "stt" | "ocr"): Promise<void> => {
    setError("");
    setMsg("");
    try {
      if (which === "stt") {
        await sttMut.mutateAsync({ id: item.id, clearText: false });
        setTranscript(item.transcript);
      } else {
        await ocrMut.mutateAsync(item.id);
        setOcrText("");
      }
      setMsg(t("media.rerunHint"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const busy = updateMut.isPending || sttMut.isPending || ocrMut.isPending;
  const sttTone =
    item.transcript_status === "done"
      ? "success"
      : item.transcript_status === "failed"
        ? "danger"
        : item.transcript_status === "processing"
          ? "info"
          : "neutral";

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "880px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
          {t("media.transcriptTitle")}
        </h2>
        <span className="hint" style={{ margin: 0 }}>
          {t("media.transcriptStatus")}:
        </span>
        <Badge tone={sttTone}>{t(`media.stt_${item.transcript_status}`)}</Badge>
        {item.duration_seconds != null ? (
          <span className="hint" dir="ltr" style={{ margin: 0 }}>
            {formatDuration(item.duration_seconds)}
          </span>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("media.fieldTranscript")}</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="input"
            rows={8}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t("media.fieldTranscript")}
          />
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" onClick={() => void rerun("stt")} disabled={busy || !canManage}>
              {t("media.rerunStt")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("media.fieldOcr")}</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="input"
            rows={6}
            dir="auto"
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            placeholder={t("media.fieldOcr")}
          />
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" onClick={() => void rerun("ocr")} disabled={busy || !canManage}>
              {t("media.rerunOcr")}
            </Button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            {t("media.rerunHint")}
          </p>
        </CardContent>
      </Card>

      {msg ? <p className="hint">{msg}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div>
        <Button onClick={() => void save()} disabled={busy || !dirty || !canManage}>
          {t("media.saveTranscript")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI scopes — publication ≠ AI indexing                               */
/* ------------------------------------------------------------------ */

function AiScopesTab({ item }: { item: LibraryItem }): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const updateMut = useUpdateLibraryItem();
  const indexMut = useIndexLibraryItemAi();

  const [scopes, setScopes] = React.useState<AiScope[]>(item.ai_scopes);
  const [includeRag, setIncludeRag] = React.useState(item.include_in_fatwa_rag);
  const [loadedId, setLoadedId] = React.useState(item.id);
  const [msg, setMsg] = React.useState("");
  const [error, setError] = React.useState("");

  if (item.id !== loadedId) {
    setLoadedId(item.id);
    setScopes(item.ai_scopes);
    setIncludeRag(item.include_in_fatwa_rag);
    setMsg("");
    setError("");
  }

  const dirty =
    includeRag !== item.include_in_fatwa_rag ||
    scopes.length !== item.ai_scopes.length ||
    scopes.some((s) => !item.ai_scopes.includes(s));

  const toggleScope = (s: AiScope): void =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const save = async (): Promise<void> => {
    setError("");
    setMsg("");
    try {
      await updateMut.mutateAsync({
        id: item.id,
        metadata: { ...metadataFromItem(item), ai_scopes: scopes, include_in_fatwa_rag: includeRag },
      });
      setMsg(t("media.savedPlacement"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const index = async (): Promise<void> => {
    setError("");
    setMsg("");
    try {
      await indexMut.mutateAsync(item.id);
      setMsg(t("media.indexOk"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const indexable = canIndexAi(item.workflow_status);
  const busy = updateMut.isPending || indexMut.isPending;

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "880px" }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("media.aiTitle")}</h2>

      {/* publication ≠ AI indexing — visually explicit separation */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("media.tableWorkflow")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge tone={statusTone(item.workflow_status)}>{t(`status.${item.workflow_status}`)}</Badge>
            <p className="hint" style={{ marginBottom: 0, marginTop: "0.5rem" }}>
              {t("media.aiHint").split("—")[0]}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("media.tabAi")}</CardTitle>
          </CardHeader>
          <CardContent>
            <AiBadge item={item} />
            {item.ai_indexed_at ? (
              <p className="hint" style={{ marginBottom: 0, marginTop: "0.5rem" }}>
                {t("media.aiIndexedAt")}: {item.ai_indexed_at}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("media.scopesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {AI_SCOPES.map((s) => (
              <Toggle
                key={s}
                checked={scopes.includes(s)}
                onChange={() => toggleScope(s)}
                label={t(`media.scope_${s}`)}
                disabled={!canManage}
              />
            ))}
            <div
              style={{
                marginTop: "0.4rem",
                paddingTop: "0.6rem",
                borderTop: "1px solid var(--x-border)",
              }}
            >
              <Toggle
                checked={includeRag}
                onChange={setIncludeRag}
                label={t("media.includeFatwaRag")}
                disabled={!canManage}
              />
            </div>
          </div>
          <div style={{ marginTop: "0.8rem" }}>
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty || !canManage}>
              {t("media.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
            <Button onClick={() => void index()} disabled={busy || !indexable || !canManage}>
              {indexMut.isPending ? t("media.indexing") : t("media.indexAi")}
            </Button>
            {!indexable ? (
              <span className="hint" style={{ margin: 0 }}>
                {t("media.indexDisabledReason")}
              </span>
            ) : null}
          </div>
          {msg ? <p className="hint">{msg}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* versions                                                            */
/* ------------------------------------------------------------------ */

function VersionsTab({ item }: { item: LibraryItem }): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const versionsQuery = useLibraryVersionsQuery(item.id);
  const revertMut = useRevertLibraryVersion();

  const [revertTarget, setRevertTarget] = React.useState<number | null>(null);
  const [revertNote, setRevertNote] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [error, setError] = React.useState("");

  const versions = versionsQuery.data ?? [];

  const doRevert = async (): Promise<void> => {
    if (revertTarget == null) return;
    setError("");
    setMsg("");
    try {
      await revertMut.mutateAsync({
        id: item.id,
        version: revertTarget,
        note: revertNote || undefined,
      });
      setMsg(t("media.reverted"));
      setRevertTarget(null);
      setRevertNote("");
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "880px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
          {t("media.versionsTitle")}
        </h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("media.versionsHint")}
        </p>
      </div>

      <QueryState
        isLoading={versionsQuery.isLoading}
        isError={versionsQuery.isError}
        error={versionsQuery.error}
        empty={!versionsQuery.isLoading && !versionsQuery.isError && versions.length === 0}
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("media.tableVersionNum")}</th>
                <th>{t("media.tableCreated")}</th>
                <th>{t("media.tableBy")}</th>
                <th>{t("media.tableSummary")}</th>
                <th>{t("media.tableActions")}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td dir="ltr" style={{ fontWeight: 700 }}>
                    v{v.version}
                    {v.version === item.version ? (
                      <Badge tone="success" style={{ marginInlineStart: "0.4rem" }}>
                        {t("media.currentVersion")}
                      </Badge>
                    ) : null}
                  </td>
                  <td>{v.created_at ? formatDate(locale, v.created_at) : "—"}</td>
                  <td dir="ltr">{v.created_by ?? "—"}</td>
                  <td>
                    <div>{v.summary}</div>
                    {v.note ? <div className="hint" style={{ margin: 0 }}>{v.note}</div> : null}
                  </td>
                  <td>
                    {v.version !== item.version ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRevertTarget(v.version);
                          setRevertNote("");
                        }}
                        disabled={!canManage}
                      >
                        {t("media.viewRevert")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      {revertTarget != null && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("media.viewRevert")} → v{revertTarget}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="hint">{t("media.confirmRevert")}</p>
            <Field label={t("media.revertNote")}>
              <input
                className="input"
                value={revertNote}
                onChange={(e) => setRevertNote(e.target.value)}
                placeholder={t("media.revertNotePlaceholder")}
              />
            </Field>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <Button
                size="sm"
                onClick={() => void doRevert()}
                disabled={revertMut.isPending || !canManage}
              >
                {t("media.viewRevert")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRevertTarget(null)}>
                {t("media.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {msg ? <p className="hint">{msg}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* review queue — real human review                                    */
/* ------------------------------------------------------------------ */

interface Checklist {
  av: boolean;
  meta: boolean;
  transcript: boolean;
  cover: boolean;
}

const EMPTY_CHECKLIST: Checklist = { av: false, meta: false, transcript: false, cover: false };

function ReviewCard({
  item,
  onDone,
}: {
  item: LibraryItem;
  onDone: () => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const transitionMut = useTransitionLibraryItem();

  const [check, setCheck] = React.useState<Checklist>(EMPTY_CHECKLIST);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState("");

  const allChecked = check.av && check.meta && check.transcript && check.cover;

  const decide = async (to: "approved" | "rejected"): Promise<void> => {
    setError("");
    try {
      await transitionMut.mutateAsync({ id: item.id, to, note: notes || undefined });
      onDone();
    } catch (e) {
      setError(errText(e));
    }
  };

  const set = (k: keyof Checklist) => (v: boolean): void =>
    setCheck((prev) => ({ ...prev, [k]: v }));

  return (
    <Card>
      <CardContent>
        <div style={{ display: "flex", gap: "0.8rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
              <KindBadge kind={item.kind} />
              <SourceBadge item={item} />
              <span className="hint" dir="ltr" style={{ margin: 0 }}>
                v{item.version}
              </span>
            </div>
            <div style={{ fontWeight: 700, color: "var(--x-text)", marginTop: "0.4rem" }}>
              {l10n(locale, item.title) || <span className="hint">—</span>}
            </div>
            <div className="hint" style={{ margin: "0.2rem 0 0" }}>
              {t("media.sourceLabel")}: {item.source_ref || t(`media.source_${item.source_type}`)}
              {item.scholar_name || item.scholar_id ? ` · ${item.scholar_name || item.scholar_id}` : ""}
            </div>
            {item.media_url ? (
              <div style={{ marginTop: "0.5rem" }}>
                {item.kind === "audio" ? (
                  <audio controls src={item.media_url} preload="metadata" style={{ width: "100%" }} />
                ) : item.kind === "video" || item.kind === "video_360" ? (
                  <video controls src={item.media_url} preload="metadata" style={{ width: "100%", maxHeight: "220px", borderRadius: "8px", background: "#000" }} />
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div className="hint" style={{ marginBottom: "0.4rem" }}>
              {t("media.checklistTitle")}
            </div>
            <div style={{ display: "grid", gap: "0.45rem" }}>
              <Toggle checked={check.av} onChange={set("av")} label={t("media.checkAv")} disabled={!canManage} />
              <Toggle checked={check.meta} onChange={set("meta")} label={t("media.checkMeta")} disabled={!canManage} />
              <Toggle checked={check.transcript} onChange={set("transcript")} label={t("media.checkTranscript")} disabled={!canManage} />
              <Toggle checked={check.cover} onChange={set("cover")} label={t("media.checkCover")} disabled={!canManage} />
            </div>
            <Field label={t("media.reviewNotes")}>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("media.reviewNotesPlaceholder")}
                disabled={!canManage}
              />
            </Field>
            {error ? <p className="form-error">{error}</p> : null}
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <Button
                size="sm"
                onClick={() => void decide("approved")}
                disabled={transitionMut.isPending || !allChecked || !canManage}
                title={!allChecked ? t("media.checklistTitle") : undefined}
              >
                {t("media.approve")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void decide("rejected")}
                disabled={transitionMut.isPending || !notes.trim() || !canManage}
                title={!notes.trim() ? t("media.reviewNotes") : undefined}
              >
                {t("media.reject")}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewTab({ onSelect }: { onSelect: (id: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const query = useLibraryItemsQuery({ workflow_status: "in_review" });
  const items = query.data?.items ?? [];

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "980px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
          {t("media.reviewTitle")} <Badge tone="warning">{items.length}</Badge>
        </h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("media.reviewHint")}
        </p>
      </div>
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        empty={!query.isLoading && !query.isError && items.length === 0}
      >
        {items.map((it) => (
          <ReviewCard
            key={it.id}
            item={it}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ["library"] });
              onSelect(it.id);
            }}
          />
        ))}
      </QueryState>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* placement & distribution                                            */
/* ------------------------------------------------------------------ */

const SURFACES = ["homepage", "scholar_page", "course_page", "web_widget", "mobile_featured"] as const;

function PlacementTab({ item }: { item: LibraryItem }): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const updateMut = useUpdateLibraryItem();

  const [surfaces, setSurfaces] = React.useState<string[]>(item.placements);
  const [telegram, setTelegram] = React.useState<TelegramPolicy>(item.telegram_policy);
  const [loadedId, setLoadedId] = React.useState(item.id);
  const [msg, setMsg] = React.useState("");
  const [error, setError] = React.useState("");

  if (item.id !== loadedId) {
    setLoadedId(item.id);
    setSurfaces(item.placements);
    setTelegram(item.telegram_policy);
    setMsg("");
    setError("");
  }

  const toggleSurface = (s: string): void =>
    setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const save = async (): Promise<void> => {
    setError("");
    setMsg("");
    try {
      await updateMut.mutateAsync({
        id: item.id,
        metadata: { ...metadataFromItem(item), placements: surfaces, telegram_policy: telegram },
      });
      setMsg(t("media.savedPlacement"));
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "880px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
          {t("media.placementTitle")}
        </h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("media.placementHint")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("media.surfacesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {SURFACES.map((s) => {
              const on = surfaces.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSurface(s)}
                  disabled={!canManage}
                  className="input"
                  style={{
                    width: "auto",
                    padding: "0.4rem 0.9rem",
                    cursor: canManage ? "pointer" : "not-allowed",
                    background: on ? "var(--x-gold)" : "transparent",
                    color: on ? "#1a1408" : "var(--x-text2)",
                    border: on ? "1px solid var(--x-gold)" : "1px solid var(--x-line)",
                    borderRadius: "999px",
                  }}
                >
                  {t(`media.surf_${s}`)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("media.telegramTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label={t("media.telegramTitle")}>
            <select
              className="input"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value as TelegramPolicy)}
              disabled={!canManage}
              style={{ maxWidth: "20rem" }}
            >
              {TELEGRAM_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {t(`media.tg_${p}`)}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      {msg ? <p className="hint">{msg}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div>
        <Button onClick={() => void save()} disabled={updateMut.isPending || !canManage}>
          {t("media.savePlacement")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Phase 16 (Track 3, CRM) — reverse direction of the related-entity link:
 * tasks that were linked to this library item from the project board
 * (GET /api/v1/projects/tasks/by-entity). Read-only here; linking and
 * editing happen on /projects. ADR-001: rendering only — the hook lives in
 * lib/projects16.ts.
 */
function TasksTab({ item }: { item: LibraryItem }): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const linked = useTasksByEntity("library_item", item.id);
  const tasks = linked.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("proj16.itemLinkedTasks")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("proj16.itemLinkedTasksHint")}{" "}
          <Link to="/projects">{t("proj16.goToProjects")}</Link>
        </p>
        {linked.isLoading && <p className="empty">{t("common.loading")}</p>}
        {linked.isError && <p className="form-error">{errText(linked.error)}</p>}
        {linked.isSuccess && tasks.length === 0 && (
          <p className="empty">{t("proj16.emptyColumn")}</p>
        )}
        {linked.isSuccess && tasks.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>{t("proj16.title")}</th>
                <th>{t("proj16.status")}</th>
                <th>{t("proj16.assignee")}</th>
                <th>{t("proj16.dueDate")}</th>
                <th>{t("proj16.priority")}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{l10n(locale, task.title) || task.id.slice(0, 8)}</td>
                  <td>
                    <Badge tone={taskStatusTone(task.status)}>{t(`proj16.status_${task.status}`)}</Badge>
                  </td>
                  <td>{task.assignee_name ?? t("proj16.unassigned")}</td>
                  <td>{task.due_date ? formatDate(task.due_date) : "—"}</td>
                  <td>
                    <Badge tone={taskPriorityTone(task.priority)}>{t(`proj16.priority_${task.priority}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function DetailGate({
  itemId,
  children,
}: {
  itemId: string | null;
  children: (item: LibraryItem) => React.ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  const query = useLibraryItemQuery(itemId);
  if (!itemId) return <p className="hint">{t("media.pickItemFirst")}</p>;
  if (query.isLoading) return <p className="hint">{t("common.loading")}</p>;
  if (query.isError || !query.data)
    return (
      <p className="form-error">
        {t("media.itemNotFound")}: {query.error ? errText(query.error) : ""}
      </p>
    );
  return <>{children(query.data)}</>;
}

export default function MediaManager(): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const [tab, setTab] = React.useState<MediaTab>(initialTab);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialSelectedId);

  const goManage = (id: string): void => {
    setSelectedId(id);
    setTab("upload");
  };

  const detailTabs: MediaTab[] = ["upload", "transcript", "ai", "versions", "placement", "tasks"];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("media.title")}</h1>
          <p className="hint">{t("media.hint")}</p>
        </div>
        {canManage ? null : (
          <Badge tone="danger">{t("media.needsPermission")}</Badge>
        )}
      </div>

      {!canManage ? (
        <Card>
          <CardContent>
            <p className="form-error" style={{ margin: 0 }}>
              {t("media.needsPermission")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label={t("media.title")}>
            {TABS.map((tb) => (
              <button
                key={tb}
                role="tab"
                aria-selected={tab === tb}
                className={tab === tb ? "tab active" : "tab"}
                onClick={() => setTab(tb)}
              >
                {t(TAB_KEY[tb])}
                {detailTabs.includes(tb) && selectedId ? " ●" : ""}
              </button>
            ))}
          </div>

          {tab === "list" && <LibraryListTab onSelect={goManage} />}
          {tab === "review" && (
            <ReviewTab
              onSelect={(id) => {
                setSelectedId(id);
              }}
            />
          )}
          {/* edit mode when an item is selected, blank create form otherwise */}
          {tab === "upload" && selectedId && (
            <DetailGate itemId={selectedId}>
              {(item) => (
                <UploadTab
                  item={item}
                  onCreated={(id) => setSelectedId(id)}
                  onSelectItem={(id) => setSelectedId(id)}
                />
              )}
            </DetailGate>
          )}
          {tab === "upload" && !selectedId && (
            <UploadTab item={null} onCreated={(id) => setSelectedId(id)} onSelectItem={(id) => setSelectedId(id)} />
          )}
          {tab === "transcript" && (
            <DetailGate itemId={selectedId}>{(item) => <TranscriptTab item={item} />}</DetailGate>
          )}
          {tab === "ai" && (
            <DetailGate itemId={selectedId}>{(item) => <AiScopesTab item={item} />}</DetailGate>
          )}
          {tab === "versions" && (
            <DetailGate itemId={selectedId}>{(item) => <VersionsTab item={item} />}</DetailGate>
          )}
          {tab === "placement" && (
            <DetailGate itemId={selectedId}>{(item) => <PlacementTab item={item} />}</DetailGate>
          )}
          {tab === "tasks" && (
            <DetailGate itemId={selectedId}>{(item) => <TasksTab item={item} />}</DetailGate>
          )}
        </>
      )}
    </div>
  );
}
