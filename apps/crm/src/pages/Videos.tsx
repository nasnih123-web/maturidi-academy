import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { useAuth } from "../lib/auth";
import { useI18n, type Locale } from "../lib/i18n";
import { EMPTY_L10N, type LocalizedText } from "../lib/contentApi";
import LocalizedInput from "../components/LocalizedInput";
import {
  buildCreateForm,
  defaultMetadata,
  errText,
  useCreateLibraryItem,
} from "../lib/library";
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  fetchVideosSettings,
  listCandidates,
  listPlaylists,
  removePlaylistItem,
  reorderPlaylistItems,
  saveVideosSettings,
  updatePlaylist,
  SUBTITLE_LANGS,
  type AdminPlaylist,
  type VideosSettingsValues,
} from "../lib/videos";

/**
 * Videos admin — playlists over library video items + the `videos.*`
 * platform settings. The videos themselves live in the library: the
 * upload here reuses the library create flow (multipart → draft), and
 * publishing/editing happens in MediaManager. No subtitle-status card
 * (phase 3) and no invented data.
 */

function pickTitle(text: LocalizedText | null, locale: Locale): string {
  if (!text) return "";
  return text[locale] || text.fa || text.en || text.ar || "";
}

function formatDur(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface PlaylistFormState {
  title: LocalizedText;
  description: LocalizedText;
  sort_order: number;
  is_published: boolean;
}

const EMPTY_FORM: PlaylistFormState = {
  title: { ...EMPTY_L10N },
  description: { ...EMPTY_L10N },
  sort_order: 0,
  is_published: false,
};

export default function Videos(): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("library.manage");
  const queryClient = useQueryClient();

  const playlistsQuery = useQuery({
    queryKey: ["videos-playlists"],
    queryFn: listPlaylists,
    enabled: canManage,
  });
  const playlists = playlistsQuery.data ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["videos-playlists"] });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<PlaylistFormState>(EMPTY_FORM);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title,
        description: form.description,
        sort_order: form.sort_order,
        is_published: form.is_published,
      };
      if (editingId) return updatePlaylist(editingId, body);
      return createPlaylist(body);
    },
    onSuccess: () => {
      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setFormError(null);
      void invalidate();
    },
    onError: (err) => setFormError(errText(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePlaylist(id),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void invalidate();
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (pl: AdminPlaylist) => {
    setEditingId(pl.id);
    setForm({
      title: { ...EMPTY_L10N, ...(pl.title ?? {}) },
      description: { ...EMPTY_L10N, ...(pl.description ?? {}) },
      sort_order: pl.sort_order,
      is_published: pl.is_published,
    });
    setFormError(null);
    setFormOpen(true);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("videos.title")}</h1>
          <p className="hint">{t("videos.hint")}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setUploadOpen((v) => !v)}>
            {t("videos.addVideo")}
          </Button>
        ) : (
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
          {uploadOpen ? (
            <UploadPanel
              playlists={playlists}
              onDone={() => void invalidate()}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("videos.playlistsTitle")}</CardTitle>
              <Button onClick={openCreate}>{t("videos.newPlaylist")}</Button>
            </CardHeader>
            <CardContent>
              {playlistsQuery.isLoading ? (
                <p className="hint">{t("videos.loading")}</p>
              ) : playlistsQuery.isError ? (
                <p className="form-error">{t("videos.error")}</p>
              ) : playlists.length === 0 ? (
                <p className="hint">{t("videos.empty")}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  {playlists.map((pl) => (
                    <div
                      key={pl.id}
                      style={{
                        border: "1px solid var(--border, #ddd)",
                        borderRadius: "0.8rem",
                        padding: "0.9rem 1rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.7rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <strong>{pickTitle(pl.title, locale) || pl.id}</strong>
                        <Badge tone={pl.is_published ? "success" : "warning"}>
                          {pl.is_published
                            ? t("videos.published")
                            : t("videos.draft")}
                        </Badge>
                        <span className="hint">
                          {pl.item_count} · #{pl.sort_order}
                        </span>
                        <span style={{ marginInlineStart: "auto", display: "flex", gap: "0.4rem" }}>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setExpandedId(expandedId === pl.id ? null : pl.id)
                            }
                          >
                            {expandedId === pl.id
                              ? t("videos.collapse")
                              : t("videos.expand")}
                          </Button>
                          <Button variant="ghost" onClick={() => openEdit(pl)}>
                            {t("videos.edit")}
                          </Button>
                          {confirmDeleteId === pl.id ? (
                            <Button
                              variant="danger"
                              onClick={() => deleteMut.mutate(pl.id)}
                              disabled={deleteMut.isPending}
                            >
                              {t("videos.deleteConfirm")}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => setConfirmDeleteId(pl.id)}
                            >
                              {t("videos.delete")}
                            </Button>
                          )}
                        </span>
                      </div>
                      {expandedId === pl.id ? (
                        <PlaylistItems playlist={pl} onChanged={invalidate} />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {formOpen ? (
                <div
                  style={{
                    marginTop: "1.2rem",
                    borderTop: "1px dashed var(--border, #ddd)",
                    paddingTop: "1rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.8rem",
                  }}
                >
                  <LocalizedInput
                    id="pl-title"
                    label={t("videos.titleFa")}
                    value={form.title}
                    onChange={(v) => setForm({ ...form, title: v })}
                  />
                  <LocalizedInput
                    id="pl-desc"
                    label={t("videos.descFa")}
                    value={form.description}
                    onChange={(v) => setForm({ ...form, description: v })}
                    multiline
                  />
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "end" }}>
                    <div className="field">
                      <label htmlFor="pl-sort">{t("videos.sortOrder")}</label>
                      <input
                        id="pl-sort"
                        className="input"
                        type="number"
                        value={form.sort_order}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sort_order: Number(e.target.value) || 0,
                          })
                        }
                        style={{ width: "7rem" }}
                      />
                    </div>
                    <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={form.is_published}
                        onChange={(e) =>
                          setForm({ ...form, is_published: e.target.checked })
                        }
                      />
                      {t("videos.isPublished")}
                    </label>
                  </div>
                  {formError ? <p className="form-error">{formError}</p> : null}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      onClick={() => saveMut.mutate()}
                      disabled={saveMut.isPending}
                    >
                      {editingId ? t("videos.save") : t("videos.create")}
                    </Button>
                    <Button variant="ghost" onClick={() => setFormOpen(false)}>
                      {t("videos.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <VideosSettingsCard />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playlist items + candidate picker                                   */
/* ------------------------------------------------------------------ */

function PlaylistItems({
  playlist,
  onChanged,
}: {
  playlist: AdminPlaylist;
  onChanged: () => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const [q, setQ] = React.useState("");
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  const candidatesQuery = useQuery({
    queryKey: ["videos-candidates", q],
    queryFn: () => listCandidates(q),
  });

  const moveMut = useMutation({
    mutationFn: (ids: string[]) => reorderPlaylistItems(playlist.id, ids),
    onSuccess: onChanged,
  });
  const removeMut = useMutation({
    mutationFn: (itemId: string) => removePlaylistItem(playlist.id, itemId),
    onSuccess: onChanged,
  });
  const addMut = useMutation({
    mutationFn: (itemId: string) => addPlaylistItem(playlist.id, itemId),
    onSuccess: () => {
      setPickerError(null);
      onChanged();
    },
    onError: (err) => setPickerError(errText(err)),
  });

  const ids = playlist.items.map((i) => i.item_id);
  const inPlaylist = new Set(ids);
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...ids];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    moveMut.mutate(next);
  };

  return (
    <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <strong>{t("videos.itemsTitle")}</strong>
      {playlist.items.length === 0 ? (
        <p className="hint">{t("videos.noCandidates")}</p>
      ) : (
        <ol style={{ margin: 0, paddingInlineStart: "1.2rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {playlist.items.map((item, idx) => (
            <li key={item.item_id}>
              <span style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                <span>{pickTitle(item.title, locale) || item.item_id}</span>
                <Badge tone={item.workflow_status === "published" ? "success" : "warning"}>
                  {item.workflow_status === "published"
                    ? t("videos.wfPublished")
                    : item.workflow_status === "draft"
                      ? t("videos.wfDraft")
                      : item.workflow_status}
                </Badge>
                {item.duration_seconds ? (
                  <span className="hint" dir="ltr">
                    {formatDur(item.duration_seconds)}
                  </span>
                ) : null}
                <span style={{ marginInlineStart: "auto", display: "flex", gap: "0.3rem" }}>
                  <Button variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0 || moveMut.isPending}>
                    ↑ {t("videos.moveUp")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => move(idx, 1)}
                    disabled={idx === playlist.items.length - 1 || moveMut.isPending}
                  >
                    ↓ {t("videos.moveDown")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => removeMut.mutate(item.item_id)}
                    disabled={removeMut.isPending}
                  >
                    {t("videos.remove")}
                  </Button>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="field">
        <label htmlFor={`picker-${playlist.id}`}>{t("videos.pickerTitle")}</label>
        <input
          id={`picker-${playlist.id}`}
          className="input"
          type="search"
          placeholder={t("videos.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {pickerError ? <p className="form-error">{pickerError}</p> : null}
      {candidatesQuery.isLoading ? (
        <p className="hint">{t("videos.loading")}</p>
      ) : (candidatesQuery.data ?? []).length === 0 ? (
        <p className="hint">{t("videos.noCandidates")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {(candidatesQuery.data ?? []).map((c) => (
            <div
              key={c.id}
              style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}
            >
              <span>{pickTitle(c.title, locale) || c.id}</span>
              <Badge tone={c.workflow_status === "published" ? "success" : "warning"}>
                {c.workflow_status === "published"
                  ? t("videos.wfPublished")
                  : c.workflow_status === "draft"
                    ? t("videos.wfDraft")
                    : c.workflow_status}
              </Badge>
              <span style={{ marginInlineStart: "auto" }}>
                <Button
                  variant="ghost"
                  disabled={inPlaylist.has(c.id) || addMut.isPending}
                  onClick={() => addMut.mutate(c.id)}
                >
                  {t("videos.add")}
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upload a new video (library create flow, kind=video, draft)         */
/* ------------------------------------------------------------------ */

function UploadPanel({
  playlists,
  onDone,
}: {
  playlists: AdminPlaylist[];
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const createMut = useCreateLibraryItem();
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState<LocalizedText>({ ...EMPTY_L10N });
  const [playlistId, setPlaylistId] = React.useState<string>("");
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (!file) return;
    setError(null);
    try {
      const metadata = { ...defaultMetadata("video"), title };
      const item = await createMut.mutateAsync(buildCreateForm(file, metadata, null));
      if (playlistId) {
        await addPlaylistItem(playlistId, item.id);
      }
      setDone(true);
      setFile(null);
      setTitle({ ...EMPTY_L10N });
      onDone();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("videos.uploadTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="hint">{t("videos.uploadHint")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.6rem" }}>
          <div className="field">
            <label htmlFor="vid-file">{t("videos.fileLabel")}</label>
            <input
              id="vid-file"
              className="input"
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <LocalizedInput
            id="vid-title"
            label={t("videos.titleFa")}
            value={title}
            onChange={setTitle}
          />
          {playlists.length > 0 ? (
            <div className="field">
              <label htmlFor="vid-playlist">{t("videos.playlistsTitle")}</label>
              <select
                id="vid-playlist"
                className="input"
                value={playlistId}
                onChange={(e) => setPlaylistId(e.target.value)}
              >
                <option value="">—</option>
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pickTitle(pl.title, "fa") || pl.id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          {done ? <p className="hint">{t("videos.uploadedOk")}</p> : null}
          <div>
            <Button onClick={() => void submit()} disabled={!file || createMut.isPending}>
              {t("videos.uploadBtn")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* videos.* settings card                                              */
/* ------------------------------------------------------------------ */

function VideosSettingsCard(): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["videos-settings"],
    queryFn: fetchVideosSettings,
  });
  const [values, setValues] = React.useState<VideosSettingsValues | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (settingsQuery.data && !seededRef.current) {
      seededRef.current = true;
      setValues(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const saveMut = useMutation({
    mutationFn: (v: VideosSettingsValues) => saveVideosSettings(v),
    onSuccess: () => {
      setSaved(true);
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["videos-settings"] });
      window.setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => setSaveError(errText(err)),
  });

  const langLabel = (l: string): string =>
    t(
      `videos.lang${l === "fa" ? "Fa" : l === "ar" ? "Ar" : l === "en" ? "En" : l === "ur" ? "Ur" : "Dari"}`,
    );

  const boolRow = (
    key: keyof VideosSettingsValues,
    label: string,
  ): React.ReactElement => (
    <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <input
        type="checkbox"
        checked={Boolean(values?.[key])}
        onChange={(e) =>
          values && setValues({ ...values, [key]: e.target.checked })
        }
      />
      {label}
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("videos.settingsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {settingsQuery.isLoading || !values ? (
          <p className="hint">{t("videos.loading")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {boolRow("home_enabled", t("videos.homeEnabled"))}
            <div className="field">
              <label>{t("videos.sidebarSide")}</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {(["left", "right"] as const).map((side) => (
                  <Button
                    key={side}
                    variant={values.sidebar_side === side ? "primary" : "ghost"}
                    onClick={() => setValues({ ...values, sidebar_side: side })}
                  >
                    {side === "left" ? t("videos.sideLeft") : t("videos.sideRight")}
                  </Button>
                ))}
              </div>
            </div>
            {boolRow("autoplay_next", t("videos.autoplayNext"))}
            {boolRow("resume_playback", t("videos.resumePlayback"))}
            {boolRow("player_speed", t("videos.playerSpeed"))}
            {boolRow("player_pip", t("videos.playerPip"))}
            {boolRow("related_enabled", t("videos.relatedEnabled"))}
            {boolRow("subtitles_enabled", t("videos.subtitlesEnabled"))}
            <div className="field">
              <label htmlFor="vid-def-lang">{t("videos.subtitleDefaultLang")}</label>
              <select
                id="vid-def-lang"
                className="input"
                value={values.subtitle_default_lang}
                onChange={(e) =>
                  setValues({ ...values, subtitle_default_lang: e.target.value })
                }
                style={{ maxWidth: "12rem" }}
              >
                {SUBTITLE_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {langLabel(l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("videos.subtitleLangs")}</label>
              <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
                {SUBTITLE_LANGS.map((l) => (
                  <label key={l} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={values.subtitle_langs.includes(l)}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          subtitle_langs: e.target.checked
                            ? [...values.subtitle_langs, l]
                            : values.subtitle_langs.filter((x) => x !== l),
                        })
                      }
                    />
                    {langLabel(l)}
                  </label>
                ))}
              </div>
            </div>
            {saveError ? <p className="form-error">{saveError}</p> : null}
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
              <Button
                onClick={() => values && saveMut.mutate(values)}
                disabled={saveMut.isPending}
              >
                {t("videos.save")}
              </Button>
              {saved ? <span className="hint">{t("videos.saved")}</span> : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
