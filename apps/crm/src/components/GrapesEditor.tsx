import React from "react";
import { Button } from "@maturidi/ui-web";
import { CmsBlock } from "../lib/contentApi";
import { useI18n, type Locale } from "../lib/i18n";
import {
  BLOCK_DEFS,
  CMS_PROPS_ATTR,
  CMS_TYPE_ATTR,
  asLocalizedText,
  blockDefOf,
  blocksToCanvas,
  canvasChildrenToBlocks,
  defaultPropsOf,
  patchStoredProps,
  readStoredProp,
  type BlockDef,
  type PropDef,
} from "../lib/blockRegistry";
import LocalizedInput from "./LocalizedInput";

/**
 * Visual editor for CMS content pages — GrapesJS, lazy-loaded so the
 * library never lands in the CRM's initial chunk.
 *
 * - Restricted to content pages: only mounted from PagesManager.
 * - Palette = general widgets + the Phase-3 homepage rows (blockRegistry).
 * - Undo/redo via GrapesJS's UndoManager with toolbar buttons.
 * - Save serializes the canvas to `blocks` JSON and emits onSave — the
 *   parent owns the page-API mutation (ADR-001).
 * - Block props are edited in the side panel (trilingual via
 *   LocalizedInput); the canvas shows a live placeholder per block.
 */

interface GjsComponent {
  getAttributes: () => Record<string, string | undefined>;
  addAttributes: (attrs: Record<string, string>) => void;
  getEl: () => HTMLElement | undefined;
}

interface GjsEditor {
  on: (event: string, cb: (c?: GjsComponent) => void) => void;
  runCommand: (id: string) => unknown;
  getWrapper: () => { components: () => GjsComponent[] } | undefined;
  setComponents: (components: unknown) => void;
  BlockManager: { add: (id: string, opts: Record<string, unknown>) => void };
  DomComponents: { addType: (type: string, def: Record<string, unknown>) => void };
  UndoManager: { hasUndo: () => boolean; hasRedo: () => boolean };
  destroy: () => void;
}

function summarizeProps(type: string, raw: string | undefined, locale: Locale): string {
  const def = blockDefOf(type);
  if (!def) return "";
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    return "";
  }
  for (const p of def.props) {
    if (p.kind === "l10n") {
      const s = asLocalizedText(props[p.name])[locale] || asLocalizedText(props[p.name]).fa;
      if (s) return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    } else if (typeof props[p.name] === "string" && (props[p.name] as string)) {
      const s = props[p.name] as string;
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    }
  }
  return "";
}

/** Paint the canvas placeholder for a CMS block (called by grapesjs view + panel). */
function paintPlaceholder(
  el: HTMLElement | undefined,
  def: BlockDef | undefined,
  label: string,
  rawProps: string | undefined,
  locale: Locale,
  dir: "rtl" | "ltr",
): void {
  if (!el) return;
  const summary = def ? summarizeProps(def.type, rawProps, locale) : "";
  el.setAttribute("dir", dir);
  el.innerHTML =
    `<div style="border:1.5px dashed var(--x-gold, #c9a227);border-radius:10px;` +
    `padding:14px 16px;margin:6px 0;background:rgba(201,162,39,.06);` +
    `font-family:inherit">` +
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">` +
    `<span style="font-size:18px">▦</span>` +
    `<strong style="font-size:13px;color:var(--x-gold, #c9a227)">${label}</strong>` +
    `<code style="font-size:11px;opacity:.6">${def ? def.type : ""}</code>` +
    `</div>` +
    (summary
      ? `<div style="font-size:13px;opacity:.85">${summary.replace(/</g, "&lt;")}</div>`
      : `<div style="font-size:12px;opacity:.5">—</div>`) +
    `</div>`;
}

