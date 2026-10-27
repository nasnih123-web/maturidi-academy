/**
 * Server-side renderer: Tiptap JSON doc → React elements.
 *
 * Strict allowlist — never raw HTML, never dangerouslySetInnerHTML, so
 * React's own escaping is the XSS defense. Anything not on the list is
 * dropped (container nodes still render their children).
 *
 * Allowed blocks: paragraph, heading (level 1 renders as h2 so the page
 * keeps a single h1), bullet/ordered lists, quote, code block, rule.
 * Allowed inline marks: bold, italic, underline, strike, code, link.
 * Allowed media: image from https URLs only (with alt); video embed ONLY
 * from youtube / vimeo / aparat, rendered as a lazy iframe with the
 * provider's own embed URL — any other video source is dropped.
 */
import type { ReactNode } from 'react';

type JsonNode = {
  type?: unknown;
  content?: unknown;
  text?: unknown;
  attrs?: unknown;
  marks?: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asNode(v: unknown): JsonNode | null {
  return isRecord(v) ? (v as JsonNode) : null;
}

function nodeChildren(node: JsonNode): JsonNode[] {
  if (!Array.isArray(node.content)) return [];
  return node.content.map(asNode).filter((n): n is JsonNode => n !== null);
}

function nodeAttrs(node: JsonNode): Record<string, unknown> {
  return isRecord(node.attrs) ? node.attrs : {};
}

function attrString(node: JsonNode, key: string): string {
  const v = nodeAttrs(node)[key];
  return typeof v === 'string' ? v : '';
}

/** Link href allowlist: http(s) absolute or site-relative; nothing else. */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith('/')) return h;
  return null;
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** Video embed allowlist → provider embed URL, or null to drop the node. */
function videoEmbedUrl(src: string): string | null {
  let u: URL;
  try {
    u = new URL(src.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    return null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const v = u.searchParams.get('v');
    if (u.pathname.startsWith('/embed/')) {
      const id = u.pathname.replace('/embed/', '').split('/')[0];
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.replace('/shorts/', '').split('/')[0];
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
    return null;
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    return null;
  }
  if (host === 'aparat.com' || host.endsWith('.aparat.com')) {
    const m = u.pathname.match(/\/v\/([A-Za-z0-9]+)/);
    if (m) return `https://www.aparat.com/video/video/embed/videohash/${m[1]}/vt/frame`;
    return null;
  }
  return null;
}

function renderMarks(text: string, marks: unknown, key: string): ReactNode {
  let out: ReactNode = text;
  if (!Array.isArray(marks)) return out;
  for (const raw of marks) {
    const m = asNode(raw);
    if (!m || typeof m.type !== 'string') continue;
    const attrs = nodeAttrs(m);
    switch (m.type) {
      case 'bold':
        out = <strong key={key}>{out}</strong>;
        break;
      case 'italic':
        out = <em key={key}>{out}</em>;
        break;
      case 'underline':
        out = <u key={key}>{out}</u>;
        break;
      case 'strike':
        out = <s key={key}>{out}</s>;
        break;
      case 'code':
        out = <code key={key}>{out}</code>;
        break;
      case 'link': {
        const href = safeHref(typeof attrs.href === 'string' ? attrs.href : '');
        if (href) {
          out = (
            <a
              key={key}
              href={href}
              {...(isExternal(href)
                ? { target: '_blank', rel: 'noopener' }
                : {})}
            >
              {out}
            </a>
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderNodes(nodes: JsonNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => renderNode(n, `${keyPrefix}-${i}`));
}

function renderNode(node: JsonNode, key: string): ReactNode {
  const type = typeof node.type === 'string' ? node.type : '';
  switch (type) {
    case 'doc':
      return <>{renderNodes(nodeChildren(node), key)}</>;
    case 'paragraph': {
      const kids = renderNodes(nodeChildren(node), key);
      return <p key={key}>{kids.length > 0 ? kids : <br />}</p>;
    }
    case 'heading': {
      const level = nodeAttrs(node).level;
      const lv = typeof level === 'number' && level >= 1 && level <= 6 ? level : 2;
      // Level 1 renders as h2: the page title is already the single h1.
      const tag = `h${lv === 1 ? 2 : lv}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const Tag = tag;
      return <Tag key={key}>{renderNodes(nodeChildren(node), key)}</Tag>;
    }
    case 'text':
      return (
        <span key={key}>
          {renderMarks(typeof node.text === 'string' ? node.text : '', node.marks, key)}
        </span>
      );
    case 'hardBreak':
      return <br key={key} />;
    case 'bulletList':
      return <ul key={key}>{renderNodes(nodeChildren(node), key)}</ul>;
    case 'orderedList':
      return <ol key={key}>{renderNodes(nodeChildren(node), key)}</ol>;
    case 'listItem':
      return <li key={key}>{renderNodes(nodeChildren(node), key)}</li>;
    case 'blockquote':
      return <blockquote key={key}>{renderNodes(nodeChildren(node), key)}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{renderNodes(nodeChildren(node), key)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'image': {
      const src = attrString(node, 'src');
      const alt = attrString(node, 'alt');
      if (!/^https:\/\//i.test(src)) return null;
      // eslint-disable-next-line @next/next/no-img-element
      return <img key={key} src={src} alt={alt} loading="lazy" />;
    }
    case 'youtube':
    case 'video': {
      const src = attrString(node, 'src');
      const embed = videoEmbedUrl(src);
      if (!embed) return null;
      return (
        <iframe
          key={key}
          src={embed}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title=""
          style={{ width: '100%', aspectRatio: '16 / 9', border: 0 }}
        />
      );
    }
    default: {
      // Unknown node: keep readable children, drop the wrapper itself.
      const kids = renderNodes(nodeChildren(node), key);
      return kids.length > 0 ? <span key={key}>{kids}</span> : null;
    }
  }
}

export function ArticleBody({ body }: { body: unknown }): React.ReactElement {
  const doc = asNode(body);
  if (!doc || doc.type !== 'doc') {
    return <p />;
  }
  return <div className="ftw-article-body">{renderNode(doc, 'doc')}</div>;
}
