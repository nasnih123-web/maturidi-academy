import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TasbihCounter } from '@/components/TasbihCounter';

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tasbih' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/** Digital tasbih — labels from messages, counting logic in the hook. */
export default async function TasbihPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tasbih' });
  const presets = t.raw('presets') as { key: string; text: string }[];

  return (
    <div className="page-wrap">
      <TasbihCounter
        labels={{
          title: t('title'),
          subtitle: t('subtitle'),
          tapHint: t('tapHint'),
          targetLabel: t('targetLabel'),
          customTarget: t('customTarget'),
          finishSession: t('finishSession'),
          reset: t('reset'),
          undo: t('undo'),
          dailyTotals: t('dailyTotals'),
          sessionsCount: t('sessionsCount'),
          totalCount: t('totalCount'),
          targetReached: t('targetReached'),
          voiceStart: t('voiceStart'),
          voiceStop: t('voiceStop'),
          voiceUnsupported: t('voiceUnsupported'),
          voiceListening: t('voiceListening'),
          signInToSync: t('signInToSync'),
          todaySynced: t('todaySynced'),
          presets: presets.map((p) => ({ key: p.key, text: p.text })),
        }}
      />
    </div>
  );
}
