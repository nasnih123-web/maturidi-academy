/**
 * Phase 14 — Role & permission management (Track 2: CRM frontend).
 *
 * super_admin only (§2 RBAC): roles list, create/rename/delete, and the
 * permission matrix editor. Presentational only — all logic in
 * lib/admin14.ts + lib/admin14Hooks.ts.
 */

import React from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { errText, type Permission, type Role } from "../lib/admin14";
import { useRoleMutation, useRoles } from "../lib/admin14Hooks";

function PermissionMatrix({
  permissions,
  granted,
  onToggle,
}: {
  permissions: Permission[];
  granted: Set<string>;
  onToggle: (key: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const byModule = React.useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of permissions) {
      const arr = m.get(p.module) ?? [];
      arr.push(p);
      m.set(p.module, arr);
    }
    return [...m.entries()];
  }, [permissions]);

  return (
    <div>
      {byModule.map(([module, perms]) => (
        <fieldset key={module} className="perm-group">
          <legend className="mono">{module}</legend>
          <div className="channel-grid">
            {perms.map((p) => (
              <label key={p.key} className="switch-row" title={p.description}>
                <input
                  type="checkbox"
                  checked={granted.has(p.key)}
                  onChange={() => onToggle(p.key)}
                />
                <code>{p.key}</code>
                <span className="hint">{p.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {permissions.length === 0 && <p className="hint">{t("admin14.roleSelect")}</p>}
    </div>
  );
}

export default function Roles(): React.ReactElement {
  const { t } = useI18n();
  const { isSuperAdmin } = useAuth();
  const list = useRoles();
  const mut = useRoleMutation();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [granted, setGranted] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [editing, setEditing] = React.useState<Role | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const roles = list.data?.roles ?? [];
  const permissions = list.data?.permissions ?? [];
  const selected = roles.find((r) => r.id === selectedId) ?? null;

  React.useEffect(() => {
    if (selected) setGranted(new Set(selected.permissions));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <h1>{t("admin14.roleTitle")}</h1>
        <div className="panel" role="alert">
          <p>{t("admin14.roleSuperOnly")}</p>
        </div>
      </div>
    );
  }

  const toggle = (key: string): void => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="page" style={{ maxWidth: "1200px" }}>
      <h1>{t("admin14.roleTitle")}</h1>
      <p className="hint">{t("admin14.roleHint")}</p>

      {list.isLoading && <p className="hint">{t("common.loading")}</p>}
      {list.isError && (
        <div className="panel" role="alert">
          <p>{t("admin14.backendMissing")}</p>
          <p className="hint">{errText(list.error)}</p>
          <button type="button" className="btn" onClick={() => void list.refetch()}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {list.isSuccess && (
        <div className="two-col">
          <section className="panel" aria-label={t("admin14.roleList")}>
            <div className="row" style={{ marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0 }}>{t("admin14.roleList")}</h3>
              <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                {t("admin14.roleCreate")}
              </button>
            </div>
            <ul className="compact-list">
              {roles.map((r) => (
                <li key={r.id} className={r.id === selectedId ? "selected" : undefined}>
                  <button type="button" className="link" onClick={() => setSelectedId(r.id)}>
                    <strong>{r.name}</strong>
                  </button>{" "}
                  <span className="hint">
                    {r.user_count} {t("admin14.roleUsers")} · {r.permissions.length} perms
                  </span>
                  <div className="row">
                    <button type="button" className="btn" onClick={() => setEditing(r)}>
                      {t("common.edit")}
                    </button>
                    <button type="button" className="btn danger" onClick={() => setConfirmDelete(r.id)}>
                      {t("common.delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {creating && (
              <div className="dialog-backdrop">
                <div className="dialog" role="dialog" aria-modal="true" aria-label={t("admin14.roleCreate")}>
                  <h3>{t("admin14.roleCreate")}</h3>
                  <div className="form-grid">
                    <label>
                      {t("admin14.roleName")}
                      <input value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </label>
                    <label>
                      {t("admin14.roleDesc")}
                      <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                    </label>
                  </div>
                  <div className="row" style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!newName.trim() || mut.create.isPending}
                      onClick={() =>
                        mut.create.mutate(
                          { name: newName.trim(), description: newDesc.trim() || undefined },
                          { onSuccess: () => { setCreating(false); setNewName(""); setNewDesc(""); } },
                        )
                      }
                    >
                      {t("common.save")}
                    </button>
                    <button type="button" className="btn" onClick={() => setCreating(false)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {editing && (
              <div className="dialog-backdrop">
                <div className="dialog" role="dialog" aria-modal="true" aria-label={t("admin14.roleEdit")}>
                  <h3>{t("admin14.roleEdit")}</h3>
                  <div className="form-grid">
                    <label>
                      {t("admin14.roleName")}
                      <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    </label>
                    <label>
                      {t("admin14.roleDesc")}
                      <input
                        value={editing.description}
                        onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="row" style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={mut.update.isPending}
                      onClick={() =>
                        mut.update.mutate(
                          { id: editing.id, patch: { name: editing.name, description: editing.description } },
                          { onSuccess: () => setEditing(null) },
                        )
                      }
                    >
                      {t("common.save")}
                    </button>
                    <button type="button" className="btn" onClick={() => setEditing(null)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {confirmDelete && (
              <div className="dialog-backdrop">
                <div className="dialog" role="dialog" aria-modal="true" aria-label={t("admin14.confirmTitle")}>
                  <h3>{t("admin14.confirmTitle")}</h3>
                  <p>{t("admin14.roleDeleteConfirm")}</p>
                  <div className="row">
                    <button
                      type="button"
                      className="btn danger"
                      disabled={mut.remove.isPending}
                      onClick={() =>
                        mut.remove.mutate(confirmDelete, {
                          onSuccess: () => {
                            setConfirmDelete(null);
                            if (selectedId === confirmDelete) setSelectedId(null);
                          },
                        })
                      }
                    >
                      {t("common.delete")}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="panel" aria-label={t("admin14.rolePerms")}>
            <h3>{t("admin14.rolePerms")}{selected ? ` — ${selected.name}` : ""}</h3>
            {!selected && <p className="hint">{t("admin14.roleSelect")}</p>}
            {selected && (
              <>
                <PermissionMatrix permissions={permissions} granted={granted} onToggle={toggle} />
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: "0.75rem" }}
                  disabled={mut.setPermissions.isPending}
                  onClick={() =>
                    mut.setPermissions.mutate({ id: selected.id, keys: [...granted] })
                  }
                >
                  {t("common.save")}
                </button>
                {mut.setPermissions.isSuccess && <p className="ok-text">{t("admin14.rolePermsSaved")}</p>}
                {mut.setPermissions.isError && <p className="error-text">{errText(mut.setPermissions.error)}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
