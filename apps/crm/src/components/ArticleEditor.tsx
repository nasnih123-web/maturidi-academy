import React from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import TextAlign from "@tiptap/extension-text-align";

/**
 * Tiptap-based article editor — WordPress Classic-style grouped toolbar.
 *
 * The engine is stock Tiptap v3 (StarterKit + Underline + Link + Image +
 * Youtube + TextAlign); only the toolbar UI is custom. Content is a
 * Tiptap JSON doc, reported via onChange on every update and stored
 * as-is in the API. StarterKit already bundles Dropcursor (visible drop
 * position), History (undo/redo) and HorizontalRule, so no extra
 * packages were needed for those; TextAlign is the one added extension.
 *
 * Selection formatting: every mark button runs
 * `editor.chain().focus().toggleX()` — focus() restores the editor
 * selection that the toolbar click blurred, then the toggle applies to
 * that selection; with a collapsed cursor it sets a stored mark, so
 * subsequently typed text carries the format. This is stock
 * ProseMirror/Tiptap toggleMark behavior, not custom code.
 *
 * Drag-and-drop (editorProps.handleDrop / handlePaste):
 * - Dragging a node already in the document (e.g. an image — the Image
 *   extension marks nodes draggable) is left to ProseMirror's default
 *   drop handling, which moves the node to the Dropcursor position.
 * - Dropping an image URL dragged from another page/tab inserts the
 *   image at the drop point (https + image extension only, same rule
 *   as the toolbar insert).
 * - Dropping or pasting a URL onto selected text wraps the selection
 *   in a link; dropping any other URL with a collapsed cursor inserts
 *   it as a link at the drop point.
 * - Dropping a LOCAL image file does NOT insert anything: the media
 *   library API has no image kind (Literal: video, video_360, pdf,
 *   audio, mindmap), so there is no library upload path for images and
 *   one is never faked here. The drop shows an honest message instead.
 *   True local-image upload needs an API change (new library kind) and
 *   is deliberately out of this frontend-only change.
 *
 * Media rules (enforced again by the web renderer):
 * - image: https URLs only.
 * - video: youtube / vimeo / aparat URLs only; anything else is refused
 *   here with a hint instead of being inserted.
 * No upload-to-library button: library uploads are ClamAV-gated and
 * currently blocked, while external URLs work now.
 */
export interface ArticleEditorLabels {
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  paragraph: string;
  heading2: string;
  heading3: string;
  heading4: string;
  format: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  bulletList: string;
  orderedList: string;
  quote: string;
  codeBlock: string;
  horizontalRule: string;
  undo: string;
  redo: string;
  linkUrl: string;
  applyLink: string;
  removeLink: string;
  imageUrl: string;
  insertImage: string;
  videoUrl: string;
  insertVideo: string;
  badImageUrl: string;
  badVideoUrl: string;
  dropLocalBlocked: string;
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function videoHostOk(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "vimeo.com" ||
      host.endsWith(".vimeo.com") ||
      host === "aparat.com" ||
      host.endsWith(".aparat.com")
    );
  } catch {
    return false;
  }
}

function asUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

function isImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url) && /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url);
}

/** First URL from a drag payload: uri-list, plain text, or an <img> in HTML. */
function droppedUrl(e: DragEvent): string | null {
  const dt = e.dataTransfer;
  if (!dt) return null;
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const line = uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== "" && !l.startsWith("#"));
    const url = line ? asUrl(line) : null;
    if (url) return url;
  }
  const plain = dt.getData("text/plain");
  const plainUrl = plain ? asUrl(plain) : null;
  if (plainUrl) return plainUrl;
  const html = dt.getData("text/html");
  if (html) {
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    const htmlUrl = m ? asUrl(m[1]) : null;
    if (htmlUrl) return htmlUrl;
  }
  return null;
}

