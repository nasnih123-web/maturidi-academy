/**
 * Public fatwa detail — WordPress-style article page.
 *
 * Header: author + publish date (Solar Hijri AND Lunar Hijri) + share
 * count. Body: question, answer, evidence, the issue in the other
 * schools. Footer: related slider (same category) + sidebar with
 * categories (with counts), latest, most-viewed, and share buttons.
 *
 * Metadata is intentionally generic: the detail API call counts one view,
 * so fetching the topic again inside generateMetadata would double-count
 * every visit.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getFatwaCategoriesServer,
  getFatwaDetailServer,
  getFatwaListServer,
  formatDualHijri,
} from '@/lib/fatwa-topics';
import { FatwaShareButtons } from '@/components/FatwaShareButtons';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return { title: t('listTitle'), description: t('listSubtitle') };
}

const MADHAB_NAME_KEY: Record<string, string> = {
  hanafi: 'hanafi',
  maliki: 'maliki',
  shafii: 'shafi',
  hanbali: 'hanbali',
};

export default async function FatwaDetailPage({
  params,
}: {
  params: Promise<{ locale: string; topicId: string }>;
}): Promise<React.ReactElement> {
  const { locale, topicId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const madhabNames = t.raw('madhabNames') as Record<string, string>;

  let detail = null;
  let categories: Awaited<ReturnType<typeof getFatwaCategoriesServer>> = [];
  let newest: Awaited<ReturnType<typeof getFatwaListServer>> | null = null;
  let mostViewed: Awaited<ReturnType<typeof getFatwaListServer>> | null = null;
  let related: Awaited<ReturnType<typeof getFatwaListServer>> | null = null;
  let failed = false;
  try {
    detail = await getFatwaDetailServer(topicId, locale);
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
      getFatwaCategoriesServer(locale),
      getFatwaListServer({ locale, sort: 'newest', page: 1, perPage: 5 }),
      getFatwaListServer({ locale, sort: 'views', page: 1, perPage: 5 }),
    ]);
    if (detail.category) {
      related = await getFatwaListServer({
        locale,
        category: detail.category.slug,
        exclude: detail.id,
        page: 1,
        perPage: 6,
      });
    }
  } catch {
    /* sidebar/related stay empty; the article itself still renders */
  }

  const hanafi = detail.positions.find((p) => p.madhab === 'hanafi');
  const others = detail.positions.filter((p) => p.madhab !== 'hanafi');
  const answer = detail.description || hanafi?.positionText || '';
  const evidence = hanafi?.evidenceRefs ?? [];
  const dates = formatDualHijri(detail.publishedAt, locale);
  const madhabLabel = (m: string): string =>
    madhabNames[MADHAB_NAME_KEY[m] ?? m] ?? m;

  return (
    <main className="ftw-page" dir={dir}>
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

          {answer ? (
            <section>
              <h2>{t('answerTitle')}</h2>
              <p>{answer}</p>
            </section>
          ) : null}

          {evidence.length > 0 ? (
            <section>
              <h2>{t('evidenceTitle')}</h2>
              <ul>
                {evidence.map((ref) => (
                  <li key={ref}>{ref}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {others.length > 0 ? (
            <section>
              <h2>{t('otherMadhabsTitle')}</h2>
              {others.map((p) => (
                <div key={p.madhab} className="ftw-madhab">
                  <h3>{madhabLabel(p.madhab)}</h3>
                  <p>{p.positionText}</p>
                  {p.evidenceRefs.length > 0 ? (
                    <ul>
                      {p.evidenceRefs.map((ref) => (
                        <li key={ref}>{ref}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {related && related.items.length > 0 ? (
            <section>
              <h2>{t('relatedTitle')}</h2>
              <div className="ftw-related">
                {related.items.map((item) => (
                  <article key={item.id} className="ftw-card ftw-card-sm">
                    <Link href={`/${locale}/fatwa/${item.id}`} className="ftw-card-link">
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
          <FatwaShareButtons
            topicId={detail.id}
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
                <Link href={`/${locale}/fatwa/all?category=${encodeURIComponent(c.slug)}`}>
                  {c.title} ({c.publishedCount})
                </Link>
              </li>
            ))}
          </ul>
          <h2>{t('newestTitle')}</h2>
          <ul>
            {(newest?.items ?? []).map((item) => (
              <li key={item.id}>
                <Link href={`/${locale}/fatwa/${item.id}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
          <h2>{t('mostViewedTitle')}</h2>
          <ul>
            {(mostViewed?.items ?? []).map((item) => (
              <li key={item.id}>
                <Link href={`/${locale}/fatwa/${item.id}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      </article>
    </main>
  );
}
