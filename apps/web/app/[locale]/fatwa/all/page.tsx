import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getHomeSections } from '@/lib/api';
import { getContentItems } from '@/lib/section-data';
import { EmptyState } from '@/components/EmptyState';
import { FatwaHistoryPanel } from '@/components/FatwaHistoryPanel';
import { FatwaList } from '@/components/FatwaList';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return { title: t('list.metaTitle'), description: t('list.metaDescription') };
}

/**
 * Full fatwa listing page (`/{locale}/fatwa/all`).
 *
 * Pure server component: items come from the published `latest_fatwas`
 * homepage section (GET /api/v1/home/sections) — the only public,
 * published fatwa collection this app has. There is NO public
 * fatwa-topics list endpoint (admin topics are admin-only, clusters are
 * mufti-panel-only), so this page honestly lists the published section
 * items rather than inventing a catalog; see the report for the backend
 * gap. Filtering/search is client-side over those items (FatwaList);
 * history comes from the assistant's own on-device store
 * (FatwaHistoryPanel). Error state never mocks data.
 */
export default async function FatwaListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });

  let items: ReturnType<typeof getContentItems> = [];
  let loadFailed = false;
  let sectionFound = false;
  try {
    const { sections } = await getHomeSections();
    const section = sections.find((s) => s.key === 'latest_fatwas' && s.visible !== false);
    if (section) {
      sectionFound = true;
      items = getContentItems(section.data, locale, 200);
    }
  } catch {
    loadFailed = true;
  }

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('list.title')}</h1>
      <p className="page-sub">{t('list.subtitle')}</p>

      <p>
        <a className="btn-secondary" href={`/${locale}/fatwa`}>
          {t('list.askAssistant')}
        </a>{' '}
        <a className="btn-secondary" href={`/${locale}/fatwa/question`}>
          {t('list.submitToMufti')}
        </a>
      </p>

      {loadFailed ? (
        <div className="error-state" role="alert">
          <h2>{t('list.loadFailedTitle')}</h2>
          <p>{t('list.loadFailedBody')}</p>
        </div>
      ) : !sectionFound || items.length === 0 ? (
        <EmptyState title={t('list.noPublishedTitle')} hint={t('list.noPublishedHint')} />
      ) : (
        <FatwaList
          locale={locale}
          items={items.map((it) => ({
            id: it.id,
            title: it.title,
            subtitle: it.subtitle,
            category: it.category,
            badge: it.badge,
            href: it.href,
          }))}
          labels={{
            searchLabel: t('list.searchLabel'),
            searchPlaceholder: t('list.searchPlaceholder'),
            categoryAll: t('list.categoryAll'),
            resultsCount: t('list.resultsCount'),
            emptyTitle: t('list.emptyTitle'),
            emptyHint: t('list.emptyHint'),
            askAssistantAbout: t('list.askAssistantAbout'),
          }}
        />
      )}

      <FatwaHistoryPanel
        locale={locale}
        labels={{
          title: t('list.historyTitle'),
          empty: t('list.historyEmpty'),
          hint: t('list.historyHint'),
        }}
      />
    </div>
  );
}
