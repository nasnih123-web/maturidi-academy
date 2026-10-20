import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCampaigns, toCampaignView } from '@/lib/finance';
import { CampaignCard } from '@/components/finance/CampaignCard';
import { EmptyState } from '@/components/EmptyState';
import './finance.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'donate' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Campaign list (Phase 15).
 *
 * Thin RSC shell: server-fetches published campaigns (GET
 * /api/v1/finance/campaigns), builds view models in lib/finance.ts, renders
 * presentational cards. API failure renders an honest error state; an empty
 * catalogue renders an honest empty state (contract §15: no mock data).
 */
export default async function DonatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'donate' });
  const currencyLabel = t('currency');

  let cards: { id: string; view: ReturnType<typeof toCampaignView> }[] = [];
  let failed = false;
  try {
    const campaigns = await getCampaigns(locale);
    cards = campaigns.map((c) => ({ id: c.id, view: toCampaignView(c, locale, currencyLabel) }));
  } catch {
    failed = true;
  }

  return (
    <div className="fin-page">
      <div className="fin-page-inner">
        <h1 className="fin-title">{t('title')}</h1>
        <p className="fin-subtitle">{t('subtitle')}</p>
        {failed ? (
          <EmptyState title={t('loadFailed')} hint={t('loadFailedHint')} />
        ) : cards.length === 0 ? (
          <EmptyState title={t('noCampaigns')} hint={t('noCampaignsHint')} />
        ) : (
          <div className="fin-grid">
            {cards.map(({ id, view }) => (
              <CampaignCard
                key={id}
                view={view}
                href={`/${locale}/donate/${encodeURIComponent(id)}`}
                labels={{ donateNow: t('donateNow'), raisedPrefix: t('raisedPrefix') }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
