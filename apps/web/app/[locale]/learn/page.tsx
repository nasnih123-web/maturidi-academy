import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { LearnDashboardLabels } from '@/components/LearnDashboard';
import { LearnDashboard } from '@/components/LearnDashboardLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  return { title: t('dashboardMetaTitle'), description: t('dashboardMetaDescription') };
}

/**
 * Student learning dashboard (Phase 8).
 *
 * Thin RSC shell: metadata + code-split interactive dashboard (ssr: false)
 * for the First Load JS budget. All data logic in lib/hooks/useLearnDashboard.
 */
export default async function LearnPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  const labels: LearnDashboardLabels = {
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
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('dashboardTitle')}</h1>
      <p className="page-sub">{t('dashboardSubtitle')}</p>
      <LearnDashboard locale={locale} labels={labels} />
    </div>
  );
}
