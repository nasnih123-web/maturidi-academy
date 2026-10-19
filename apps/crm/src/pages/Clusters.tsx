import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import { useEventFeed } from "../lib/events";
import {
  CLUSTER_KEY,
  FatwaCluster,
  FatwaClusterDetail,
  errText,
  useAnswerCluster,
  useFatwaCluster,
  useFatwaClusters,
} from "../lib/fatwaSubmissions";

/**
 * Question clusters — Phase 10 (CRM track).
 *
 * Similar questions (embedding-matched by the backend) are grouped into one
 * cluster; the mufti answers ONCE and every member is notified.
 *
 * Contract: GET /api/v1/fatwa/clusters, GET /api/v1/fatwa/clusters/{id}
 * (cluster + members[] + answer), POST /api/v1/fatwa/clusters/{id}/answer
 * {answer}.
 */

function LiveClusterStrip(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events } = useEventFeed(60);
  const qc = useQueryClient();
  const clusterEvents = events.filter((e) => e.event_type.startsWith("fatwa.cluster"));
  const latest = clusterEvents[0];

  React.useEffect(() => {
    if (latest) qc.invalidateQueries({ queryKey: CLUSTER_KEY });
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
        {t("clusters.liveSub")}
      </span>
      {latest ? (
        <span style={{ fontSize: "0.82rem", color: "var(--x-text2)" }} dir="ltr">
          <code style={{ fontSize: "0.78rem" }}>{latest.event_type}</code>
          {" · "}
          {formatDate(latest.created_at)}
          {clusterEvents.length > 1 ? ` · +${clusterEvents.length - 1}` : ""}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {t("clusters.noLiveYet")}
        </span>
      )}
    </div>
  );
}

function AnswerComposer({ cluster }: { cluster: FatwaClusterDetail }): React.ReactElement {
  const { t } = useI18n();
  const [answer, setAnswer] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const answerCluster = useAnswerCluster();
  const empty = answer.trim().length === 0;

  return (
    <section className="panel" aria-label={t("clusters.answerLabel")}>
      <div className="panel-head">
        <h2>{t("clusters.answerLabel")}</h2>
        <Badge tone="warning">{t("clusters.open")}</Badge>
      </div>
      <div className="field">
        <label htmlFor="cluster-answer">{t("clusters.answerText")}</label>
        <textarea
          id="cluster-answer"
          className="input"
          rows={8}
          dir="auto"
          placeholder={t("clusters.answerPlaceholder")}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        {touched && empty && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {t("clusters.answerRequired")}
          </span>
        )}
      </div>
      <p className="hint" style={{ fontSize: "0.88rem" }}>
        {t("clusters.notifyCount").replace("{n}", String(cluster.member_count))}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          className="btn-gold"
          disabled={answerCluster.isPending}
          onClick={() => {
            setTouched(true);
            if (empty || answerCluster.isPending) return;
            answerCluster.mutate({ id: cluster.id, answer: answer.trim() });
          }}
        >
          {answerCluster.isPending ? t("common.loading") : t("clusters.sendAnswer")}
        </button>
        {answerCluster.isError && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(answerCluster.error)}
          </span>
        )}
        {answerCluster.isSuccess && <Badge tone="success">{t("clusters.answeredOk")}</Badge>}
      </div>
    </section>
  );
}

