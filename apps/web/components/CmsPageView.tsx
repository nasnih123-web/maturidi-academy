/**
 * CmsPageView — pure presentational shell for any CMS-backed page:
 * breadcrumb, title, "last updated" line, blocks, JSON-LD.
 * All data arrives as props (ADR-001); fetching/metadata live in the
 * route, never here.
 */
import Link from "next/link";
import { CmsBlocks, type CmsBlock, type CmsLang, type SectionEmbedContext } from "./CmsBlocks";

export interface CmsBreadcrumb {
  name: string;
  href: string;
}

export function CmsPageView({
  lang,
  title,
  blocks,
  breadcrumbs,
  updated,
  jsonLd,
  preview,
  previewLabel,
  breadcrumbAria,
  sectionEmbed,
}: {
  lang: CmsLang;
  title: string;
  blocks: CmsBlock[];
  breadcrumbs: CmsBreadcrumb[];
  updated?: { iso: string; prefix?: string; date: string } | null;
  jsonLd: Record<string, unknown>[];
  preview?: boolean;
  /** localized "preview (unpublished)" label — empty hides the badge */
  previewLabel?: string;
  /** localized aria-label for the breadcrumb nav */
  breadcrumbAria: string;
  /** live-section context for `section-*` embeds (CMS page route only) */
  sectionEmbed?: SectionEmbedContext | null;
}) {
  return (
    <article className="cms-page" itemScope itemType="https://schema.org/WebPage">
      <nav className="cms-breadcrumb" aria-label={breadcrumbAria}>
        {breadcrumbs.map((c, i) => (
          <span key={c.href}>
            {i > 0 ? <span aria-hidden> / </span> : null}
            <Link href={c.href}>{c.name}</Link>
          </span>
        ))}
      </nav>
      {preview && previewLabel ? <p className="cms-preview-badge">{previewLabel}</p> : null}
      <h1 itemProp="name">{title}</h1>
      {updated ? (
        <p className="cms-updated">
          {updated.prefix ? <span>{updated.prefix} </span> : null}
          <time itemProp="dateModified" dateTime={updated.iso}>
            {updated.date}
          </time>
        </p>
      ) : null}
      <div itemProp="mainContentOfPage">
        <CmsBlocks blocks={blocks} lang={lang} sectionEmbed={sectionEmbed} />
      </div>
      {jsonLd.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </article>
  );
}
