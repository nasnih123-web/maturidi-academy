import type { CmsPage } from './types';
import { pickText } from './localize';

/**
 * SEO helpers — canonical URLs, breadcrumb JSON-LD and per-content_type
 * schema.org markup for CMS pages. Pure functions (service layer);
 * components only embed the returned strings/objects.
 */

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export interface BreadcrumbCrumb {
  name: string;
  url: string;
}

export function breadcrumbJsonLd(crumbs: BreadcrumbCrumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

function authorName(author: CmsPage['author'], locale: string): string | undefined {
  if (!author) return undefined;
  if (typeof author === 'string') return author || undefined;
  return pickText(author, locale) || undefined;
}

export function isoDateOnly(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function faqText(v: unknown, locale: string): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return pickText(v as Parameters<typeof pickText>[0], locale);
  return '';
}

/**
 * schema.org entity for a CMS page, chosen by `content_type`:
 *  article → Article, faq → FAQPage, otherwise WebPage.
 * FAQ questions are collected from `faq` blocks when present.
 */
export function pageJsonLd(page: CmsPage, locale: string, url: string): Record<string, unknown> {
  const headline = pickText(page.title, locale);
  const description =
    (page.seo_meta?.description && page.seo_meta.description.trim()) || undefined;
  const dateModified = isoDateOnly(page.updated_at);
  const author = authorName(page.author, locale) ?? (page.seo_meta?.author?.trim() || undefined);

  const base: Record<string, unknown> = { '@context': 'https://schema.org', url };
  if (description) base.description = description;
  if (author) base.author = { '@type': 'Person', name: author };

  if (page.content_type === 'article') {
    return {
      ...base,
      '@type': 'Article',
      headline: headline || description,
      ...(dateModified ? { dateModified } : {}),
      inLanguage: locale,
    };
  }
  if (page.content_type === 'faq') {
    const questions = page.blocks
      .filter((b) => b.type === 'faq' && Array.isArray((b.props as { items?: unknown }).items))
      .flatMap((b) => (b.props as { items: { question?: unknown; answer?: unknown }[] }).items)
      .map((q) => {
        const name = faqText(q.question, locale);
        const acceptedAnswer = faqText(q.answer, locale);
        return name && acceptedAnswer
          ? { '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text: acceptedAnswer } }
          : null;
      })
      .filter(Boolean);
    return {
      ...base,
      '@type': 'FAQPage',
      name: headline,
      ...(dateModified ? { dateModified } : {}),
      inLanguage: locale,
      ...(questions.length ? { mainEntity: questions } : {}),
    };
  }
  return {
    ...base,
    '@type': 'WebPage',
    name: headline,
    ...(dateModified ? { dateModified } : {}),
    inLanguage: locale,
  };
}

/** Localized rendering of an ISO timestamp for the "last updated" line. */
export function formatUpdatedAt(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tag = locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fa-IR';
  try {
    return new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(d);
  } catch {
    return '';
  }
}
