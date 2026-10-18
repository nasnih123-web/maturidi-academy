import type { TemplateItem } from '@/components/ContentCard';
import type { Locale } from './types';

/**
 * DEMO ONLY — fixture items for the `/demo/sections` dev page.
 * These are hand-written sample strings, clearly fake, and MUST NEVER
 * appear in any production path. The homepage and CMS surfaces never
 * import this module.
 */

interface DemoFixture {
  id: string;
  title: Record<Locale, string>;
  subtitle: Record<Locale, string>;
  author: Record<Locale, string>;
  category: Record<Locale, string>;
  duration: Record<Locale, string>;
  badge: Record<Locale, string>;
}

const FIXTURES: DemoFixture[] = [
  {
    id: 'demo-1',
    title: { fa: 'نمونهٔ نمایشی ۱ — فتوا', ar: 'عينة تجريبية ١ — فتوى', en: 'Demo sample 1 — Fatwa' },
    subtitle: { fa: 'این متن نمایشی است و محتوای واقعی نیست.', ar: 'هذا نص تجريبي وليس محتوى حقيقيًا.', en: 'This is demo text, not real content.' },
    author: { fa: 'نویسندهٔ نمایشی', ar: 'كاتب تجريبي', en: 'Demo author' },
    category: { fa: 'دستهٔ نمایشی', ar: 'تصنيف تجريبي', en: 'Demo category' },
    duration: { fa: '۵ دقیقه', ar: '٥ دقائق', en: '5 min' },
    badge: { fa: 'نمایشی', ar: 'تجريبي', en: 'Demo' },
  },
  {
    id: 'demo-2',
    title: { fa: 'نمونهٔ نمایشی ۲ — درس', ar: 'عينة تجريبية ٢ — درس', en: 'Demo sample 2 — Lesson' },
    subtitle: { fa: 'زیرعنوان نمایشی برای پیش‌نمایش چیدمان.', ar: 'عنوان فرعي تجريبي لمعاينة التخطيط.', en: 'Demo subtitle for layout preview.' },
    author: { fa: 'استاد نمایشی', ar: 'أستاذ تجريبي', en: 'Demo teacher' },
    category: { fa: 'آموزش', ar: 'تعليم', en: 'Education' },
    duration: { fa: '۱۲ دقیقه', ar: '١٢ دقيقة', en: '12 min' },
    badge: { fa: 'جدید', ar: 'جديد', en: 'New' },
  },
  {
    id: 'demo-3',
    title: { fa: 'نمونهٔ نمایشی ۳ — کتاب', ar: 'عينة تجريبية ٣ — كتاب', en: 'Demo sample 3 — Book' },
    subtitle: { fa: 'توضیح کوتاه نمایشی دربارهٔ این کتاب.', ar: 'وصف تجريبي قصير عن هذا الكتاب.', en: 'Short demo blurb about this book.' },
    author: { fa: 'مؤلف نمایشی', ar: 'مؤلف تجريبي', en: 'Demo writer' },
    category: { fa: 'کتابخانه', ar: 'مكتبة', en: 'Library' },
    duration: { fa: '۳۲۰ صفحه', ar: '٣٢٠ صفحة', en: '320 pages' },
    badge: { fa: 'ویژه', ar: 'مميز', en: 'Featured' },
  },
  {
    id: 'demo-4',
    title: { fa: 'نمونهٔ نمایشی ۴ — مقاله', ar: 'عينة تجريبية ٤ — مقال', en: 'Demo sample 4 — Article' },
    subtitle: { fa: 'پاراگراف نمایشی برای تست چیدمان مجله‌ای.', ar: 'فقرة تجريبية لاختبار تخطيط المجلة.', en: 'Demo paragraph for the magazine layout.' },
    author: { fa: 'پژوهشگر نمایشی', ar: 'باحث تجريبي', en: 'Demo researcher' },
    category: { fa: 'مقالات', ar: 'مقالات', en: 'Articles' },
    duration: { fa: '۸ دقیقه', ar: '٨ دقائق', en: '8 min' },
    badge: { fa: 'نمایشی', ar: 'تجريبي', en: 'Demo' },
  },
  {
    id: 'demo-5',
    title: { fa: 'نمونهٔ نمایشی ۵ — صوت', ar: 'عينة تجريبية ٥ — صوت', en: 'Demo sample 5 — Audio' },
    subtitle: { fa: 'توضیح نمایشی قسمت صوتی.', ar: 'وصف تجريبي للحلقة الصوتية.', en: 'Demo description of the audio episode.' },
    author: { fa: 'گویندهٔ نمایشی', ar: 'مذيع تجريبي', en: 'Demo narrator' },
    category: { fa: 'رسانه', ar: 'إعلام', en: 'Media' },
    duration: { fa: '۲۵ دقیقه', ar: '٢٥ دقيقة', en: '25 min' },
    badge: { fa: 'صوتی', ar: 'صوتي', en: 'Audio' },
  },
  {
    id: 'demo-6',
    title: { fa: 'نمونهٔ نمایشی ۶ — ویدیو', ar: 'عينة تجريبية ٦ — فيديو', en: 'Demo sample 6 — Video' },
    subtitle: { fa: 'توضیح نمایشی قسمت ویدیویی.', ar: 'وصف تجريبي للحلقة المرئية.', en: 'Demo description of the video episode.' },
    author: { fa: 'مدرس نمایشی', ar: 'مدرس تجريبي', en: 'Demo instructor' },
    category: { fa: 'رسانه', ar: 'إعلام', en: 'Media' },
    duration: { fa: '۴۰ دقیقه', ar: '٤٠ دقيقة', en: '40 min' },
    badge: { fa: 'ویدیویی', ar: 'مرئي', en: 'Video' },
  },
];

export function demoItems(locale: string): TemplateItem[] {
  const l = (['fa', 'ar', 'en'] as Locale[]).includes(locale as Locale) ? (locale as Locale) : 'fa';
  return FIXTURES.map((f) => ({
    id: f.id,
    title: f.title[l],
    subtitle: f.subtitle[l],
    author: f.author[l],
    category: f.category[l],
    duration: f.duration[l],
    badge: f.badge[l],
    image: null,
    href: null,
  }));
}
