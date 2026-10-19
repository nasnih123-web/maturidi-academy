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

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Phase 8 — LMS demo fixtures (DEV ONLY, same contract as above).    */
/* Clearly fake sample strings; NEVER appear in any production path.  */
/* Shapes mirror the real backend contract in lib/lms.ts.             */
/* ------------------------------------------------------------------ */

import type {
  LmsCertificate,
  LmsCohort,
  LmsCourse,
  LmsCourseDetail,
  LmsLesson,
  LmsRecommendation,
  LmsStudyReport,
  LmsCertificateVerify,
} from './lms';
import type { LearnDashboardData } from './hooks/useLearnDashboard';

const L8 = (fa: string, ar: string, en: string) => ({ fa, ar, en });

function demoCourse8(id: string, n: number, progressPct: number | null): LmsCourse {
  return {
    id,
    curriculum_id: null,
    title: L8(`دورهٔ نمایشی ${n} — عقاید ماتریدی`, `دورة تجريبية ${n} — عقيدة الماتريدية`, `Demo course ${n} — Maturidi creed`),
    description: L8('توضیح نمایشی دوره؛ محتوای واقعی نیست.', 'وصف تجريبي للدورة؛ ليس محتوى حقيقيًا.', 'Demo course description; not real content.'),
    level: n === 1 ? 'beginner' : 'intermediate',
    lesson_count: 8,
    progress_pct: progressPct,
  };
}

function demoLesson8(courseId: string, n: number, status: 'not_started' | 'in_progress' | 'completed'): LmsLesson {
  return {
    id: `demo-lesson-${n}`,
    course_id: courseId,
    title: L8(`درس نمایشی ${n}`, `الدرس التجريبي ${n}`, `Demo lesson ${n}`),
    body: [
      { type: 'text', text: L8('این یک بند نمایشی است و محتوای واقعی نیست.', 'هذه فقرة تجريبية وليست محتوى حقيقيًا.', 'This is a demo paragraph, not real content.') },
      { type: 'scholar_quote_ref', text: L8('نقل‌قول نمایشی برای پیش‌نمایش چیدمان.', 'اقتباس تجريبي لمعاينة التخطيط.', 'Demo quote for layout preview.'), scholar: L8('عالم نمایشی', 'عالم تجريبي', 'Demo scholar') },
      ...(n % 2 === 0 ? [{ type: 'quiz_ref' as const, question_ids: ['dq1', 'dq2'] }] : []),
    ],
    duration_minutes: 30,
    sort_order: n - 1,
    is_free_preview: n === 1,
    status,
    position_seconds: status === 'completed' ? 1800 : status === 'in_progress' ? 720 : 0,
  };
}

/** DEV ONLY — dashboard fixture. */
export function demoDashboardData(): LearnDashboardData {
  const courses = [demoCourse8('demo-course-1', 1, 62), demoCourse8('demo-course-2', 2, 100)];
  return {
    courses,
    recommendations: [
      {
        lesson: demoLesson8('demo-course-1', 6, 'not_started'),
        course_title: courses[0].title,
        level: 'beginner',
        reason: 'level_next_incomplete',
      },
      {
        lesson: demoLesson8('demo-course-2', 1, 'not_started'),
        course_title: courses[1].title,
        level: 'intermediate',
        reason: 'next_level',
      },
    ] as LmsRecommendation[],
    cohorts: [
      {
        id: 'demo-cohort-1',
        course_id: 'demo-course-1',
        title: L8('گروه هم‌درسی نمایشی — بهار', 'المجموعة الدراسية التجريبية — الربيع', 'Demo study cohort — Spring'),
        starts_at: '2026-11-01T00:00:00',
        ends_at: '2027-01-31T00:00:00',
        max_seats: 40,
        is_open: true,
        enrolled_count: 27,
        seats_left: 13,
        user_enrolled: true,
      },
    ] as LmsCohort[],
    certificates: [
      {
        id: 'demo-cert-1',
        code: 'MA-DEMO-0001',
        course_id: 'demo-course-2',
        course_title: L8('دورهٔ نمایشی ۲ — عقاید ماتریدی', 'الدورة التجريبية ٢ — عقيدة الماتريدية', 'Demo course 2 — Maturidi creed'),
        issued_at: '2026-09-15T00:00:00',
        download_url: null,
      },
    ] as LmsCertificate[],
    report: {
      courses: [
        {
          course_id: 'demo-course-1',
          course_title: courses[0].title,
          level: 'beginner',
          total_lessons: 8,
          completed_lessons: 5,
          progress_pct: 62,
          quiz_avg: 86,
          quiz_attempts: 4,
        },
        {
          course_id: 'demo-course-2',
          course_title: courses[1].title,
          level: 'intermediate',
          total_lessons: 8,
          completed_lessons: 8,
          progress_pct: 100,
          quiz_avg: 92,
          quiz_attempts: 5,
        },
      ],
      total_completed_lessons: 13,
      total_lessons: 16,
      overall_progress_pct: 81,
      quiz_overall_avg: 89,
      streak_days: 6,
    } as LmsStudyReport,
  };
}

/** DEV ONLY — course detail fixture. */
export function demoCourseDetail(): LmsCourseDetail {
  const course = demoCourse8('demo-course-1', 1, 62);
  return {
    course,
    lessons: [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      demoLesson8('demo-course-1', n, n <= 5 ? 'completed' : n === 6 ? 'in_progress' : 'not_started'),
    ),
    completed_lessons: 5,
    total_lessons: 8,
    progress_pct: 62,
    has_certificate: false,
  };
}

/** DEV ONLY — single lesson fixture. */
export function demoLesson(): LmsLesson {
  return demoLesson8('demo-course-1', 3, 'in_progress');
}

/** DEV ONLY — certificate verdict fixtures. */
export function demoCertificateValid(): LmsCertificateVerify {
  return {
    valid: true,
    code: 'MA-DEMO-0001',
    holder_name: 'دانش‌پژوه نمایشی',
    course_title: L8('دورهٔ نمایشی ۲ — عقاید ماتریدی', 'الدورة التجريبية ٢ — عقيدة الماتريدية', 'Demo course 2 — Maturidi creed'),
    issued_at: '2026-09-15T00:00:00',
    locale: 'fa',
  };
}

/** DEV ONLY — fixture quiz questions for the lesson-quiz preview. */
export function demoQuizQuestions() {
  return [
    {
      id: 'dq1',
      text: 'سؤال نمایشی ۱: این متن نمایشی است؟',
      options: ['بله، نمایشی است', 'خیر', 'نمی‌دانم'],
      sourceCitation: 'منبع نمایشی ۱',
    },
    {
      id: 'dq2',
      text: 'سؤال نمایشی ۲: هدف این صفحه چیست؟',
      options: ['پیش‌نمایش چیدمان', 'محتوای واقعی', 'تبلیغات'],
      sourceCitation: 'منبع نمایشی ۲',
    },
  ];
}
