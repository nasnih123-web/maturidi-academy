/**
 * LegalPage — terms / privacy (and future CMS pages).
 *
 * Our backend currently exposes no public CMS-pages endpoint (the
 * `/content/*` module is a Control Center skeleton), and the port must not
 * invent endpoints — so the page renders the localized official copy from
 * next-intl (the turbo `FALLBACK` pattern, but localized instead of
 * hardcoded per §15.4). When a CMS pages endpoint ships, this component is
 * the single place to wire it: replace `FALLBACK` lookup with the fetch.
 */
import { CmsBlocks, type CmsBlock } from "./CmsBlocks";

export interface LegalCopy {
  title: string;
  blocks: CmsBlock[];
}

export function LegalPage({ copy, locale }: { copy: LegalCopy; locale: "fa" | "ar" | "en" }) {
  return (
    <article className="legal-page" itemScope itemType="https://schema.org/WebPage">
      <h1 itemProp="name">{copy.title}</h1>
      <CmsBlocks blocks={copy.blocks} lang={locale} />
    </article>
  );
}
