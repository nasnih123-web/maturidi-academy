'use client';

import { useParams } from 'next/navigation';

/**
 * Places-route error boundary: a crash inside the globe subtree (a map
 * error, a layer failure, a bad place record) renders this friendly page
 * with a retry button instead of a blank page.
 */
export default function PlacesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams();
  const locale = params?.locale === 'ar' ? 'ar' : params?.locale === 'en' ? 'en' : 'fa';
  const copy = {
    fa: {
      title: 'نقشه بارگذاری نشد',
      body: 'در نمایش کرهٔ اماکن خطایی رخ داد. با دکمهٔ زیر دوباره تلاش کنید؛ اگر خطا تکرار شد، صفحه را تازه‌سازی کنید.',
      retry: 'تلاش دوباره',
    },
    ar: {
      title: 'تعذّر تحميل الخريطة',
      body: 'حدث خطأ أثناء عرض كرة الأماكن. حاول مرة أخرى بالزر أدناه؛ إذا تكرر الخطأ، حدّث الصفحة.',
      retry: 'حاول مرة أخرى',
    },
    en: {
      title: 'The map could not be loaded',
      body: 'Something went wrong while showing the places globe. Try again with the button below; if the error repeats, refresh the page.',
      retry: 'Try again',
    },
  }[locale];
  return (
    <div className="page-wrap">
      <h1 className="page-title">{copy.title}</h1>
      <p className="page-subtitle">{copy.body}</p>
      <button type="button" className="globe-tool-btn" onClick={() => reset()}>
        {copy.retry}
      </button>
    </div>
  );
}
