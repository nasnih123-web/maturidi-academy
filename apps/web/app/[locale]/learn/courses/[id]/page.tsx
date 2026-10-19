import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiError, getCourseServer } from '@/lib/lms';
import { pickText } from '@/lib/localize';
import { CourseStatic, type CourseStaticLabels } from '@/components/CourseStatic';
import type { CourseViewLabels } from '@/components/CourseView';

const CourseView = dynamic(() => import('@/components/CourseView').then((m) => m.CourseView), {
  ssr: false,
  loading: () => <p className="lms-state">…</p>,
});

export async function generateMetadata({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  try {
    const detail = await getCourseServer(id);
    const title = pickText(detail.course.title, locale);
    return {
      title: title ? `${title} | آکادمی ماتریدی` : t('dashboardMetaTitle'),
      description: t('courseMetaDescription'),
    };
  } catch {
    return { title: t('dashboardMetaTitle'), description: t('courseMetaDescription') };
  }
}

/**
 * Course detail page (Phase 8).
 *
 * Public course detail (header + lessons) is server-rendered; only the
 * cohort enrollment island is client-side (code-split, ssr: false) for the
 * First Load JS budget. API unreachable → graceful error state, never mock.
 */
export default async function CoursePage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });

  let detail = null;
  let loadError: string | null = null;
  try {
    detail = await getCourseServer(id);
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : String(err);
  }

  if (!detail) {
    return (
      <div className="page-wrap">
        <div className="lms-state" role="alert">
          <p>
            {t('loadFailed')}
            {loadError ? `: ${loadError}` : ''}
          </p>
        </div>
      </div>
    );
  }

  const staticLabels: CourseStaticLabels = {
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

  return (
    <div className="page-wrap">
      <CourseStatic detail={detail} locale={locale} labels={staticLabels} />
      <section className="lms-section" aria-labelledby="lms-cohorts-h">
        <h2 id="lms-cohorts-h">{t('courseCohortsTitle')}</h2>
        <CourseView courseId={id} locale={locale} labels={cohortLabels} />
      </section>
    </div>
  );
}
