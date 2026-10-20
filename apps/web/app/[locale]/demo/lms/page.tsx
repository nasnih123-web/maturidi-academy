/**
 * DEV-ONLY demo page: renders the Phase-8 LMS surfaces with clearly-labeled
 * fixture data (lib/demo-fixtures.ts) so layouts can be previewed and
 * screenshot without touching production content. Returns 404 in production.
 *
 * The fixtures are hand-written sample strings and NEVER appear on the real
 * /learn routes or any other production surface.
 */
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  demoCertificateValid,
  demoCourseDetail,
  demoDashboardData,
  demoLesson,
} from '@/lib/demo-fixtures';
import { LearnDashboardView, type LearnDashboardLabels } from '@/components/LearnDashboard';
import { CourseStatic, type CourseStaticLabels } from '@/components/CourseStatic';
import { CourseView, type CourseViewLabels } from '@/components/CourseView';
import { LessonContentView } from '@/components/LessonContent';
import { DemoQuizPreview } from '@/components/DemoQuizPreview';
import type { QuizRunnerLabels } from '@/components/QuizRunnerShell';
import { CertificateVerdict, type CertificateVerdictLabels } from '@/components/CertificateVerdict';
import type { LmsCertificateVerify } from '@/lib/lms';

export function generateStaticParams() {
  return [{ locale: 'fa' }, { locale: 'ar' }, { locale: 'en' }];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return { title: 'نمایشی — پیشخوان یادگیری', robots: { index: false, follow: false } };
}

export default async function DemoLmsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (process.env.NODE_ENV === 'production') notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  const tq = await getTranslations({ locale, namespace: 'quiz' });

  const dashLabels: LearnDashboardLabels = {
    loginRequiredTitle: t('loginRequiredTitle'),
    loginRequiredBody: t('loginRequiredBody'),
    loginCta: t('loginCta'),
    loading: t('loading'),
    loadFailed: t('loadFailed'),
    retry: t('retry'),
    continueTitle: t('continueTitle'),
    continueEmpty: t('continueEmpty'),
    continueCta: t('continueCta'),
    progressLabel: t('progressLabel', { percent: '{percent}' }),
    recommendationsTitle: t('recommendationsTitle'),
    recommendationsEmpty: t('recommendationsEmpty'),
    openLesson: t('openLesson'),
    cohortsTitle: t('cohortsTitle'),
    cohortsEmpty: t('cohortsEmpty'),
    seatsLeftLabel: t('seatsLeftLabel', { n: '{n}' }),
    enrolledBadge: t('enrolledBadge'),
    certificatesTitle: t('certificatesTitle'),
    certificatesEmpty: t('certificatesEmpty'),
    verifyCta: t('verifyCta'),
    downloadPdf: t('downloadPdf'),
    reportTitle: t('reportTitle'),
    statLessons: t('statLessons'),
    statOverall: t('statOverall'),
    statAvgScore: t('statAvgScore'),
    statStreak: t('statStreak'),
    courseQuizAvg: t('courseQuizAvg'),
    reasonNextIncomplete: t('reasonNextIncomplete'),
    reasonNextLevel: t('reasonNextLevel'),
    levelBeginner: t('levelBeginner'),
    levelIntermediate: t('levelIntermediate'),
    levelAdvanced: t('levelAdvanced'),
    startsAt: t('startsAt'),
    endsAt: t('endsAt'),
  };
  const courseLabels: CourseStaticLabels = {
    lessonsTitle: t('lessonsTitle'),
    completedBadge: t('completedBadge'),
    inProgressBadge: t('inProgressBadge'),
    notStartedBadge: t('notStartedBadge'),
    quizBadge: t('quizBadge'),
    openLesson: t('openLesson'),
    progressLabel: t('progressLabel', { percent: '{percent}' }),
    lessonsCountLabel: t('lessonsCountLabel', { done: '{done}', total: '{total}' }),
    certificateEarned: t('certificateEarned'),
    levelLabels: {
      levelBeginner: t('levelBeginner'),
      levelIntermediate: t('levelIntermediate'),
      levelAdvanced: t('levelAdvanced'),
    },
  };
  const cohortLabels: CourseViewLabels = {
    cohortsEmpty: t('courseCohortsEmpty'),
    enroll: t('enroll'),
    enrolling: t('enrolling'),
    enrolled: t('enrolled'),
    enrollFailed: t('enrollFailed'),
    loginToEnroll: t('loginToEnroll'),
    seatsLeftLabel: t('seatsLeftLabel', { n: '{n}' }),
    startsAt: t('startsAt'),
    endsAt: t('endsAt'),
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
  const certLabels: CertificateVerdictLabels = {
    validTitle: t('validTitle'),
    invalidTitle: t('invalidTitle'),
    invalidBody: t('invalidBody'),
    courseLabel: t('courseLabel'),
    recipientLabel: t('recipientLabel'),
    issuedAtLabel: t('issuedAtLabel'),
    codeLabel: t('codeLabel'),
  };

  const invalidVerdict: LmsCertificateVerify = {
    valid: false,
    code: 'MA-DEMO-XXXX',
    holder_name: null,
    course_title: null,
    issued_at: null,
    locale: null,
  };

  const lesson = demoLesson();

  return (
    <div className="page-wrap">
      <p className="lms-demo-badge">{t('demoBadge')}</p>
      <h1 className="page-title">{t('demoTitle')}</h1>
      <p className="page-sub">{t('demoNote')}</p>

      <hr className="lms-demo-sep" />
      <LearnDashboardView locale={locale} labels={dashLabels} data={demoDashboardData()} />

      <hr className="lms-demo-sep" />
      <CourseStatic detail={demoCourseDetail()} locale={locale} labels={courseLabels} />
      <section className="lms-section" aria-labelledby="lms-demo-cohorts-h">
        <h2 id="lms-demo-cohorts-h">{t('courseCohortsTitle')}</h2>
        <CourseView courseId="demo-course-1" locale={locale} labels={cohortLabels} />
      </section>

      <hr className="lms-demo-sep" />
      <h2 className="page-title">{lesson.title[locale as 'fa' | 'ar' | 'en']}</h2>
      <LessonContentView lesson={lesson} locale={locale} />
      <section className="lms-section" aria-label={t('quizSectionTitle')}>
        <h2>{t('quizSectionTitle')}</h2>
        <DemoQuizPreview labels={quizLabels} />
      </section>

      <hr className="lms-demo-sep" />
      <h2 className="page-title">{t('certificateTitle2')}</h2>
      <CertificateVerdict verdict={demoCertificateValid()} locale={locale} labels={certLabels} />
      <div style={{ marginBlockStart: '1.5rem' }}>
        <CertificateVerdict verdict={invalidVerdict} locale={locale} labels={certLabels} />
      </div>
    </div>
  );
}
