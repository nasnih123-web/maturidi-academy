/**
 * Public articles listing — WordPress-style grid catalog.
 *
 * REPLACES the old CMS articles list (published CMS pages with
 * content_type=article): this page reads ONLY the public
 * published-articles endpoint — 10 items per page, server-side search,
 * category sidebar with published counts, prev/next pagination. Every
 * article here is reachable by paging — there is no total cap. The old
 * CMS /pages/[slug] route stays untouched; nothing is deleted.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getArticleCategoriesServer,
  getArticleListServer,
} from '@/lib/articles';
import { formatDualHijri } from '@/lib/fatwa-topics';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'articles' });
  return { title: t('listPageTitle'), description: t('listSubtitle') };
}

function pageHref(
  locale: string,
  opts: { q?: string; category?: string; page?: number },
): string {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return `/${locale}/articles${qs ? `?${qs}` : ''}`;
}

export default async function ArticlesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'articles' });
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const category = typeof sp.category === 'string' ? sp.category : '';
  const pageNum = Math.max(1, Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const dir = locale === 'en' ? 'ltr' : 'rtl';

  let list = null;
  let categories: Awaited<ReturnType<typeof getArticleCategoriesServer>> = [];
  let failed = false;
  try {
    [list, categories] = await Promise.all([
      getArticleListServer({ locale, q: q || undefined, category: category || undefined, page: pageNum }),
      getArticleCategoriesServer(locale),
    ]);
  } catch {
    failed = true;
  }

  return (
    <main className="ftw-page" dir={dir}>
      <h1>{t('listPageTitle')}</h1>
      <p className="ftw-subtitle">{t('listSubtitle')}</p>

      <form className="ftw-search" method="get" action={`/${locale}/articles`}>
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
        />
        <button type="submit">{t('searchButton')}</button>
      </form>

      {failed || !list ? (
        <p className="ftw-empty">{t('listFailed')}</p>
      ) : (
        <div className="ftw-layout">
          <section className="ftw-main">
            {list.items.length === 0 ? (
              <p className="ftw-empty">{t('listEmpty')}</p>
            ) : (
              <>
                <div className="ftw-grid">
                  {list.items.map((item) => {
                    const dates = formatDualHijri(item.publishedAt, locale);
                    return (
                      <article key={item.slug} className="ftw-card">
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
                          <h2>{item.title}</h2>
                        </Link>
                        {item.category ? <p className="ftw-card-cat">{item.category.title}</p> : null}
                        <p className="ftw-card-meta">
                          {item.authorName ? (
                            <span>
                              {t('authorLabel')}: {item.authorName}
                            </span>
                          ) : null}
                          {dates?.shamsi ? (
                            <span>
                              {t('publishedLabel')}: {dates.shamsi}
                            </span>
                          ) : null}
                          <span>
                            {item.viewCount} {t('viewsLabel')}
                          </span>
                          <span>
                            {item.shareCount} {t('sharesLabel')}
                          </span>
                        </p>
                      </article>
                    );
                  })}
                </div>
                <nav className="ftw-pager" aria-label={t('pageOf', { page: list.page, pages: list.pages })}>
                  {list.page > 1 ? (
                    <Link
                      href={pageHref(locale, {
                        q: q || undefined,
                        category: category || undefined,
                        page: list.page - 1,
                      })}
                    >
                      {t('prevPage')}
                    </Link>
                  ) : (
                    <span aria-hidden />
                  )}
                  <span>{t('pageOf', { page: list.page, pages: list.pages })}</span>
                  {list.page < list.pages ? (
                    <Link
                      href={pageHref(locale, {
                        q: q || undefined,
                        category: category || undefined,
                        page: list.page + 1,
                      })}
                    >
                      {t('nextPage')}
                    </Link>
                  ) : (
                    <span aria-hidden />
                  )}
                </nav>
              </>
            )}
          </section>

          <aside className="ftw-sidebar" aria-label={t('allCategories')}>
            <h2>{t('allCategories')}</h2>
            <ul>
              <li>
                <Link
                  href={pageHref(locale, { q: q || undefined })}
                  aria-current={category ? undefined : 'page'}
                >
                  {t('allCategories')}
                  {category ? null : ` (${list.total})`}
                </Link>
              </li>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={pageHref(locale, { q: q || undefined, category: c.slug })}
                    aria-current={category === c.slug ? 'page' : undefined}
                  >
                    {c.title} ({c.publishedCount})
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </main>
  );
}