function ClusterDetailView({
  clusterId,
  onBack,
}: {
  clusterId: string;
  onBack: () => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const detail = useFatwaCluster(clusterId);

  return (
    <div>
      <div style={{ marginBottom: "0.75rem" }}>
        <Button size="sm" variant="secondary" onClick={onBack}>
          ← {t("clusters.back")}
        </Button>
      </div>

      {detail.isLoading && <div className="empty">{t("common.loading")}</div>}
      {detail.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => detail.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {detail.data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "start" }}>
          <div>
            <Card style={{ marginBottom: "1rem" }}>
              <CardHeader>
                <CardTitle>{t("clusters.representative")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p dir="auto" style={{ fontSize: "0.95rem", margin: 0 }}>
                  {detail.data.representative_question || "—"}
                </p>
                <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <Badge tone={detail.data.status === "answered" ? "success" : "warning"}>
                    {t(`clusters.${detail.data.status}`)}
                  </Badge>
                  <span className="hint" style={{ margin: 0 }}>
                    {detail.data.member_count} {t("clusters.members")}
                    {detail.data.answered_at
                      ? ` · ${t("clusters.answeredAt")}: ${formatDate(detail.data.answered_at)}`
                      : ""}
                  </span>
                </div>
              </CardContent>
            </Card>

            <section className="panel" aria-label={t("clusters.memberQuestions")}>
              <div className="panel-head">
                <h2>{t("clusters.memberQuestions")}</h2>
                <span className="panel-hint">
                  {detail.data.members.length} {t("clusters.members")}
                </span>
              </div>
              {detail.data.members.length === 0 && (
                <div className="empty">
                  <p>{t("clusters.emptyMembers")}</p>
                </div>
              )}
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {detail.data.members.map((m) => (
                  <li
                    key={m.id}
                    style={{
                      borderBottom: "1px solid var(--x-line)",
                      padding: "0.6rem 0",
                    }}
                  >
                    <p dir="auto" style={{ margin: "0 0 0.3rem", fontSize: "0.9rem" }}>
                      {m.question || "—"}
                    </p>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {m.asker ? (
                        <span dir="auto">
                          {t("clusters.askedBy")}: {m.asker}
                        </span>
                      ) : (
                        t("clusters.anonAsker")
                      )}
                      {m.asked_at ? ` · ${formatDate(m.asked_at)}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div>
            {detail.data.status === "answered" ? (
              <section className="panel" aria-label={t("clusters.answerLabel")}>
                <div className="panel-head">
                  <h2>{t("clusters.answerLabel")}</h2>
                  <Badge tone="success">{t("clusters.answered")}</Badge>
                </div>
                <p dir="auto" style={{ whiteSpace: "pre-wrap", fontSize: "0.92rem", color: "var(--x-text2)" }}>
                  {detail.data.answer_text || "—"}
                </p>
                {detail.data.answered_at && (
                  <p className="muted" style={{ fontSize: "0.8rem" }}>
                    {t("clusters.answeredAt")}: {formatDate(detail.data.answered_at)}
                    {detail.data.answered_by ? ` · ${detail.data.answered_by.slice(0, 8)}…` : ""}
                  </p>
                )}
              </section>
            ) : (
              <AnswerComposer cluster={detail.data} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterRow({
  cluster,
  onOpen,
}: {
  cluster: FatwaCluster;
  onOpen: () => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  return (
    <tr>
      <td dir="auto" style={{ maxWidth: "480px" }}>
        {cluster.representative_question || "—"}
      </td>
      <td>
        <Badge tone="info" dir="ltr">
          {cluster.member_count} {t("clusters.members")}
        </Badge>
      </td>
      <td>
        <Badge tone={cluster.status === "answered" ? "success" : "warning"}>
          {t(`clusters.${cluster.status}`)}
        </Badge>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {cluster.answered_at ? formatDate(cluster.answered_at) : "—"}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Button size="sm" variant="secondary" onClick={onOpen}>
          {t("clusters.openDetail")}
        </Button>
      </td>
    </tr>
  );
}

export default function Clusters(): React.ReactElement {
  const { t, setLocale } = useI18n();
  const clusters = useFatwaClusters();
  const [selectedId, setSelectedId] = React.useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get("cluster");
    } catch {
      return null;
    }
  });

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
    <div className="page" style={{ maxWidth: "1280px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>{t("clusters.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("clusters.liveHint")}
      </p>

      <LiveClusterStrip />

      {selectedId ? (
        <ClusterDetailView clusterId={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <div>
          {clusters.isLoading && <div className="empty">{t("common.loading")}</div>}
          {clusters.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => clusters.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {clusters.data && clusters.data.length === 0 && (
            <div className="empty">
              <p>{t("clusters.emptyClusters")}</p>
            </div>
          )}
          {clusters.data && clusters.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("clusters.tableQuestion")}</th>
                    <th>{t("clusters.tableMembers")}</th>
                    <th>{t("clusters.tableStatus")}</th>
                    <th>{t("clusters.tableAnsweredAt")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.data.map((c) => (
                    <ClusterRow key={c.id} cluster={c} onOpen={() => setSelectedId(c.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
