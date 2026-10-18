/**
 * SECTION_VARIANTS — the canonical registry of below-hero homepage section
 * variants (polish milestone, issue #8). Ported from the turbo UI source
 * (`home-sections.tsx` layouts + `home-composition-lab.tsx` compositions),
 * adapted to our API contracts.
 *
 * This module is the single source of truth for variant ids:
 * - the web homepage consumes them via `home.sections` settings slots
 *   (`{ id, variant, enabled }`),
 * - the CRM variant picker (Track B) mirrors these ids/labels.
 *
 * Pure data + type guards — no business logic (ADR-0002).
 */

export interface SectionVariantMeta {
  /** Stable id used in `home.sections` slot settings. */
  id: string;
  label: { fa: string; ar: string; en: string };
  /** Short designer-facing description (CRM picker hint). */
  description: string;
}

export const SECTION_VARIANTS: SectionVariantMeta[] = [
  {
    id: 'slider-classic',
    label: { fa: 'اسلایدر کلاسیک', ar: 'سلايدر كلاسيكي', en: 'Classic slider' },
    description: 'ریل افقی کارت‌ها با دکمه‌های قبلی/بعدی و نقطه‌های صفحه',
  },
  {
    id: 'grid-cards',
    label: { fa: 'شبکهٔ کارت‌ها', ar: 'شبكة البطاقات', en: 'Card grid' },
    description: 'شبکهٔ واکنش‌گرای ۲ تا ۴ ستونه، بدون اسکرول افقی',
  },
  {
    id: 'featured-rail',
    label: { fa: 'ریل ویژه', ar: 'سكة مميزة', en: 'Featured rail' },
    description: 'کارت ویژهٔ بزرگ + ریل اسلایدری عریض برای بقیه',
  },
  {
    id: 'shelf-row',
    label: { fa: 'قفسهٔ سه‌بعدی', ar: 'رف ثلاثي الأبعاد', en: '3D shelf' },
    description: 'ردیف کتاب‌مانند با پرسپکتیو ملایم — مناسب کتابخانه',
  },
  {
    id: 'mosaic-wall',
    label: { fa: 'دیوار موزاییکی', ar: 'جدار فسيفسائي', en: 'Mosaic wall' },
    description: 'کارت لید ۲×۲ + بقیه در شبکهٔ فشرده',
  },
  {
    id: 'editorial-split',
    label: { fa: 'تحریریه‌ای دوتکه', ar: 'تقسيم تحريري', en: 'Editorial split' },
    description: 'مطلب ویژهٔ بزرگ در کنار ستون فهرست مینیمال',
  },
  {
    id: 'featured-list',
    label: { fa: 'ویژه + فهرست', ar: 'مميز + قائمة', en: 'Featured + list' },
    description: 'کارت ویژه در کنار فهرست تیترها با نشان ستاره',
  },
  {
    id: 'magazine-columns',
    label: { fa: 'ستون‌های مجله‌ای', ar: 'أعمدة المجلة', en: 'Magazine columns' },
    description: 'چیدمان روزنامه‌ای چندستونه با کارت‌های تحریریه‌ای',
  },
  {
    id: 'stack-timeline',
    label: { fa: 'خط زمانی', ar: 'خط زمني', en: 'Timeline' },
    description: 'فهرست عمودی با خط راهنما و نقطه‌های نشانگر',
  },
  {
    id: 'compact-list',
    label: { fa: 'فهرست فشرده', ar: 'قائمة مضغوطة', en: 'Compact list' },
    description: 'ردیف‌های فشرده با تیتر و فراداده — بیشترین تراکم',
  },
];

export type SectionVariantId = (typeof SECTION_VARIANTS)[number]['id'];

const VARIANT_IDS = new Set<string>(SECTION_VARIANTS.map((v) => v.id));

export function isVariantId(v: unknown): v is SectionVariantId {
  return typeof v === 'string' && VARIANT_IDS.has(v);
}
