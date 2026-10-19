/**
 * LessonContent — server-rendered lesson article (Phase 8).
 *
 * Lesson content blocks are public: they render on the server for fast LCP
 * and zero-JS readability. Progress + quiz are client islands
 * (components/LessonPlayer.tsx). Shared with the dev-only /demo/lms preview.
 */
import Link from 'next/link';
import type { RefObject } from 'react';
import { pickText } from '@/lib/localize';
import type { LocalizedText } from '@/lib/types';
import type { LmsContentBlock, LmsLesson } from '@/lib/lms';

export function LessonArticleHead({
  lesson,
  courseId,
  courseTitle,
  locale,
  backToCourse,
}: {
  lesson: LmsLesson;
  courseId: string;
  courseTitle: LocalizedText;
  locale: string;
  backToCourse: string;
}) {
  return (
    <>
      <p className="lms-kicker">
        <Link className="lms-link" href={`/${locale}/learn/courses/${courseId}`}>
          {backToCourse}
        </Link>
        {' · '}
        {pickText(courseTitle, locale)}
      </p>
      <h1 className="page-title">{pickText(lesson.title, locale)}</h1>
    </>
  );
}

export function LessonContentView({
  lesson,
  locale,
  articleRef,
}: {
  lesson: LmsLesson;
  locale: string;
  articleRef?: RefObject<HTMLElement>;
}) {
  return (
    <article ref={articleRef} className="lms-blocks" aria-label={pickText(lesson.title, locale)}>
      {(lesson.body ?? []).map((b, i) => (
        <ContentBlock key={i} block={b} locale={locale} />
      ))}
    </article>
  );
}

function ContentBlock({ block, locale }: { block: LmsContentBlock; locale: string }) {
  switch (block.type) {
    case 'scholar_quote_ref':
      return (
        <blockquote className="lms-block-quote">
          <p>{pickText(block.text, locale)}</p>
          {block.scholar && <footer>— {pickText(block.scholar, locale)}</footer>}
        </blockquote>
      );
    case 'fiqh_topic_ref':
      return (
        <aside className="lms-block-callout">
          <p>
            <strong>{pickText(block.title, locale)}</strong>
          </p>
          {block.note && <p className="lms-muted">{block.note}</p>}
        </aside>
      );
    case 'quiz_ref':
      // The quiz renders in its own section below; the ref block is a marker.
      return null;
    case 'text':
    default:
      return <div className="lms-block-text">{pickText(block.text, locale)}</div>;
  }
}
