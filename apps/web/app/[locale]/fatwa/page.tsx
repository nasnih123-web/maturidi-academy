import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';

const FatwaChat = dynamic(() => import('@/components/FatwaChat').then((m) => m.FatwaChat), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Fatwa ask page (Phase 6 — web track).
 *
 * Pure server component: the interactive chat is code-split (ssr: false)
 * so the route stays inside the First Load JS budget
 * (docs/performance-budget.md). All strings are server-rendered and passed
 * as props — the client chunk carries no i18n runtime.
 */
export default async function FatwaPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <FatwaChat
        locale={locale}
        labels={{
          noticeTitle: t('noticeTitle'),
          noticeBody: t('noticeBody'),
          questionLabel: t('questionLabel'),
          questionPlaceholder: t('questionPlaceholder'),
          ask: t('ask'),
          cancel: t('cancel'),
          streamingLabel: t('streamingLabel'),
          categoryAll: t('categoryAll'),
          categoriesLoading: t('categoriesLoading'),
          categoriesFailed: t('categoriesFailed'),
          historyTitle: t('historyTitle'),
          historyEmpty: t('historyEmpty'),
          clearHistory: t('clearHistory'),
          newChat: t('newChat'),
          showHistory: t('showHistory'),
          hideHistory: t('hideHistory'),
          citationsTitle: t('citationsTitle'),
          idkTitle: t('idkTitle'),
          idkBody: t('idkBody'),
          llmUnavailableTitle: t('llmUnavailableTitle'),
          llmUnavailableBody: t('llmUnavailableBody'),
          askFailed: t('askFailed'),
          emptyHint: t('emptyHint'),
          youLabel: t('youLabel'),
          assistantLabel: t('assistantLabel'),
          usageLabel: t('usageLabel'),
        }}
      />
    </div>
  );
}
