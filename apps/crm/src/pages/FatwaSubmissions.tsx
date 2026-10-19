import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, statusTone } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import { useEventFeed } from "../lib/events";
import { WorkflowStatus } from "../lib/contentApi";
import { statusLabel } from "../lib/fatwa";
import {
  FATSUB_KEY,
  FatwaSubmission,
  SUBMISSION_STATUSES,
  errText,
  submissionTitle,
  useAddSubmissionToRag,
  useApproveSubmission,
  useFatwaSubmissions,
  usePublishSubmission,
  useRejectSubmission,
} from "../lib/fatwaSubmissions";

/**
 * Fatwa author panel — Phase 10 (CRM track).
 *
 * Workflow board over the shared §9 state machine
 * (draft → in_review → approved → published), one column per stage so every
 * stage is visible. Actions map 1:1 onto the backend transition endpoints:
 *   POST /api/v1/fatwa/submissions/{id}/approve|publish|reject {note?}
 *   POST /api/v1/fatwa/submissions/{id}/add-to-rag  (published only —
 *   confirms that a Phase-6 knowledge chunk is created)
 *
 * Status changes arrive over /ws/events (fatwa.submission_*) and refresh
 * the board without a reload.
 */

function LiveSubmissionStrip(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events } = useEventFeed(60);
  const qc = useQueryClient();
  const subEvents = events.filter((e) => e.event_type.startsWith("fatwa.submission"));
  const latest = subEvents[0];

  React.useEffect(() => {
    if (latest) qc.invalidateQueries({ queryKey: FATSUB_KEY });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.event_id]);

  return (
    <div
      className="panel"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.55rem 1rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}
      aria-live="polite"
    >
      <Badge tone={status === "connected" ? "success" : "neutral"}>{t(`studio.feed_${status}`)}</Badge>
      <span className="hint" style={{ margin: 0 }}>
        {t("fsub.liveSub")}
      </span>
      {latest ? (
        <span style={{ fontSize: "0.82rem", color: "var(--x-text2)" }} dir="ltr">
          <code style={{ fontSize: "0.78rem" }}>{latest.event_type}</code>
          {" · "}
          {formatDate(latest.created_at)}
          {subEvents.length > 1 ? ` · +${subEvents.length - 1}` : ""}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {t("fsub.noLiveYet")}
        </span>
      )}
    </div>
  );
}

type NoteAction = "approve" | "publish" | "reject";

/** Actions the board may offer for a stage — mirrors the backend endpoints. */
function stageActions(status: WorkflowStatus): NoteAction[] {
  switch (status) {
    case "in_review":
      return ["approve", "reject"];
    case "approved":
      return ["publish", "reject"];
    default:
      return [];
  }
}

