import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { FatwaQuestionLabels } from '@/components/social/labels';
import { QuestionView } from '@/components/fatwa/QuestionViewLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
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
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  const searchParams = await searchParamsPromise;
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
