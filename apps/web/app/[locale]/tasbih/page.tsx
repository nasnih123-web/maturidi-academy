import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TasbihCounter } from '@/components/TasbihCounter';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tasbih' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/** Digital tasbih — labels from messages, counting logic in the hook. */
export default async function TasbihPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tasbih' });
  const presets = t.raw('presets') as { key: string; text: string }[];

  return (
    <div className="page-wrap">
      <TasbihCounter
        labels={{
          title: t('title'),
          subtitle: t('subtitle'),
          tagline: t('tagline'),
          tapHint: t('tapHint'),
          targetLabel: t('targetLabel'),
          customTarget: t('customTarget'),
          finishSession: t('finishSession'),
          reset: t('reset'),
          undo: t('undo'),
          dailyTotals: t('dailyTotals'),
          sessionsCount: t('sessionsCount'),
          totalCount: t('totalCount'),
          timesLabel: t('timesLabel'),
          targetReached: t('targetReached'),
          roundLabel: t('roundLabel'),
          ofCount: t('ofCount'),
          voiceStart: t('voiceStart'),
          voiceStop: t('voiceStop'),
          voiceUnsupported: t('voiceUnsupported'),
          voiceListening: t('voiceListening'),
          voiceHeard: t('voiceHeard'),
          signInToSync: t('signInToSync'),
          todaySynced: t('todaySynced'),
          verse: t('verse'),
          verseCaption: t('verseCaption'),
          presets: presets.map((p) => ({ key: p.key, text: p.text })),
        }}
      />
    </div>
  );
}