function ActionDialog({
  submission,
  action,
  onClose,
}: {
  submission: FatwaSubmission;
  action: NoteAction;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [note, setNote] = React.useState("");
  const approve = useApproveSubmission();
  const publish = usePublishSubmission();
  const reject = useRejectSubmission();
  const mut = action === "approve" ? approve : action === "publish" ? publish : reject;
  const pending = approve.isPending || publish.isPending || reject.isPending;
  const err = approve.isError ? approve.error : publish.isError ? publish.error : reject.isError ? reject.error : null;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer slide-in" role="dialog" aria-modal="true" aria-label={t(`fsub.${action}`)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--x-gold2)" }}>
            {t(`fsub.${action}`)}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
            {t("common.close")}
          </Button>
        </div>
        <p dir="auto" style={{ fontSize: "0.92rem", color: "var(--x-text2)" }}>
          {submission.question ? submission.question.slice(0, 160) : "—"}
        </p>
        <div className="field">
          <label htmlFor="sub-note">{t("fsub.actionNote")}</label>
          <textarea
            id="sub-note"
            className="input"
            rows={3}
            dir="auto"
            placeholder={t("fsub.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn-gold"
            disabled={pending}
            onClick={() =>
              mut.mutate(
                { id: submission.id, note: note.trim() || undefined },
                { onSuccess: onClose },
              )
            }
          >
            {pending ? t("common.loading") : t("fsub.confirm")}
          </button>
          {err && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(err)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function SubmissionCard({
  submission,
  onNoteAction,
}: {
  submission: FatwaSubmission;
  onNoteAction: (s: FatwaSubmission, a: NoteAction) => void;
}): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const addRag = useAddSubmissionToRag();

  return (
    <Card style={{ marginBottom: "0.75rem" }}>
      <CardContent>
        <div dir="auto" style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.4rem" }}>
          {submissionTitle(submission, locale)}
        </div>
        {submission.author_name && (
          <div className="hint" style={{ margin: "0 0 0.4rem" }}>
            {t("fsub.author")}: <span dir="auto">{submission.author_name}</span>
          </div>
        )}
        {submission.answer_draft && (
          <div dir="auto" className="muted" style={{ fontSize: "0.82rem", marginBottom: "0.4rem" }}>
            {submission.answer_draft.replace(/\s+/g, " ").slice(0, 120)}
            {submission.answer_draft.length > 120 ? "…" : ""}
          </div>
        )}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          {submission.review_note && <Badge tone="neutral">{t("fsub.hasNote")}</Badge>}
          {submission.in_rag && <Badge tone="success">{t("fsub.inRag")}</Badge>}
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          {stageActions(submission.workflow_status).map((a) => (
            <Button key={a} size="sm" variant={a === "reject" ? "secondary" : "primary"} onClick={() => onNoteAction(submission, a)}>
              {t(`fsub.${a}`)}
            </Button>
          ))}
          {submission.workflow_status === "published" && !submission.in_rag && (
            <Button
              size="sm"
              variant="secondary"
              disabled={addRag.isPending}
              onClick={() => {
                if (window.confirm(t("fsub.ragConfirm"))) addRag.mutate(submission.id);
              }}
            >
              {addRag.isPending ? t("common.loading") : t("fsub.addToRag")}
            </Button>
          )}
        </div>
        {(addRag.isError || addRag.isSuccess) && (
          <div style={{ marginTop: "0.4rem" }}>
            {addRag.isError && (
              <span className="form-error" style={{ marginBottom: 0 }}>
                {errText(addRag.error)}
              </span>
            )}
            {addRag.isSuccess && <Badge tone="success">{t("fsub.ragDone")}</Badge>}
          </div>
        )}
        <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
          {submission.updated_at ? formatDate(submission.updated_at) : "—"}
        </div>
      </CardContent>
    </Card>
  );
}

function BoardColumn({
  status,
  onNoteAction,
}: {
  status: WorkflowStatus;
  onNoteAction: (s: FatwaSubmission, a: NoteAction) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const q = useFatwaSubmissions(status);

  return (
    <section className="panel" aria-label={statusLabel(t, status)} style={{ minWidth: 0 }}>
      <div className="panel-head" style={{ marginBottom: "0.75rem" }}>
        <Badge tone={statusTone(status)}>{statusLabel(t, status)}</Badge>
        <span className="panel-hint">{q.data ? q.data.items.length : "…"}</span>
      </div>
      {q.isLoading && <div className="empty">{t("common.loading")}</div>}
      {q.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => q.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {q.data && q.data.items.length === 0 && (
        <div className="empty">
          <p>{t("fsub.emptyCol")}</p>
        </div>
      )}
      {q.data &&
        q.data.items.map((s) => (
          <SubmissionCard key={s.id} submission={s} onNoteAction={onNoteAction} />
        ))}
    </section>
  );
}

export default function FatwaSubmissions(): React.ReactElement {
  const { t, setLocale } = useI18n();
  const [dialog, setDialog] = React.useState<{ s: FatwaSubmission; a: NoteAction } | null>(null);

  // Deep-link support: ?locale=fa|ar|en
  React.useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("locale");
      if (l === "fa" || l === "ar" || l === "en") setLocale(l);
    } catch {
      // ignore
    }
  }, [setLocale]);

  return (
    <div className="page" style={{ maxWidth: "1400px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>{t("fsub.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("fsub.liveHint")}
      </p>

      <LiveSubmissionStrip />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1rem",
          alignItems: "start",
        }}
      >
        {SUBMISSION_STATUSES.map((s) => (
          <BoardColumn
            key={s}
            status={s}
            onNoteAction={(sub, a) => setDialog({ s: sub, a })}
          />
        ))}
      </div>

      {dialog && (
        <ActionDialog
          submission={dialog.s}
          action={dialog.a}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
