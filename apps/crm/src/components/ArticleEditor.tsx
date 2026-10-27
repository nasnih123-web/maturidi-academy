import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";

/**
 * Tiptap-based article editor — Persian toolbar, RTL-aware.
 *
 * The engine is stock Tiptap v3 (StarterKit + Underline + Link + Image +
 * Youtube); only the toolbar UI is custom. Content is a Tiptap JSON doc,
 * reported via onChange on every update and stored as-is in the API.
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
  heading2: string;
  heading3: string;
  bulletList: string;
  orderedList: string;
  quote: string;
  codeBlock: string;
  linkUrl: string;
  applyLink: string;
  removeLink: string;
  imageUrl: string;
  insertImage: string;
  videoUrl: string;
  insertVideo: string;
  badImageUrl: string;
  badVideoUrl: string;
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

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Youtube.configure({ inline: false, nocookie: true }),
    ],
    content: initialContent ?? EMPTY_DOC,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as Record<string, unknown>);
    },
    editorProps: {
      attributes: {
        dir,
        style: "min-height: 16rem; padding: 0.75rem; outline: none;",
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

  const chain = () => editor.chain().focus();

  return (
    <div>
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
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
        <button
          type="button"
          style={btnStyle(editor.isActive("heading", { level: 2 }))}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        >
          {labels.heading2}
        </button>
        <button
          type="button"
          style={btnStyle(editor.isActive("heading", { level: 3 }))}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          {labels.heading3}
        </button>
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
