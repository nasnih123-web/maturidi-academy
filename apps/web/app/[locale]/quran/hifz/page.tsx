import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HifzHub, type HifzHubLabels } from '@/components/HifzHub';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return { title: t('hifzHubTitle') };
}

/**
 * Hifz hub — the separate hifz flow (dashboard / testing / voice
 * search / Tasmi). Deliberately NOT the study page: the user's
 * standing order (2026-11-06) keeps results/stats/history off the
 * study page, so they live here instead.
 */
export default async function HifzHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quran' });

  const labels: HifzHubLabels = {
    title: t('hifzHubTitle'),
    tabDashboard: t('hifzHubTabDashboard'),
    tabTesting: t('hifzHubTabTesting'),
    tabVoiceSearch: t('hifzHubTabVoiceSearch'),
    tabTasmi: t('hifzHubTabTasmi'),
    dashboard: {
      title: t('hifzHubTabDashboard'),
      loading: t('hifzHubDashLoading'),
      error: t('hifzHubDashError'),
      resumeTitle: t('hifzResumeTitle'),
      resumeContinue: t('hifzResumeContinue'),
      resumeDismiss: t('hifzResumeDismiss'),
      attempts: t('hifzHubDashAttempts'),
      gradedWords: t('hifzHubDashGradedWords'),
      correct: t('hifzHubDashCorrect'),
      close: t('hifzHubDashClose'),
      wrong: t('hifzHubDashWrong'),
      skipped: t('hifzHubDashSkipped'),
      errorsByType: t('hifzHubDashErrorsByType'),
      dailySeries: t('hifzHubDashDailySeries'),
      dueAyahs: t('hifzHubDashDueAyahs'),
      dueCount: t('hifzHubDashDueCount'),
      plans: t('hifzHubDashPlans'),
      planTitle: t('hifzHubDashPlanTitle'),
      planKind: t('hifzHubDashPlanKind'),
      planDirection: t('hifzHubDashPlanDirection'),
      planDirectionNormal: t('hifzHubDashPlanDirectionNormal'),
      planDirectionReverse: t('hifzHubDashPlanDirectionReverse'),
      planKindMemorize: t('hifzHubDashPlanKindMemorize'),
      planKindReview: t('hifzHubDashPlanKindReview'),
      planKindRecite: t('hifzHubDashPlanKindRecite'),
      planStartSurah: t('hifzHubDashPlanStartSurah'),
      planStartAyah: t('hifzHubDashPlanStartAyah'),
      planEndSurah: t('hifzHubDashPlanEndSurah'),
      planEndAyah: t('hifzHubDashPlanEndAyah'),
      planDailyNew: t('hifzHubDashPlanDailyNew'),
      planDailyReview: t('hifzHubDashPlanDailyReview'),
      planCreate: t('hifzHubDashPlanCreate'),
      planPause: t('hifzHubDashPlanPause'),
      planResume: t('hifzHubDashPlanResume'),
      planProgress: t('hifzHubDashPlanProgress'),
      weakestAyahs: t('hifzHubDashWeakestAyahs'),
      suggested: t('hifzHubDashSuggested'),
      suggestedSetup: t('hifzHubDashSuggestedSetup'),
      suggestedWarmUp: t('hifzHubDashSuggestedWarmUp'),
      suggestedWeakest: t('hifzHubDashSuggestedWeakest'),
      noData: t('hifzHubDashNoData'),
      refresh: t('hifzHubDashRefresh'),
    },
    testing: {
      title: t('hifzHubTabTesting'),
      temporaryNote: t('hifzHubTestTemporaryNote'),
      surahStart: t('hifzHubTestSurahStart'),
      surahEnd: t('hifzHubTestSurahEnd'),
      questionCount: t('hifzHubTestQuestionCount'),
      timeLimit: t('hifzHubTestTimeLimit'),
      timeUnlimited: t('hifzHubTestTimeUnlimited'),
      length: t('hifzHubTestLength'),
      lengthShort: t('hifzHubTestLengthShort'),
      lengthMedium: t('hifzHubTestLengthMedium'),
      lengthLong: t('hifzHubTestLengthLong'),
      stopRule: t('hifzHubTestStopRule'),
      stopAyahEnd: t('hifzHubTestStopAyahEnd'),
      stopLineEnd: t('hifzHubTestStopLineEnd'),
      start: t('hifzHubTestStart'),
      loading: t('hifzHubTestLoading'),
      error: t('hifzHubTestError'),
      micDenied: t('hifzHubTestMicDenied'),
      questionOf: t('hifzHubTestQuestionOf'),
      prompt: t('hifzHubTestPrompt'),
      recordAnswer: t('hifzHubTestRecordAnswer'),
      stopRecord: t('hifzHubTestStopRecord'),
      grading: t('hifzHubTestGrading'),
      skip: t('hifzHubTestSkip'),
      peek: t('hifzHubTestPeek'),
      peekCount: t('hifzHubTestPeekCount'),
      score: t('hifzHubTestScore'),
      removeFalsePositive: t('hifzHubTestRemoveFalsePositive'),
      removed: t('hifzHubTestRemoved'),
      complete: t('hifzHubTestComplete'),
      totalScore: t('hifzHubTestTotalScore'),
      next: t('hifzHubTestNext'),
      answered: t('hifzHubTestAnswered'),
      skipped: t('hifzHubTestSkipped'),
    },
    voiceSearch: {
      title: t('hifzHubTabVoiceSearch'),
      hint: t('hifzHubVoiceHint'),
      record: t('hifzHubVoiceRecord'),
      stopRecord: t('hifzHubVoiceStopRecord'),
      recording: t('hifzHubVoiceRecording'),
      searching: t('hifzHubVoiceSearching'),
      micDenied: t('hifzHubVoiceMicDenied'),
      error: t('hifzHubVoiceError'),
      noCandidates: t('hifzHubVoiceNoCandidates'),
      probable: t('hifzHubVoiceProbable'),
      possible: t('hifzHubVoicePossible'),
      note: t('hifzHubVoiceNote'),
      goTo: t('hifzHubVoiceGoTo'),
    },
    tasmi: {
      title: t('hifzHubTabTasmi'),
      selfAssessedNote: t('hifzHubTasmiSelfAssessedNote'),
      method: t('hifzHubTasmiMethod'),
      methodTasmi8: t('hifzHubTasmiMethodTasmi8'),
      method6446: t('hifzHubTasmiMethod6446'),
      method3x3: t('hifzHubTasmiMethod3x3'),
      variant: t('hifzHubTasmiVariant'),
      variantStandard: t('hifzHubTasmiVariantStandard'),
      variantGentle: t('hifzHubTasmiVariantGentle'),
      variantRevision: t('hifzHubTasmiVariantRevision'),
      surahStart: t('hifzHubTasmiSurahStart'),
      ayahStart: t('hifzHubTasmiAyahStart'),
      surahEnd: t('hifzHubTasmiSurahEnd'),
      ayahEnd: t('hifzHubTasmiAyahEnd'),
      start: t('hifzHubTasmiStart'),
      loading: t('hifzHubTasmiLoading'),
      error: t('hifzHubTasmiError'),
      tap: t('hifzHubTasmiTap'),
      nextStage: t('hifzHubTasmiNextStage'),
      pause: t('hifzHubTasmiPause'),
      resume: t('hifzHubTasmiResume'),
      complete: t('hifzHubTasmiComplete'),
      rate: t('hifzHubTasmiRate'),
      rateForgot: t('hifzHubTasmiRateForgot'),
      rateHard: t('hifzHubTasmiRateHard'),
      rateGood: t('hifzHubTasmiRateGood'),
      rateEasy: t('hifzHubTasmiRateEasy'),
      reflection: t('hifzHubTasmiReflection'),
      reflectionPlaceholder: t('hifzHubTasmiReflectionPlaceholder'),
      saveReflection: t('hifzHubTasmiSaveReflection'),
      currentStage: t('hifzHubTasmiCurrentStage'),
      currentSet: t('hifzHubTasmiCurrentSet'),
      done: t('hifzHubTasmiDone'),
      noSession: t('hifzHubTasmiNoSession'),
    },
  };

  return <HifzHub labels={labels} locale={locale} />;
}
