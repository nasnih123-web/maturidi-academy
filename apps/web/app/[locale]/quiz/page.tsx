import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';

const QuizRunner = dynamic(() => import('@/components/QuizRunner').then((m) => m.QuizRunner), {
  ssr: false,
  loading: () => <p className="auth-loading">…</p>,
});

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quiz' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Fiqh quiz page (Phase 6 — web track).
 *
 * Code-split interactive runner (ssr: false) for the First Load JS budget.
 * The engine is generic (lib/quiz.ts) so the Phase-8 LMS reuses it;
 * this route only wires it to the fatwa quiz backend.
 */
export default async function QuizPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quiz' });
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <QuizRunner
        locale={locale}
        labels={{
          startTitle: t('startTitle'),
          startHint: t('startHint'),
          countLabel: t('countLabel'),
          generate: t('generate'),
          generating: t('generating'),
          questionOf: t('questionOf', { current: '{current}', total: '{total}' }),
          next: t('next'),
          prev: t('prev'),
          submit: t('submit'),
          submitting: t('submitting'),
          unansweredHint: t('unansweredHint'),
          scoreTitle: t('scoreTitle'),
          scoreOf: t('scoreOf', { score: '{score}', total: '{total}' }),
          reviewTitle: t('reviewTitle'),
          correctLabel: t('correctLabel'),
          wrongLabel: t('wrongLabel'),
          explanationLabel: t('explanationLabel'),
          retake: t('retake'),
          generateFailed: t('generateFailed'),
          submitFailed: t('submitFailed'),
          emptyFailed: t('emptyFailed'),
        }}
      />
    </div>
  );
}
