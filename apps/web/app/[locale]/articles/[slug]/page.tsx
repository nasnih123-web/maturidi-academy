/**
 * Public article detail — WordPress-style article page.
 *
 * Header: author + publish date (Solar Hijri AND Lunar Hijri) + share
 * count. Body: server-rendered Tiptap JSON (strict allowlist, never raw
 * HTML). Footer: related slider (same category) + sidebar with
 * categories (with counts), latest, most-viewed, and share buttons.
 *
 * Metadata uses ONLY the /meta endpoint (never the counting detail
 * endpoint), so metadata never double-counts views. SEO: seo_title
 * falls back to the article title, seo_description, og:image from the
 * featured image, canonical /articles/[slug], JSON-LD Article schema.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getArticleCategoriesServer,
  getArticleDetailServer,
  getArticleListServer,
  getArticleMetaServer,
} from '@/lib/articles';
import { formatDualHijri } from '@/lib/fatwa-topics';
import { ArticleBody } from '@/components/ArticleBody';
import { ArticleShareButtons } from '@/components/ArticleShareButtons';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'articles' });
  let meta = null;
  try {
    meta = await getArticleMetaServer(slug, locale);
  } catch {
    meta = null;
  }
  if (!meta) {
    return { title: t('listPageTitle'), description: t('listSubtitle') };
  }
  const title = meta.seoTitle || meta.title;
  const description = meta.seoDescription || undefined;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: meta.featuredImageUrl ? [meta.featuredImageUrl] : undefined,
      type: 'article',
    },
    alternates: {
      canonical: `/${locale}/articles/${encodeURIComponent(slug)}`,
    },
  };
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<React.ReactElement> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'articles' });
  const dir = locale === 'en' ? 'ltr' : 'rtl';

  let detail = null;
  let categories: Awaited<ReturnType<typeof getArticleCategoriesServer>> = [];
  let newest: Awaited<ReturnType<typeof getArticleListServer>> | null = null;
  let mostViewed: Awaited<ReturnType<typeof getArticleListServer>> | null = null;
  let related: Awaited<ReturnType<typeof getArticleListServer>> | null = null;
  let failed = false;
  try {
    detail = await getArticleDetailServer(slug, locale);
  } catch {
    failed = true;
  }
  if (failed) {
    return (
      <main className="ftw-page" dir={dir}>
        <p className="ftw-empty">{t('detailFailed')}</p>
      </main>
    );
  }
  if (!detail) notFound();

  try {
    [categories, newest, mostViewed] = await Promise.all([
      getArticleCategoriesServer(locale),
      getArticleListServer({ locale, sort: 'newest', page: 1, perPage: 5 }),
      getArticleListServer({ locale, sort: 'views', page: 1, perPage: 5 }),
    ]);
    if (detail.category) {
      related = await getArticleListServer({
        locale,
        category: detail.category.slug,
        exclude: detail.slug,
        page: 1,
        perPage: 6,
      });
    }
  } catch {
    /* sidebar/related stay empty; the article itself still renders */
  }

  const dates = formatDualHijri(detail.publishedAt, locale);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: detail.title,
    ...(detail.authorName ? { author: { '@type': 'Person', name: detail.authorName } } : {}),
    ...(detail.publishedAt ? { datePublished: detail.publishedAt } : {}),
    ...(detail.featuredImageUrl ? { image: detail.featuredImageUrl } : {}),
  };

  return (
    <main className="ftw-page" dir={dir}>
      <script
        type="application/ld+json"
        // JSON-LD is data, not markup: `<` is escaped so a title can
        // never break out of the script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <article className="ftw-layout">
        <div className="ftw-main">
          <h1>{detail.title}</h1>
          {detail.featuredImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.featuredImageUrl} alt="" className="ftw-hero-img" />
          ) : null}
          <p className="ftw-card-meta">
            {detail.authorName ? (
              <span>
                {t('authorLabel')}: {detail.authorName}
              </span>
            ) : null}
            {dates?.shamsi ? (
              <span>
                {t('publishedLabel')} ({t('shamsiLabel')}): {dates.shamsi}
              </span>
            ) : null}
            {dates?.qamari ? (
              <span>
                {t('publishedLabel')} ({t('qamariLabel')}): {dates.qamari}
              </span>
            ) : null}
            <span>
              {detail.viewCount} {t('viewsLabel')}
            </span>
            <span>
              {detail.shareCount} {t('sharesLabel')}
            </span>
          </p>

          <ArticleBody body={detail.body} />

          {related && related.items.length > 0 ? (
            <section>
              <h2>{t('relatedTitle')}</h2>
              <div className="ftw-related">
                {related.items.map((item) => (
                  <article key={item.slug} className="ftw-card ftw-card-sm">
                    <Link href={`/${locale}/articles/${encodeURIComponent(item.slug)}`} className="ftw-card-link">
                      {item.featuredImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.featuredImageUrl}
                          alt=""
                          className="ftw-card-img"
                          loading="lazy"
                        />
                      ) : (
                        <div className="ftw-card-img ftw-card-img-empty" aria-hidden />
                      )}
                      <h3>{item.title}</h3>
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="ftw-sidebar">
          <ArticleShareButtons
            slug={detail.slug}
            title={detail.title}
            initialCount={detail.shareCount}
            labels={{
              share: t('shareTitle'),
              telegram: t('shareTelegram'),
              whatsapp: t('shareWhatsapp'),
              copyLink: t('copyLink'),
              copied: t('copied'),
              shares: t('sharesLabel'),
            }}
          />
          <h2>{t('allCategories')}</h2>
          <ul>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/${locale}/articles?category=${encodeURIComponent(c.slug)}`}>
                  {c.title} ({c.publishedCount})
                </Link>
              </li>
            ))}
          </ul>
          <h2>{t('newestTitle')}</h2>
          <ul>
            {(newest?.items ?? []).map((item) => (
              <li key={item.slug}>
                <Link href={`/${locale}/articles/${encodeURIComponent(item.slug)}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
          <h2>{t('mostViewedTitle')}</h2>
          <ul>
            {(mostViewed?.items ?? []).map((item) => (
              <li key={item.slug}>
                <Link href={`/${locale}/articles/${encodeURIComponent(item.slug)}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      </article>
    </main>
  );
}
