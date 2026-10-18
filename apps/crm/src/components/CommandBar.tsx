import React from "react";
import { useI18n } from "../lib/i18n";

/**
 * Command palette (Ctrl+K), ported from the turbo CRM visual system.
 * Purely presentational navigation: actions are plain {label, onSelect} pairs
 * supplied by the caller (our react-router routes) — no backend involved.
 */

export interface CommandAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export function CommandBar({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
}): React.ReactElement | null {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      // Focus after paint so the backdrop transition settles.
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open ]);

  if (!open) return null;

  const filtered = actions.filter((a) => a.label.includes(q));
  const clamped = Math.min(sel, Math.max(0, filtered.length - 1));

  function run(a: CommandAction): void {
    onClose();
    a.onSelect();
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      const a = filtered[clamped];
      if (a) {
        e.preventDefault();
        run(a);
      }
    }
  }

  return (
    <div
      className="cmdk-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("cmdk.title")}
      onClick={onClose}
    >
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("cmdk.placeholder")}
          aria-label={t("cmdk.title")}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={filtered[clamped] ? `cmdk-${filtered[clamped].id}` : undefined}
        />
        <ul id="cmdk-list" role="listbox" aria-label={t("cmdk.title")}>
          {filtered.map((a, i) => (
            <li key={a.id} role="option" id={`cmdk-${a.id}`} aria-selected={i === clamped}>
              <button
                type="button"
                className={i === clamped ? "sel" : undefined}
                onClick={() => run(a)}
                onMouseEnter={() => setSel(i)}
              >
                {a.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="muted">{t("cmdk.noResults")}</li>}
        </ul>
      </div>
    </div>
  );
}