export function ArticleEditor({
  initialContent,
  onChange,
  dir,
  labels,
}: {
  initialContent?: Record<string, unknown>;
  onChange: (doc: Record<string, unknown>) => void;
  dir: "rtl" | "ltr";
  labels: ArticleEditorLabels;
}): React.ReactElement {
  const [linkUrl, setLinkUrl] = React.useState("");
  const [imageUrl, setImageUrl] = React.useState("");
  const [videoUrl, setVideoUrl] = React.useState("");
  const [mediaHint, setMediaHint] = React.useState("");
  const [dropHint, setDropHint] = React.useState("");
  // Handlers in editorProps run after creation, so they reach the editor
  // through this ref instead of the not-yet-assigned useEditor return.
  const editorRef = React.useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Youtube.configure({ inline: false, nocookie: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initialContent ?? EMPTY_DOC,
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as Record<string, unknown>);
    },
    editorProps: {
      attributes: {
        dir,
        style: "min-height: 16rem; padding: 0.75rem; outline: none;",
      },
      handleDrop: (view, event, _slice, moved) => {
        // Internal node drag (e.g. an existing image): ProseMirror's
        // default drop handling moves the node to the Dropcursor
        // position, which StarterKit already enables.
        if (moved) return false;
        const ed = editorRef.current;
        if (!ed) return false;
        const dt = event.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          // Local files: no library upload path exists for images (the
          // library API has no image kind), so never fake an upload —
          // say so honestly and swallow the drop.
          const hasImage = Array.from(dt.files).some((f) => f.type.startsWith("image/"));
          if (hasImage) {
            setDropHint(labels.dropLocalBlocked);
            return true;
          }
          return false;
        }
        const url = droppedUrl(event);
        if (!url) return false;
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // Dropping onto selected text links the selection itself.
        if (!ed.state.selection.empty) {
          ed.chain().focus().setLink({ href: url }).run();
          setDropHint("");
          return true;
        }
        const chain = ed.chain().focus().setTextSelection(coords.pos);
        if (isImageUrl(url)) {
          chain.setImage({ src: url }).run();
        } else {
          chain
            .insertContent([
              {
                type: "text",
                text: url,
                marks: [{ type: "link", attrs: { href: url } }],
              },
            ])
            .run();
        }
        setDropHint("");
        return true;
      },
      handlePaste: (_view, event, _slice) => {
        // Pasting a URL onto selected text links the selection.
        const ed = editorRef.current;
        if (!ed || ed.state.selection.empty) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const url = asUrl(text);
        if (!url) return false;
        ed.chain().focus().setLink({ href: url }).run();
        return true;
      },
    },
  });

  if (!editor) {
    return <div className="empty">…</div>;
  }

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.25rem 0.5rem",
    border: "1px solid var(--x-line)",
    borderRadius: "0.25rem",
    background: active ? "var(--x-gold2)" : "transparent",
    color: "inherit",
    cursor: "pointer",
    fontWeight: active ? "bold" : undefined,
  });

  const groupStyle: React.CSSProperties = {
    display: "flex",
    gap: "0.25rem",
    alignItems: "center",
    paddingInlineEnd: "0.5rem",
    borderInlineEnd: "1px solid var(--x-line)",
  };
  const lastGroupStyle: React.CSSProperties = {
    display: "flex",
    gap: "0.25rem",
    alignItems: "center",
  };

  const chain = () => editor.chain().focus();

  const formatValue = editor.isActive("heading", { level: 2 })
    ? "h2"
    : editor.isActive("heading", { level: 3 })
      ? "h3"
      : editor.isActive("heading", { level: 4 })
        ? "h4"
        : "p";

  return (
    <div>
      {/* Classic-style grouped toolbar: format | marks | blocks | align | misc. */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={groupStyle}>
          <select
            aria-label={labels.format}
            value={formatValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") {
                chain().setParagraph().run();
              } else {
                chain().setHeading({ level: Number(v.slice(1)) as 2 | 3 | 4 }).run();
              }
            }}
            style={{ padding: "0.25rem 0.5rem", border: "1px solid var(--x-line)", borderRadius: "0.25rem", background: "transparent", color: "inherit" }}
          >
            <option value="p">{labels.paragraph}</option>
            <option value="h2">{labels.heading2}</option>
            <option value="h3">{labels.heading3}</option>
            <option value="h4">{labels.heading4}</option>
          </select>
        </div>
        <div style={groupStyle}>
          <button type="button" style={btnStyle(editor.isActive("bold"))} onClick={() => chain().toggleBold().run()}>
            {labels.bold}
          </button>
          <button type="button" style={btnStyle(editor.isActive("italic"))} onClick={() => chain().toggleItalic().run()}>
            {labels.italic}
          </button>
          <button type="button" style={btnStyle(editor.isActive("underline"))} onClick={() => chain().toggleUnderline().run()}>
            {labels.underline}
          </button>
          <button type="button" style={btnStyle(editor.isActive("strike"))} onClick={() => chain().toggleStrike().run()}>
            {labels.strike}
          </button>
        </div>
        <div style={groupStyle}>
          <button type="button" style={btnStyle(editor.isActive("bulletList"))} onClick={() => chain().toggleBulletList().run()}>
            {labels.bulletList}
          </button>
          <button type="button" style={btnStyle(editor.isActive("orderedList"))} onClick={() => chain().toggleOrderedList().run()}>
            {labels.orderedList}
          </button>
          <button type="button" style={btnStyle(editor.isActive("blockquote"))} onClick={() => chain().toggleBlockquote().run()}>
            {labels.quote}
          </button>
          <button type="button" style={btnStyle(editor.isActive("codeBlock"))} onClick={() => chain().toggleCodeBlock().run()}>
            {labels.codeBlock}
          </button>
        </div>
        <div style={groupStyle}>
          <button
            type="button"
            style={btnStyle(editor.isActive({ textAlign: "right" }))}
            onClick={() => chain().setTextAlign("right").run()}
          >
            {labels.alignRight}
          </button>
          <button
            type="button"
            style={btnStyle(editor.isActive({ textAlign: "center" }))}
            onClick={() => chain().setTextAlign("center").run()}
          >
            {labels.alignCenter}
          </button>
          <button
            type="button"
            style={btnStyle(editor.isActive({ textAlign: "left" }))}
            onClick={() => chain().setTextAlign("left").run()}
          >
            {labels.alignLeft}
          </button>
          <button
            type="button"
            style={btnStyle(editor.isActive({ textAlign: "justify" }))}
            onClick={() => chain().setTextAlign("justify").run()}
          >
            {labels.alignJustify}
          </button>
        </div>
        <div style={lastGroupStyle}>
          <button type="button" style={btnStyle(false)} onClick={() => chain().setHorizontalRule().run()}>
            {labels.horizontalRule}
          </button>
          <button type="button" style={btnStyle(false)} onClick={() => chain().undo().run()}>
            {labels.undo}
          </button>
          <button type="button" style={btnStyle(false)} onClick={() => chain().redo().run()}>
            {labels.redo}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <input
          className="input"
          dir="ltr"
          value={linkUrl}
          placeholder={labels.linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          style={{ flex: "1 1 12rem" }}
        />
        <button
          type="button"
          style={btnStyle(false)}
          onClick={() => {
            const href = linkUrl.trim();
            if (!href) {
              chain().unsetLink().run();
              return;
            }
            chain().setLink({ href }).run();
          }}
        >
          {labels.applyLink}
        </button>
        <button type="button" style={btnStyle(false)} onClick={() => chain().unsetLink().run()}>
          {labels.removeLink}
        </button>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <input
          className="input"
          dir="ltr"
          value={imageUrl}
          placeholder={labels.imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          style={{ flex: "1 1 12rem" }}
        />
        <button
          type="button"
          style={btnStyle(false)}
          onClick={() => {
            const src = imageUrl.trim();
            if (!/^https:\/\//i.test(src)) {
              setMediaHint(labels.badImageUrl);
              return;
            }
            setMediaHint("");
            chain().setImage({ src }).run();
          }}
        >
          {labels.insertImage}
        </button>
        <input
          className="input"
          dir="ltr"
          value={videoUrl}
          placeholder={labels.videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          style={{ flex: "1 1 12rem" }}
        />
        <button
          type="button"
          style={btnStyle(false)}
          onClick={() => {
            const src = videoUrl.trim();
            if (!videoHostOk(src)) {
              setMediaHint(labels.badVideoUrl);
              return;
            }
            setMediaHint("");
            chain().setYoutubeVideo({ src }).run();
          }}
        >
          {labels.insertVideo}
        </button>
      </div>
      {mediaHint ? <p className="form-error">{mediaHint}</p> : null}
      {dropHint ? <p className="form-error">{dropHint}</p> : null}
      <div
        className="input"
        style={{ padding: 0, minHeight: "16rem" }}
        dir={dir}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
