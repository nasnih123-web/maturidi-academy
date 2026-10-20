import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiError, getCourseServer, lessonHasQuiz } from '@/lib/lms';
import { LessonArticleHead, LessonContentView } from '@/components/LessonContent';
import type { LessonPlayerLabels } from '@/components/LessonPlayer';
import type { QuizRunnerLabels } from '@/components/QuizRunnerShell';
import { LessonProgressIsland, LessonQuizIsland } from '@/components/LessonPlayerLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  return { title: t('lessonMetaTitle'), description: t('lessonMetaDescription') };
}

/**
 * Lesson player page (Phase 8).
 *
 * The backend exposes lessons inside the course detail (no single-lesson
 * endpoint), so this page takes the course context from `?course=` (every
 * lesson link in the app carries it) and server-renders the article.
 * Progress persistence + the embedded lesson quiz (Phase-6 UI reuse) are
 * code-split client islands (ssr: false) for the First Load JS budget.
 */
export default async function LessonPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
  searchParams: Promise<{ course?: string }>;
}) {
  const { locale, lessonId } = await params;
  const searchParams = await searchParamsPromise;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  const tq = await getTranslations({ locale, namespace: 'quiz' });

  const courseId = searchParams.course ?? null;
  let lesson = null;
  let courseTitle = null;
  let loadError: string | null = null;

  if (!courseId) {
    loadError = t('noCourseParam');
  } else {
    try {
      const detail = await getCourseServer(courseId);
      lesson = detail.lessons.find((l) => l.id === lessonId) ?? null;
      courseTitle = detail.course.title;
      if (!lesson) loadError = t('loadFailed');
    } catch (err) {
      loadError = err instanceof ApiError ? err.message : String(err);
    }
  }

  if (!lesson || !courseTitle || !courseId) {
    return (
      <div className="page-wrap">
        <div className="lms-state" role="alert">
          <p>{loadError ?? t('loadFailed')}</p>
        </div>
      </div>
    );
  }

  const labels: LessonPlayerLabels = {
    markComplete: t('markComplete'),
    markingComplete: t('markingComplete'),
    completedBadge: t('completedBadge'),
    saveFailed: t('saveFailed'),
    certificateTitle: t('certificateTitle'),
    certificateBody: t('certificateBody'),
    verifyCertificateCta: t('verifyCertificateCta'),
    loginRequiredTitle: t('loginRequiredTitle'),
    loginRequiredBody: t('loginRequiredBody'),
    loginCta: t('loginCta'),
    progressSaving: t('progressSaving'),
  };
  const quizLabels: QuizRunnerLabels = {
    startTitle: tq('startTitle'),
    startHint: tq('startHint'),
    countLabel: tq('countLabel'),
    generate: tq('generate'),
    generating: tq('generating'),
    questionOf: tq('questionOf', { current: '{current}', total: '{total}' }),
    next: tq('next'),
    prev: tq('prev'),
    submit: tq('submit'),
    submitting: tq('submitting'),
    unansweredHint: tq('unansweredHint'),
    scoreTitle: tq('scoreTitle'),
    scoreOf: tq('scoreOf', { score: '{score}', total: '{total}' }),
    reviewTitle: tq('reviewTitle'),
    correctLabel: tq('correctLabel'),
    wrongLabel: tq('wrongLabel'),
    explanationLabel: tq('explanationLabel'),
    retake: tq('retake'),
    generateFailed: tq('generateFailed'),
    submitFailed: tq('submitFailed'),
    emptyFailed: tq('emptyFailed'),
  };

  return (
    <div className="page-wrap lms-lesson">
      <LessonArticleHead
        lesson={lesson}
        courseId={courseId}
        courseTitle={courseTitle}
        locale={locale}
        backToCourse={t('backToCourse')}
      />
      <LessonContentView lesson={lesson} locale={locale} />
      <LessonProgressIsland lesson={lesson} locale={locale} labels={labels} />
      {lessonHasQuiz(lesson) && (
        <section className="lms-section" aria-labelledby="lms-quiz-h">
          <h2 id="lms-quiz-h">{t('quizSectionTitle')}</h2>
          <LessonQuizIsland lesson={lesson} labels={quizLabels} />
        </section>
      )}
    </div>
  );
}
