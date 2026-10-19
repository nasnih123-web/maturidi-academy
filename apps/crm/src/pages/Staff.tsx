import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import {
  errText,
  l10n,
  useCreateStaff,
  useDeleteStaff,
  useStaffQuery,
  useUpdateStaff,
  type StaffMember,
} from "../lib/projects16";
import { useUserSearch } from "../lib/admin14Hooks";
import { ApiError } from "../lib/api";
import type { LocalizedText } from "../lib/contentApi";

/**
 * Phase 16 — Track 3 (CRM): internal staff directory.
 *
 * - Table: name, localized title, localized department, joined date,
 *   active status, actions (edit / deactivate-reactivate / delete).
 * - Add/edit dialog: user picker (search over admin users), title and
 *   department in fa/ar/en, joined date, active toggle.
 *
 * Explicitly NOT covered (Phase 16 spec): payroll, leave, formal contracts.
 * ADR-001: rendering only — all API access and parsing live in
 * lib/projects16.ts (+ lib/admin14 for the user search).
 */

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

function UserPicker({
  userId,
  userName,
  onPick,
  t,
}: {
  userId: string;
  userName: string | null;
  onPick: (id: string, name: string | null) => void;
  t: (p: string) => string;
}): React.ReactElement {
  const [q, setQ] = React.useState("");
  const search = useUserSearch(q.trim() || undefined);
  const results = search.data?.items ?? [];

  return (
    <div className="field">
      <label htmlFor="staff-user-search">{t("proj16.staffUser")}</label>
      {userId ? (
        <div className="kanban-link-line">
          <span className="kanban-link-chip">
            {userName ?? userId.slice(0, 8)}
          </span>
          <Button variant="ghost" onClick={() => onPick("", null)}>
            {t("proj16.unlink")}
          </Button>
        </div>
      ) : (
        <>
          <input
            id="staff-user-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("proj16.staffUserSearchPh")}
          />
          {search.isLoading && <p className="hint">{t("common.loading")}</p>}
          {search.isSuccess && results.length > 0 && (
            <ul className="kanban-search-results">
              {results.slice(0, 8).map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="kanban-search-item"
                    onClick={() => onPick(u.id, u.display_name)}
                  >
                    {u.display_name} <span className="hint" dir="ltr">{u.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function StaffDialog({
  member,
  onClose,
  t,
}: {
  member: StaffMember | null; // null → create
  onClose: () => void;
  t: (p: string) => string;
}): React.ReactElement {
  const [userId, setUserId] = React.useState(member?.user_id ?? "");
  const [userName, setUserName] = React.useState<string | null>(member?.user_name ?? null);
  const [title, setTitle] = React.useState<LocalizedText>(
    member?.title ?? { fa: "", ar: "", en: "" },
  );
  const [department, setDepartment] = React.useState<LocalizedText>(
    member?.department ?? { fa: "", ar: "", en: "" },
  );
  const [joinedDate, setJoinedDate] = React.useState(member?.joined_date?.slice(0, 10) ?? "");
  const [isActive, setIsActive] = React.useState(member?.is_active ?? true);

  const createMut = useCreateStaff();
  const updateMut = useUpdateStaff();
  const saving = createMut.isPending || updateMut.isPending;
  const saveError = createMut.isError ? createMut.error : updateMut.isError ? updateMut.error : null;

  const save = () => {
    if (!userId) return;
    if (member) {
      updateMut.mutate(
        {
          id: member.id,
          title,
          department,
          joined_date: joinedDate || null,
          is_active: isActive,
        },
        { onSuccess: onClose },
      );
    } else {
      createMut.mutate(
        { user_id: userId, title, department, joined_date: joinedDate || undefined },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card kanban-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={member ? t("proj16.editStaff") : t("proj16.newStaff")}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{member ? t("proj16.editStaff") : t("proj16.newStaff")}</h3>

        {member ? (
          <p className="hint">
            {t("proj16.staffUser")}: {member.user_name ?? member.user_id}
          </p>
        ) : (
          <UserPicker
            userId={userId}
            userName={userName}
            onPick={(id, name) => {
              setUserId(id);
              setUserName(name);
            }}
            t={t}
          />
        )}

        {(["fa", "ar", "en"] as const).map((l) => (
          <div className="field" key={l}>
            <label htmlFor={`staff-title-${l}`}>
              {t("proj16.staffTitle")} ({t(`proj16.locale_${l}`)})
            </label>
            <input
              id={`staff-title-${l}`}
              value={title[l]}
              onChange={(e) => setTitle({ ...title, [l]: e.target.value })}
              dir={l === "en" ? "ltr" : "rtl"}
            />
          </div>
        ))}

        {(["fa", "ar", "en"] as const).map((l) => (
          <div className="field" key={l}>
            <label htmlFor={`staff-dept-${l}`}>
              {t("proj16.department")} ({t(`proj16.locale_${l}`)})
            </label>
            <input
              id={`staff-dept-${l}`}
              value={department[l]}
              onChange={(e) => setDepartment({ ...department, [l]: e.target.value })}
              dir={l === "en" ? "ltr" : "rtl"}
            />
          </div>
        ))}

        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label htmlFor="staff-joined">{t("proj16.joinedDate")}</label>
            <input
              id="staff-joined"
              type="date"
              dir="ltr"
              value={joinedDate}
              onChange={(e) => setJoinedDate(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="field-label">{t("proj16.active")}</span>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              {isActive ? t("proj16.activeYes") : t("proj16.activeNo")}
            </label>
          </div>
        </div>

        {saveError && (
          <p className="form-error" role="alert">
            {errText(saveError)}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={saving || (!member && !userId)}
            onClick={save}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Staff(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("projects.manage");

  const staffQ = useStaffQuery();
  const toggleMut = useUpdateStaff();
  const deleteMut = useDeleteStaff();
  const [dialog, setDialog] = React.useState<StaffMember | "create" | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const members = staffQ.data ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("proj16.staffTitlePage")}</h1>
          <p className="hint">{t("proj16.staffHint")}</p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setDialog("create")}>
            {t("proj16.newStaff")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("proj16.staffList")}</CardTitle>
        </CardHeader>
        <CardContent>
          {staffQ.isLoading && <p className="empty">{t("common.loading")}</p>}
          {staffQ.isError && (
            <p className="form-error" role="alert">
              {isForbidden(staffQ.error) ? t("proj16.noPermission") : errText(staffQ.error)}
            </p>
          )}
          {staffQ.isSuccess && members.length === 0 && (
            <p className="empty">{t("proj16.noStaff")}</p>
          )}
          {staffQ.isSuccess && members.length > 0 && (
            <table className="data">
              <thead>
                <tr>
                  <th>{t("proj16.colName")}</th>
                  <th>{t("proj16.colTitle")}</th>
                  <th>{t("proj16.colDepartment")}</th>
                  <th>{t("proj16.colJoined")}</th>
                  <th>{t("proj16.colStatus")}</th>
                  {canManage && <th>{t("proj16.colActions")}</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="kanban-assignee">
                        <span className="kanban-avatar" aria-hidden="true">
                          {(m.user_name ?? "?").trim().charAt(0) || "?"}
                        </span>
                        {m.user_name ?? m.user_id.slice(0, 8)}
                      </span>
                    </td>
                    <td>{l10n(locale, m.title) || "—"}</td>
                    <td>{l10n(locale, m.department) || "—"}</td>
                    <td>{m.joined_date ? formatDate(m.joined_date) : "—"}</td>
                    <td>
                      <Badge tone={m.is_active ? "success" : "neutral"}>
                        {m.is_active ? t("proj16.activeYes") : t("proj16.activeNo")}
                      </Badge>
                    </td>
                    {canManage && (
                      <td>
                        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <Button variant="ghost" onClick={() => setDialog(m)}>
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            loading={toggleMut.isPending}
                            onClick={() =>
                              toggleMut.mutate({ id: m.id, is_active: !m.is_active })
                            }
                          >
                            {m.is_active ? t("proj16.deactivate") : t("proj16.reactivate")}
                          </Button>
                          {confirmDelete === m.id ? (
                            <>
                              <Button
                                variant="primary"
                                loading={deleteMut.isPending}
                                onClick={() =>
                                  deleteMut.mutate(m.id, {
                                    onSuccess: () => setConfirmDelete(null),
                                  })
                                }
                              >
                                {t("proj16.confirmYes")}
                              </Button>
                              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                                {t("common.cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" onClick={() => setConfirmDelete(m.id)}>
                              {t("common.delete")}
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <StaffDialog
          member={dialog === "create" ? null : dialog}
          onClose={() => setDialog(null)}
          t={t}
        />
      )}
    </div>
  );
}
