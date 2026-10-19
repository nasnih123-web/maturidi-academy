import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMadhabComparisonServer } from '@/lib/fatwa-server';
import { ApiError } from '@/lib/api';
import { MadhabCompare } from '@/components/MadhabCompare';
import { EmptyState } from '@/components/EmptyState';

export async function generateMetadata({
  params: { locale, topicId },
}: {
  params: { locale: string; topicId: string };
}): Promise<Metadata> {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return { title: `${t('compareTitle')} | ${t('metaTitle')}` };
}

/**
 * Madhab comparison page (Phase 6 — web track).
 *
 * Server-rendered from GET /api/v1/fatwa/compare/{topic_id}. Loading /
 * error / empty states are explicit; a 404 from the API renders the
 * Next.js not-found page.
 */
export default async function ComparePage({
  params: { locale, topicId },
}: {
  params: { locale: string; topicId: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'fatwa' });

  let comparison = null;
  let failed = false;
  try {
    comparison = await getMadhabComparisonServer(topicId, locale);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    failed = true;
  }

  const madhabNames = t.raw('madhabNames') as Record<string, string>;

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('compareTitle')}</h1>
      {comparison?.topic ? (
        <p className="page-sub">{comparison.topic}</p>
      ) : (
        <p className="page-sub">{t('compareSubtitle')}</p>
      )}
      {comparison?.description && <p className="ftw-muted">{comparison.description}</p>}
      {failed ? (
        <div className="ftw-error" role="alert">
          {t('compareFailed')}
        </div>
      ) : comparison ? (
        <MadhabCompare
          comparison={comparison}
          labels={{
            evidenceLabel: t('evidenceLabel'),
            madhabNames,
            emptyLabel: t('emptyCompare'),
          }}
        />
      ) : (
        <EmptyState title={t('emptyCompare')} />
      )}
    </div>
  );
}
