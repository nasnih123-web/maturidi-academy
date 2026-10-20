import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { MadhabKey } from '@/lib/calculators';
import { InheritanceCalculator } from '@/components/InheritanceCalculatorLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'calculators' });
  return { title: t('inheritance.metaTitle'), description: t('inheritance.metaDescription') };
}

/**
 * Inheritance (fara'id) calculator page (Phase 7 — web track).
 *
 * Pure server component: the interactive calculator is code-split
 * (ssr: false) so the route stays inside the First Load JS budget
 * (docs/performance-budget.md). All strings are server-rendered and
 * passed as props — the client chunk carries no i18n runtime.
 */
export default async function InheritancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'calculators' });
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('inheritance.title')}</h1>
      <p className="page-sub">{t('inheritance.subtitle')}</p>
      <InheritanceCalculator
        locale={locale}
        labels={{
          madhabLabel: t('inheritance.madhabLabel'),
          madhabs: t.raw('madhabs') as Record<MadhabKey, string>,
          estateLabel: t('inheritance.estateLabel'),
          estatePlaceholder: t('inheritance.estatePlaceholder'),
          estateHint: t('inheritance.estateHint'),
          heirsTitle: t('inheritance.heirsTitle'),
          heirTypeLabel: t('inheritance.heirTypeLabel'),
          heirCountLabel: t('inheritance.heirCountLabel'),
          heirTypes: t.raw('heirTypes') as Record<string, string>,
          addHeir: t('inheritance.addHeir'),
          removeHeir: t('inheritance.removeHeir'),
          calculate: t('inheritance.calculate'),
          calculating: t('inheritance.calculating'),
          estateInvalid: t('inheritance.estateInvalid'),
          needHeir: t('inheritance.needHeir'),
          countInvalid: t('inheritance.countInvalid'),
          resultTitle: t('inheritance.resultTitle'),
          heirCol: t('inheritance.heirCol'),
          countCol: t('inheritance.countCol'),
          shareCol: t('inheritance.shareCol'),
          amountCol: t('inheritance.amountCol'),
          totalLabel: t('inheritance.totalLabel'),
          ruleVersion: t.raw('inheritance.ruleVersion') as string,
          notesTitle: t('inheritance.notesTitle'),
          print: t('inheritance.print'),
          save: t('inheritance.save'),
          saveLoginHint: t('inheritance.saveLoginHint'),
          saving: t('inheritance.saving'),
          saved: t('inheritance.saved'),
          saveFailed: t('inheritance.saveFailed'),
          recalculate: t('inheritance.recalculate'),
          failed: t('inheritance.failed'),
          pendingTitle: t('inheritance.pendingTitle'),
          pendingBody: t('inheritance.pendingBody'),
        }}
      />
    </div>
  );
}
