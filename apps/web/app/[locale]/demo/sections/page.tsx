/**
 * DEV-ONLY demo page: renders all 10 below-hero section variants with
 * clearly-labeled fixture data so the variants can be previewed without
 * touching production content. Returns 404 in production builds.
 *
 * The fixtures are hand-written sample strings (lib/demo-fixtures.ts) and
 * NEVER appear on the real homepage or any CMS surface.
 */
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { demoItems } from '@/lib/demo-fixtures';
import { buildHomeLabels } from '@/lib/home-labels';
import { SECTION_VARIANTS, type SectionVariantId } from '@/components/sections/registry';
import { specForSection } from '@/components/sections/specs';
import type { SectionVariantProps } from '@/components/sections/types';
import { SliderClassic } from '@/components/sections/SliderClassic';
import { GridCards } from '@/components/sections/GridCards';
import { FeaturedRail } from '@/components/sections/FeaturedRail';
import { ShelfRow } from '@/components/sections/ShelfRow';
import { MosaicWall } from '@/components/sections/MosaicWall';
import { EditorialSplit } from '@/components/sections/EditorialSplit';
import { FeaturedList } from '@/components/sections/FeaturedList';
import { MagazineColumns } from '@/components/sections/MagazineColumns';
import { StackTimeline } from '@/components/sections/StackTimeline';
import { CompactList } from '@/components/sections/CompactList';
import type { ComponentType } from 'react';

const RENDERERS: Record<SectionVariantId, ComponentType<SectionVariantProps>> = {
  'slider-classic': SliderClassic,
  'grid-cards': GridCards,
  'featured-rail': FeaturedRail,
  'shelf-row': ShelfRow,
  'mosaic-wall': MosaicWall,
  'editorial-split': EditorialSplit,
  'featured-list': FeaturedList,
  'magazine-columns': MagazineColumns,
  'stack-timeline': StackTimeline,
  'compact-list': CompactList,
};

export function generateStaticParams() {
  return [{ locale: 'fa' }, { locale: 'ar' }, { locale: 'en' }];
}

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return { title: 'نمایشی — واریانت‌های سکشن', robots: { index: false, follow: false } };
}

const DEMO_COPY: Record<string, { badge: string; title: string; note: string; sectionTitle: string; sectionSub: string }> = {
  fa: {
    badge: 'صفحهٔ نمایشی — فقط برای توسعه',
    title: 'پیش‌نمایش واریانت‌های سکشن',
    note: 'تمام کارت‌های زیر دادهٔ نمایشی‌اند (lib/demo-fixtures.ts) و هیچ‌یک محتوای واقعی نیست. صفحهٔ اصلی هرگز این داده‌ها را نشان نمی‌دهد.',
    sectionTitle: 'بخش نمایشی',
    sectionSub: 'زیرعنوان نمایشی برای ارزیابی چیدمان',
  },
  ar: {
    badge: 'صفحة تجريبية — للتطوير فقط',
    title: 'معاينة متغيرات الأقسام',
    note: 'جميع البطاقات أدناه بيانات تجريبية وليست محتوى حقيقيًا. الصفحة الرئيسية لا تعرض هذه البيانات أبدًا.',
    sectionTitle: 'قسم تجريبي',
    sectionSub: 'عنوان فرعي تجريبي لتقييم التخطيط',
  },
  en: {
    badge: 'Demo page — development only',
    title: 'Section variant preview',
    note: 'All cards below are fixture data (lib/demo-fixtures.ts), not real content. The real homepage never shows these.',
    sectionTitle: 'Demo section',
    sectionSub: 'Demo subtitle for layout evaluation',
  },
};

export default async function DemoSectionsPage({ params: { locale } }: { params: { locale: string } }) {
  if (process.env.NODE_ENV === 'production') notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'home' });
  const labels = buildHomeLabels(t);
  const copy = DEMO_COPY[locale] ?? DEMO_COPY.fa;
  const items = demoItems(locale);
  // A neutral spec for the demo (article/magazine is the generic one).
  const spec = specForSection('community');

  return (
    <>
      <div className="demo-sections-head">
        <p className="badge-dev">{copy.badge}</p>
        <h1>{copy.title}</h1>
        <p>{copy.note}</p>
      </div>
      {SECTION_VARIANTS.map((meta, i) => {
        const Renderer = RENDERERS[meta.id as SectionVariantId];
        const label = meta.label[locale as 'fa' | 'ar' | 'en'] ?? meta.label.fa;
        const props: SectionVariantProps = {
          sectionId: `demo-section-${meta.id}`,
          title: `${copy.sectionTitle} — ${label}`,
          subtitle: copy.sectionSub,
          cta: { label: t('viewAllLabel'), href: `/${locale}` },
          items,
          locale,
          labels: labels.card,
          emptyTitle: t('emptyFallback'),
          contentType: spec.type,
          template: spec.template,
        };
        return (
          <div key={meta.id} className="demo-variant-block">
            <div style={{ textAlign: 'center' }}>
              <span className="demo-variant-tag">
                #{i + 1} · {meta.id} · {label}
              </span>
            </div>
            <Renderer {...props} />
          </div>
        );
      })}
    </>
  );
}
