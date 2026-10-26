import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiError, levelLabel, listCoursesServer } from '@/lib/lms';
import { pickText } from '@/lib/localize';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });
  return { title: `${t('coursesTitle')} | آکادمی ماتریدی` };
}

/**
 * Course catalog page.
 * Public course list (server-rendered). Fixes the 404 on /learn/courses:
 * nav + hero CTA linked here, but no listing route existed — only the
 * [id] detail page and the /learn dashboard. API unreachable → graceful
 * error state, never mock.
 */
export default async function CoursesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'lms' });

  let courses = null;
  let loadError: string | null = null;
  try {
    courses = await listCoursesServer();
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : String(err);
  }

  if (!courses) {
    return (
      <div className="page-wrap">
        <div className="lms-state" role="alert">
          <p>
            {t('loadFailed')}
            {loadError ? `: ${loadError}` : ''}
          </p>
        </div>
      </div>
    );
  }

  const labels = {
    levelBeginner: t('levelBeginner'),
    levelIntermediate: t('levelIntermediate'),
    levelAdvanced: t('levelAdvanced'),
  };

  return (
    <div className="page-wrap">
      <h1>{t('coursesTitle')}</h1>
      {courses.length === 0 ? (
        <p className="empty">{t('coursesEmpty')}</p>
      ) : (
        <ul>
          {courses.map((course) => (
            <li key={course.id}>
              <Link href={`/${locale}/learn/courses/${course.id}`}>
                {pickText(course.title, locale) || course.id}
              </Link>
              <span>{levelLabel(course.level, labels)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
