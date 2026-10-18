import React from "react";
import { Badge, Button, statusTone } from "@maturidi/ui-web";
import {
  WORKFLOW_TRANSITIONS,
  WorkflowStatus,
} from "../lib/contentApi";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";

/**
 * §9 workflow bar: shows current status and offers only the legal next
 * transitions. Buttons that move content toward the public
 * (approve/publish) require `content.publish` (RBAC, contract §2);
 * the auth stub falls back to permissive, same as the rest of the CRM.
 * Emits `onTransition(to)` — the caller owns the mutation.
 */
export default function WorkflowBar({
  status,
  pending = false,
  onTransition,
}: {
  status: WorkflowStatus;
  pending?: boolean;
  onTransition: (to: WorkflowStatus) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const next = WORKFLOW_TRANSITIONS[status] ?? [];

  const labelFor = (s: WorkflowStatus): string => {
    const k = t(`status.${s}`);
    return k === `status.${s}` ? s : k;
  };

  const needsPublishPerm = (s: WorkflowStatus): boolean =>
    s === "approved" || s === "published";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        flexWrap: "wrap",
      }}
    >
      <span className="hint" style={{ margin: 0 }}>
        {t("studio.workflow")}:
      </span>
      <Badge tone={statusTone(status)}>{labelFor(status)}</Badge>
      {next.map((s) => {
        const locked = needsPublishPerm(s) && !hasPermission("content.publish");
        return (
          <Button
            key={s}
            size="sm"
            variant={s === "published" ? undefined : "secondary"}
            disabled={pending || locked}
            title={locked ? t("studio.needsPermission") : undefined}
            onClick={() => onTransition(s)}
          >
            {t(`studio.to_${s}`)}
          </Button>
        );
      })}
      {pending && <span className="muted">{t("common.loading")}</span>}
    </div>
  );
}
