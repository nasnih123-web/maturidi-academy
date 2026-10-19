import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { VoiceAssistantLabels } from '@/components/VoiceAssistant';

/**
 * Phase 12 — bilingual (fa/ar) voice assistant. Code-split with
 * next/dynamic so the MediaRecorder/hook chunk never touches the homepage
 * bundle (docs/performance-budget.md). SSR stays on: the idle UI is
 * server-rendered; MediaRecorder is only touched in event handlers/effects.
 */
const VoiceAssistant = dynamic(
  () => import('@/components/VoiceAssistant').then((m) => m.VoiceAssistant),
  { loading: () => <p className="vox-empty">…</p> },
);

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'voice' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * English notice — the assistant is bilingual fa/ar by spec (Phase 12 brief:
 * «این ویژگی مشخصاً دوزبانه فارسی/عربی است، نه سه‌زبانه»). No fake English
 * voice support: en visitors get an honest notice with locale switch links.
 */
function EnglishNotice({ t }: { t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <div className="vox-wrap">
      <div className="vox-notice" role="note">
        <h2 className="vox-notice-title">{t('enNoticeTitle')}</h2>
        <p className="vox-notice-body">{t('enNoticeBody')}</p>
        <div className="vox-notice-links">
          <Link href="/fa/voice" className="vox-btn">
            {t('enNoticeFaLink')}
          </Link>
          <Link href="/ar/voice" className="vox-btn">
            {t('enNoticeArLink')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default async function VoicePage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'voice' });

  if (locale === 'en') {
    return (
      <div className="page-wrap">
        <h1 className="page-title">{t('title')}</h1>
        <EnglishNotice t={t} />
      </div>
    );
  }

  const labels: VoiceAssistantLabels = {
    holdHint: t('holdHint'),
    tapHint: t('tapHint'),
    micAria: t('micAria'),
    micUnsupportedHint: t('micUnsupportedHint'),
    phaseIdle: t('phaseIdle'),
    phaseRecording: t('phaseRecording'),
    phaseTranscribing: t('phaseTranscribing'),
    phaseAnswering: t('phaseAnswering'),
    phasePlaying: t('phasePlaying'),
    cancelRecording: t('cancelRecording'),
    cancelRequest: t('cancelRequest'),
    you: t('you'),
    assistant: t('assistant'),
    voiceMessageCaption: t('voiceMessageCaption'),
    recitationLabel: t('recitationLabel'),
    ttsLabel: t('ttsLabel'),
    noAudioNote: t('noAudioNote'),
    playAria: t('playAria'),
    pauseAria: t('pauseAria'),
    citationsTitle: t('citationsTitle'),
    clearConversation: t('clearConversation'),
    emptyHint: t('emptyHint'),
    dismissAria: t('dismissAria'),
    noticeTtsUnavailable: t('noticeTtsUnavailable'),
    noticeSttUnavailable: t('noticeSttUnavailable'),
    errors: {
      mic_unsupported: t('errors.mic_unsupported'),
      mic_denied: t('errors.mic_denied'),
      mic_error: t('errors.mic_error'),
      upload_failed: t('errors.upload_failed'),
      api_error: t('errors.api_error'),
    },
  };

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <VoiceAssistant locale={locale as 'fa' | 'ar'} labels={labels} />
    </div>
  );
}
