import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MosarefCalculator } from '@/components/MosarefCalculatorLazy';
import type { MosarefLabels } from '@/components/MosarefCalculator';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'calculators.mosaref' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function MosarefPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'calculators.mosaref' });
  const labels: MosarefLabels = {
    rootLabel: t('rootLabel'),
    rootPlaceholder: t('rootPlaceholder'),
    babLabel: t('babLabel'),
    babs: t.raw('babs') as Record<string, string>,
    transitivityLabel: t('transitivityLabel'),
    mutaadi: t('mutaadi'),
    laazim: t('laazim'),
    harfJarLabel: t('harfJarLabel'),
    harfJars: t.raw('harfJars') as Record<string, string>,
    conjugate: t('conjugate'),
    conjugating: t('conjugating'),
    invalidInput: t('invalidInput'),
    failed: t('failed'),
    errors: t.raw('errors') as Record<string, string>,
    tables: t.raw('tables') as Record<string, string>,
    columns: t.raw('columns') as Record<string, string>,
    pronouns: t.raw('pronouns') as string[],
    amrPronouns: t.raw('amrPronouns') as string[],
    derivedRows3: t.raw('derivedRows3') as string[],
    derivedRows6: t.raw('derivedRows6') as string[],
    verbClassLabel: t('verbClassLabel'),
    verbClasses: t.raw('verbClasses') as Record<string, string>,
    approximateNote: t('approximateNote'),
  };
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-sub">{t('subtitle')}</p>
      <MosarefCalculator labels={labels} locale={locale} />
    </div>
  );
}
