import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FatwaChat } from '@/components/FatwaChatLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
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
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ q?: string | string[]; session?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  // Deep links from the fatwa listing page: ?q= prefills the ask box,
  // ?session= reopens a past conversation from the shared history store.
  // Values are rendered only as an input value / session lookup — never
  // sent to the API without the user pressing ask.
  const sp = (await searchParams) ?? {};
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const initialQuestion = first(sp.q);
  const initialSessionId = first(sp.session);
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <FatwaChat
        locale={locale}
        initialQuestion={initialQuestion}
        initialSessionId={initialSessionId}
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
