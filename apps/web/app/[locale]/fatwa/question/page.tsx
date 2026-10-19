import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { FatwaQuestionLabels } from '@/components/social/labels';

const QuestionView = dynamic(
  () => import('@/components/fatwa/QuestionView').then((m) => m.QuestionView),
  { ssr: false, loading: () => <p className="auth-loading">…</p> },
);

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return { title: t('question.metaTitle'), description: t('question.metaDescription') };
}

/**
 * Fatwa question (Phase 10): direct question submission with instant
 * "already answered" suggestion (POST /api/v1/fatwa/questions).
 *
 * `?q=` prefills the box; `&demo=ask` auto-submits on mount — a
 * demo-mode screenshot aid only (static screenshot pipeline has no
 * user interaction). Code-split per the First Load JS budget.
 */
export default async function FatwaQuestionPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: Record<string, string | undefined>;
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const labels: FatwaQuestionLabels = {
    title: t('question.title'),
    subtitle: t('question.subtitle'),
    questionLabel: t('question.label'),
    questionPlaceholder: t('question.placeholder'),
    ask: t('question.ask'),
    asking: t('question.asking'),
    suggestionTitle: t('question.suggestionTitle'),
    answeredAt: t('question.answeredAt'),
    clusterLabel: t('question.clusterLabel'),
    noSuggestion: t('question.noSuggestion'),
    error: t('question.error'),
  };
  const prefill = typeof searchParams.q === 'string' ? searchParams.q : undefined;
  const autoAsk = searchParams.demo === 'ask';
  return <QuestionView locale={locale} labels={labels} prefill={prefill} autoAsk={autoAsk} />;
}
