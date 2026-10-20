'use client';

import dynamic from 'next/dynamic';

// Next 15: `ssr: false` داخل Server Component مجاز نیست؛ این wrapper
// کلاینتی همان code-split قبلیِ صفحات RSC را حفظ می‌کند
// (بودجهٔ First Load JS — docs/performance-budget.md).

export const CourseView = dynamic(() => import('@/components/CourseView').then((m) => m.CourseView), {
  ssr: false,
  loading: () => <p className="lms-state">…</p>,
});