function PropField({
  def,
  prop,
  rawProps,
  onPatch,
}: {
  def: BlockDef;
  prop: PropDef;
  rawProps: string | undefined;
  onPatch: (name: string, value: unknown) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const label = t(`studio.${prop.labelKey}`);
  if (prop.kind === "l10n") {
    return (
      <LocalizedInput
        id={`prop-${def.type}-${prop.name}`}
        label={label}
        value={asLocalizedText(readStoredProp(rawProps, prop.name))}
        onChange={(v) => onPatch(prop.name, v)}
        multiline={prop.name === "body" || prop.name === "text"}
      />
    );
  }
  if (prop.kind === "select") {
    return (
      <div className="field">
        <label htmlFor={`prop-${def.type}-${prop.name}`}>{label}</label>
        <select
          id={`prop-${def.type}-${prop.name}`}
          className="input"
          value={String(readStoredProp(rawProps, prop.name) ?? prop.options?.[0] ?? "")}
          onChange={(e) => onPatch(prop.name, e.target.value)}
        >
          {(prop.options ?? []).map((o) => (
            <option key={o} value={o}>
              {t(`studio.theme_${o}`) !== `studio.theme_${o}` ? t(`studio.theme_${o}`) : o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={`prop-${def.type}-${prop.name}`}>{label}</label>
      <input
        id={`prop-${def.type}-${prop.name}`}
        className="input"
        dir={prop.kind === "url" ? "ltr" : undefined}
        value={String(readStoredProp(rawProps, prop.name) ?? "")}
        onChange={(e) => onPatch(prop.name, e.target.value)}
        placeholder={prop.kind === "url" ? "https://…" : undefined}
      />
    </div>
  );
}

export default function GrapesEditor({
  initialBlocks,
  onSave,
  saving = false,
}: {
  initialBlocks: CmsBlock[];
  onSave: (blocks: CmsBlock[]) => void;
  saving?: boolean;
}): React.ReactElement {
  const { t, locale, dir } = useI18n();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const paletteRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<GjsEditor | null>(null);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [selected, setSelected] = React.useState<GjsComponent | null>(null);
  const [selVersion, setSelVersion] = React.useState(0);
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const localeRef = React.useRef<Locale>(locale);
  localeRef.current = locale;
  const dirRef = React.useRef(dir);
  dirRef.current = dir;

  const labelFor = React.useCallback(
    (def: BlockDef): string => {
      const k = t(`studio.${def.labelKey}`);
      return k === `studio.${def.labelKey}` ? def.type : k;
    },
    [t],
  );
  const labelForRef = React.useRef(labelFor);
  labelForRef.current = labelFor;

  React.useEffect(() => {
    let disposed = false;
    let editor: GjsEditor | null = null;

    (async () => {
      try {
        const mod = await import("grapesjs");
        // CSS ships as its own lazy chunk — never in the initial bundle.
        await import("grapesjs/dist/css/grapes.min.css");
        if (disposed || !canvasRef.current) return;
        const grapesjs = (mod as { default: any }).default ?? mod;

        // grapesjs 0.23.8 only accepts px heights ("100%" collapses to 0).
        const pxHeight = Math.max(
          560,
          Math.round(canvasRef.current.getBoundingClientRect().height || 600),
        );
        editor = grapesjs.init({
          container: canvasRef.current,
          fromElement: false,
          height: `${pxHeight}px`,
          width: "auto",
          storageManager: false,
          undoManager: true,
          showOffsets: true,
          noticeOnUnload: false,
          blockManager: { appendTo: paletteRef.current ?? undefined },
          panels: { defaults: [] },
        }) as GjsEditor;

        editor.DomComponents.addType("cms-block", {
          isComponent: (el: unknown) =>
            el instanceof HTMLElement && el.hasAttribute(CMS_TYPE_ATTR)
              ? { type: "cms-block" }
              : undefined,
          model: {
            defaults: {
              draggable: true,
              droppable: false,
              selectable: true,
              hoverable: true,
            },
          },
          view: {
            onRender({ el, model }: { el: HTMLElement; model: GjsComponent }) {
              const attrs = model.getAttributes();
              const type = attrs[CMS_TYPE_ATTR] ?? "";
              const def = blockDefOf(type);
              paintPlaceholder(
                el,
                def,
                labelForRef.current(def ?? { type, labelKey: "", category: "general", props: [], defaults: {} }),
                attrs[CMS_PROPS_ATTR],
                localeRef.current,
                dirRef.current,
              );
            },
          },
        });

        // Register the custom type BEFORE adding components — types are
        // resolved at creation, so components passed to init() would miss it.
        editor.setComponents(blocksToCanvas(initialBlocks));

        // Dark canvas to match the CRM theme (canvas.styles only accepts
        // URLs, so inject a <style> into the frame document directly).
        const paintCanvas = (): void => {
          try {
            const doc = (
              editor as unknown as {
                Canvas: { getDocument: () => Document | undefined };
              }
            ).Canvas.getDocument();
            if (doc && !doc.getElementById("cms-canvas-theme")) {
              const styleEl = doc.createElement("style");
              styleEl.id = "cms-canvas-theme";
              styleEl.textContent =
                "body{background:#14100a !important;color:#e8e0cf;font-family:inherit;padding:12px;margin:0}";
              doc.head.appendChild(styleEl);
            }
          } catch {
            /* non-fatal */
          }
        };
        paintCanvas();
        editor.on("load", paintCanvas);

        const bm = editor.BlockManager;
        for (const def of BLOCK_DEFS) {
          bm.add(def.type, {
            label: `<div style="padding:6px 4px;font-size:12px">${labelFor(def)}</div>`,
            category: {
              label:
                def.category === "general"
                  ? t("studio.cat_general")
                  : t("studio.cat_homepage"),
              open: def.category === "general",
            },
            content: {
              type: "cms-block",
              attributes: {
                [CMS_TYPE_ATTR]: def.type,
                [CMS_PROPS_ATTR]: JSON.stringify(defaultPropsOf(def.type)),
              },
            },
          });
        }

        const refreshUndo = (): void => {
          try {
            setCanUndo(editor!.UndoManager.hasUndo());
            setCanRedo(editor!.UndoManager.hasRedo());
          } catch {
            /* older API — buttons stay enabled */
          }
        };
        editor.on("component:selected", (c) => {
          const attrs = c?.getAttributes() ?? {};
          setSelected(attrs[CMS_TYPE_ATTR] ? (c as GjsComponent) : null);
          setSelVersion((v) => v + 1);
        });
        editor.on("component:deselected", () => setSelected(null));
        editor.on("update", refreshUndo);
        editor.on("undo", refreshUndo);
        editor.on("redo", refreshUndo);
        refreshUndo();

        editorRef.current = editor;
        setReady(true);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      try {
        editor?.destroy();
      } catch {
        /* ignore */
      }
      editorRef.current = null;
    };
    // Initial blocks are fixed for the editing session; remount to load another page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const repaintSelected = React.useCallback(
    (comp: GjsComponent, rawProps: string): void => {
      const attrs = comp.getAttributes();
      const type = attrs[CMS_TYPE_ATTR] ?? "";
      const def = blockDefOf(type);
      paintPlaceholder(
        comp.getEl(),
        def,
        labelFor(def ?? { type, labelKey: "", category: "general", props: [], defaults: {} }),
        rawProps,
        locale,
        dir,
      );
    },
    [labelFor, locale, dir],
  );

  const handlePatch = (name: string, value: unknown): void => {
    if (!selected) return;
    const raw = patchStoredProps(selected.getAttributes()[CMS_PROPS_ATTR], {
      [name]: value,
    });
    selected.addAttributes({ [CMS_PROPS_ATTR]: raw });
    repaintSelected(selected, raw);
    setSelVersion((v) => v + 1);
  };

  const handleUndo = (): void => {
    editorRef.current?.runCommand("core:undo");
  };
  const handleRedo = (): void => {
    editorRef.current?.runCommand("core:redo");
  };

  const handleSave = (): void => {
    const editor = editorRef.current;
    if (!editor) return;
    const wrapper = editor.getWrapper();
    if (!wrapper) return;
    const flat: { getAttributes: () => Record<string, string | undefined> }[] = [];
    const walk = (comp: GjsComponent): void => {
      flat.push(comp);
      // our blocks are droppable:false, but walk defensively for nested content
      const nested = (comp as unknown as { components?: () => GjsComponent[] }).components;
      if (typeof nested === "function") {
        for (const child of nested()) walk(child);
      }
    };
    for (const child of wrapper.components()) walk(child);
    onSave(canvasChildrenToBlocks(flat));
  };

  const selAttrs = selected?.getAttributes() ?? {};
  const selType = selAttrs[CMS_TYPE_ATTR] ?? "";
  const selDef = blockDefOf(selType);
  const selRaw = selAttrs[CMS_PROPS_ATTR];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%" }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Button size="sm" variant="secondary" disabled={!ready || !canUndo} onClick={handleUndo}>
          {t("studio.undo")}
        </Button>
        <Button size="sm" variant="secondary" disabled={!ready || !canRedo} onClick={handleRedo}>
          {t("studio.redo")}
        </Button>
        <span className="hint" style={{ margin: 0 }}>
          {t("studio.editorHint")}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" disabled={!ready || saving} onClick={handleSave}>
          {saving ? t("common.loading") : t("studio.saveBlocks")}
        </Button>
      </div>

      {failed && (
        <div className="empty">
          <p>{t("studio.editorFailed")}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", minHeight: "560px", flex: 1 }}>
        <div
          className="panel"
          style={{ width: "230px", flexShrink: 0, overflowY: "auto", maxHeight: "640px" }}
        >
          <div className="panel-head">
            <h2 style={{ fontSize: "0.9rem" }}>{t("studio.blockPalette")}</h2>
          </div>
          {!ready && !failed && <p className="muted">{t("common.loading")}</p>}
          <div ref={paletteRef} className="gjs-blocks" />
        </div>

        <div
          ref={canvasRef}
          style={{
            flex: 1,
            minHeight: "560px",
            border: "1px solid var(--x-line)",
            borderRadius: "0.75rem",
            overflow: "hidden",
            background: "#14100a",
          }}
        />

        <div
          className="panel"
          style={{ width: "280px", flexShrink: 0, overflowY: "auto", maxHeight: "640px" }}
        >
          <div className="panel-head">
            <h2 style={{ fontSize: "0.9rem" }}>{t("studio.propsTitle")}</h2>
          </div>
          {selDef ? (
            <div key={`${selType}-${selVersion}`}>
              <p className="hint">{labelFor(selDef)}</p>
              {selDef.props.map((p) => (
                <PropField
                  key={p.name}
                  def={selDef}
                  prop={p}
                  rawProps={selRaw}
                  onPatch={handlePatch}
                />
              ))}
              {selDef.props.length === 0 && (
                <p className="muted">{t("studio.noProps")}</p>
              )}
            </div>
          ) : (
            <p className="muted">{t("studio.selectBlockHint")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
