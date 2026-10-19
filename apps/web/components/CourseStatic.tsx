/**
 * CourseStatic — server-rendered course header + lessons list (Phase 8).
 *
 * Public course detail needs no JS: this renders on the server. Only the
 * cohort enrollment island is client-side (components/CourseView.tsx).
 */
import Link from 'next/link';
import {
  lessonHasQuiz,
  levelLabel,
  positionPercent,
  type LevelLabels,
  type LmsCourseDetail,
  type LmsLesson,
} from '@/lib/lms';
import { pickText } from '@/lib/localize';

export interface CourseStaticLabels {
  lessonsTitle: string;
  completedBadge: string;
  inProgressBadge: string;
  notStartedBadge: string;
  quizBadge: string;
  openLesson: string;
  progressLabel: string; // "{percent}" template
  lessonsCountLabel: string; // "{done}/{total}" template
  certificateEarned: string;
  levelLabels: LevelLabels;
}

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

function statusBadge(status: LmsLesson['status'], labels: CourseStaticLabels): string {
  if (status === 'completed') return labels.completedBadge;
  if (status === 'in_progress') return labels.inProgressBadge;
  return labels.notStartedBadge;
}

export function CourseStatic({
  detail,
  locale,
  labels,
}: {
  detail: LmsCourseDetail;
  locale: string;
  labels: CourseStaticLabels;
}) {
  const { course, lessons } = detail;
  const pct = Math.max(0, Math.min(100, Math.round(detail.progress_pct)));

  return (
    <div className="lms-course">
      <p className="lms-kicker">{levelLabel(course.level, labels.levelLabels)}</p>
      <h1 className="page-title">{pickText(course.title, locale)}</h1>
      {course.description && <p className="page-sub">{pickText(course.description, locale)}</p>}

      <div className="lms-course-meta">
        <div
          className="lms-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={fill(labels.progressLabel, { percent: pct })}
        >
          <span style={{ inlineSize: `${pct}%` }} />
        </div>
        <p className="lms-muted">
          {fill(labels.lessonsCountLabel, { done: detail.completed_lessons, total: detail.total_lessons })}
          {' · '}
          {fill(labels.progressLabel, { percent: pct })}
        </p>
        {detail.has_certificate && <p className="lms-badge ok">{labels.certificateEarned}</p>}
      </div>

      <section className="lms-section" aria-labelledby="lms-lessons-h">
        <h2 id="lms-lessons-h">{labels.lessonsTitle}</h2>
        <ol className="lms-lessons">
          {lessons.map((lesson) => (
            <li key={lesson.id} className={lesson.status === 'completed' ? 'done' : ''}>
              <Link
                className="lms-lesson-row"
                href={`/${locale}/learn/lessons/${lesson.id}?course=${course.id}`}
              >
                <span className="lms-lesson-order">{lesson.sort_order + 1}</span>
                <span className="lms-lesson-main">
                  <span className="lms-lesson-title">{pickText(lesson.title, locale)}</span>
                  <span className="lms-lesson-meta">
                    <span className="lms-badge">{statusBadge(lesson.status, labels)}</span>
                    {lessonHasQuiz(lesson) && <span className="lms-badge">{labels.quizBadge}</span>}
                    {lesson.status === 'in_progress' && (
                      <span className="lms-mini-progress">
                        <span style={{ inlineSize: `${positionPercent(lesson)}%` }} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="lms-lesson-cta">{labels.openLesson}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
