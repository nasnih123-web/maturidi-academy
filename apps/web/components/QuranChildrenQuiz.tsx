'use client';

/**
 * QuranChildrenQuiz — MCQ + matching test for one surah (mockup screen 4).
 *
 * Questions come from GET /surahs/{surah}/quiz (auto MCQs generated
 * server-side from the canonical text + CRM questions). Each type is
 * submitted separately; signed-in users get server scoring + stars,
 * guests get the same scoring locally (the payload carries
 * correct_index / pairs) with the sign-in hint — the result is shown
 * either way, never silently dropped.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchChildrenQuiz,
  formatNum,
  isAuthError401,
  isMcqPayload,
  pickLocalizedText,
  scoreMatchingLocal,
  scoreMcqLocal,
  seededShuffle,
  submitChildrenQuiz,
  type ChildrenLabels,
  type ChildrenMatchingPayload,
  type ChildrenMcqPayload,
  type ChildrenQuestion,
  type ChildrenQuizResult,
} from '@/lib/quran-children';

export function QuranChildrenQuiz({
  labels,
  locale,
  surah,
  surahNameAr,
}: {
  labels: ChildrenLabels;
  locale: string;
  surah: number;
  surahNameAr: string;
}): React.ReactElement {
  const [questions, setQuestions] = useState<ChildrenQuestion[] | null>(null);
  const [error, setError] = useState(false);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, number>>({});
  const [matchPairs, setMatchPairs] = useState<
    Record<string, Record<string, string>>
  >({});
  const [matchSelected, setMatchSelected] = useState<Record<string, string | null>>({});
  const [mcqResult, setMcqResult] = useState<ChildrenQuizResult | null>(null);
  const [matchResult, setMatchResult] = useState<ChildrenQuizResult | null>(null);
  const [guestScored, setGuestScored] = useState(false);
  const [submitting, setSubmitting] = useState<'mcq' | 'matching' | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setQuestions(await fetchChildrenQuiz(surah));
    } catch {
      setError(true);
    }
  }, [surah]);

  useEffect(() => {
    void load();
  }, [load]);

  const mcqs = useMemo(
    () => (questions ?? []).filter((q) => q.question_type === 'mcq'),
    [questions],
  );
  const matchings = useMemo(
    () => (questions ?? []).filter((q) => q.question_type === 'matching'),
    [questions],
  );

  const shuffledMeanings = useMemo(() => {
    const out: Record<string, ChildrenMatchingPayload['pairs']> = {};
    for (const q of matchings) {
      const pairs = (q.payload as ChildrenMatchingPayload).pairs ?? [];
      out[q.id] = seededShuffle(pairs, surah * 31 + q.id.length);
    }
    return out;
  }, [matchings, surah]);

  const submitMcq = useCallback(async () => {
    if (mcqs.length === 0 || submitting) return;
    setSubmitting('mcq');
    try {
      setMcqResult(await submitChildrenQuiz(surah, 'mcq', mcqAnswers));
    } catch (err) {
      if (isAuthError401(err)) {
        setGuestScored(true);
        setMcqResult(scoreMcqLocal(questions ?? [], mcqAnswers));
      }
    } finally {
      setSubmitting(null);
    }
  }, [mcqs.length, submitting, surah, mcqAnswers, questions]);

  const submitMatching = useCallback(async () => {
    if (matchings.length === 0 || submitting) return;
    setSubmitting('matching');
    try {
      setMatchResult(
        await submitChildrenQuiz(surah, 'matching', matchPairs),
      );
    } catch (err) {
      if (isAuthError401(err)) {
        setGuestScored(true);
        setMatchResult(scoreMatchingLocal(questions ?? [], matchPairs));
      }
    } finally {
      setSubmitting(null);
    }
  }, [matchings.length, submitting, surah, matchPairs, questions]);

  const reset = useCallback(() => {
    setMcqAnswers({});
    setMatchPairs({});
    setMatchSelected({});
    setMcqResult(null);
    setMatchResult(null);
    setGuestScored(false);
  }, []);

  if (error) {
    return (
      <section className="quran-children-quiz">
        <p role="alert">{labels.error}</p>
        <button type="button" className="quran-children-btn" onClick={() => void load()}>
          {labels.retry}
        </button>
      </section>
    );
  }
  if (questions === null) {
    return (
      <section className="quran-children-quiz" aria-busy="true">
        <p>{labels.audioLoading}</p>
      </section>
    );
  }
  if (questions.length === 0) {
    return (
      <section className="quran-children-quiz">
        <h2>{labels.quizTitle}</h2>
        <p>{labels.quizEmpty}</p>
      </section>
    );
  }

  const mcqDone = mcqResult !== null;
  const matchDone = matchResult !== null;

  return (
    <section className="quran-children-quiz">
      <header>
        <h2>
          {labels.quizTitle} — {surahNameAr}
        </h2>
      </header>

      {guestScored && <p className="quran-children-hint">{labels.quizSignInHint}</p>}

      {/* Multiple choice */}
      {mcqs.length > 0 && (
        <>
          <h3>{labels.quizMcqTitle}</h3>
          <ol className="quran-children-mcq">
            {mcqs.map((q, qi) => {
              const p = q.payload as ChildrenMcqPayload;
              const chosen = mcqAnswers[q.id];
              return (
                <li key={q.id} className="quran-children-mcq-q">
                  <p className="quran-children-mcq-text">
                    {formatNum(qi + 1, locale)}. {pickLocalizedText(p.question, locale)}
                  </p>
                  <div
                    className="quran-children-options"
                    role={mcqDone ? undefined : 'radiogroup'}
                    aria-label={pickLocalizedText(p.question, locale)}
                  >
                    {p.options.map((opt, oi) => {
                      const isCorrect = mcqDone && oi === p.correct_index;
                      const isChosenWrong =
                        mcqDone && chosen === oi && oi !== p.correct_index;
                      return (
                        <button
                          key={oi}
                          type="button"
                          disabled={mcqDone}
                          aria-pressed={chosen === oi}
                          className={[
                            'quran-children-option',
                            chosen === oi ? 'is-chosen' : '',
                            isCorrect ? 'is-correct' : '',
                            isChosenWrong ? 'is-wrong' : '',
                          ].join(' ')}
                          onClick={() =>
                            setMcqAnswers((a) => ({ ...a, [q.id]: oi }))
                          }
                        >
                          {pickLocalizedText(opt, locale)}
                        </button>
                      );
                    })}
                  </div>
                  {mcqDone && p.explanation && (
                    <p className="quran-children-explain">
                      {pickLocalizedText(p.explanation, locale)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {!mcqDone ? (
            <button
              type="button"
              className="quran-children-btn-primary"
              disabled={
                mcqs.some((q) => mcqAnswers[q.id] === undefined) ||
                submitting === 'mcq'
              }
              onClick={() => void submitMcq()}
            >
              {labels.quizSubmit}
            </button>
          ) : (
            <QuizResult
              labels={labels}
              locale={locale}
              result={mcqResult}
              onRetry={reset}
            />
          )}
        </>
      )}

      {/* Matching */}
      <h3>{labels.quizMatchingTitle}</h3>
      {matchings.length === 0 ? (
        <p>{labels.quizMatchingEmpty}</p>
      ) : (
        <>
          {matchings.map((q) => {
            const pairs = (q.payload as ChildrenMatchingPayload).pairs ?? [];
            const chosen = matchPairs[q.id] ?? {};
            const selected = matchSelected[q.id] ?? null;
            const allPaired =
              pairs.length > 0 &&
              pairs.every((pair) => chosen[pair.word] !== undefined);
            return (
              <div key={q.id} className="quran-children-matching">
                <p className="quran-children-hint">{labels.quizPickWord}</p>
                <div className="quran-children-match-cols">
                  <div
                    className="quran-children-match-col"
                    aria-label={labels.quizMatchingTitle}
                  >
                    {pairs.map((pair) => {
                      const paired = chosen[pair.word] !== undefined;
                      const right =
                        matchDone &&
                        chosen[pair.word] ===
                          pickLocalizedText(pair.meaning, 'fa');
                      return (
                        <button
                          key={pair.word}
                          type="button"
                          disabled={matchDone}
                          aria-pressed={selected === pair.word}
                          className={[
                            'quran-children-match-word',
                            selected === pair.word ? 'is-selected' : '',
                            paired ? 'is-paired' : '',
                            matchDone ? (right ? 'is-correct' : 'is-wrong') : '',
                          ].join(' ')}
                          onClick={() => {
                            if (paired) {
                              setMatchPairs((m) => {
                                const next = { ...(m[q.id] ?? {}) };
                                delete next[pair.word];
                                return { ...m, [q.id]: next };
                              });
                              return;
                            }
                            setMatchSelected((s) => ({
                              ...s,
                              [q.id]: pair.word,
                            }));
                          }}
                        >
                          {pair.word}
                        </button>
                      );
                    })}
                  </div>
                  <div className="quran-children-match-col">
                    {(shuffledMeanings[q.id] ?? []).map((pair) => {
                      const meaningFa = pickLocalizedText(pair.meaning, 'fa');
                      const usedBy = Object.entries(chosen).find(
                        ([, v]) => v === meaningFa,
                      )?.[0];
                      return (
                        <button
                          key={meaningFa}
                          type="button"
                          disabled={matchDone || usedBy !== undefined}
                          className={[
                            'quran-children-match-meaning',
                            usedBy !== undefined ? 'is-paired' : '',
                          ].join(' ')}
                          onClick={() => {
                            if (!selected) return;
                            setMatchPairs((m) => ({
                              ...m,
                              [q.id]: {
                                ...(m[q.id] ?? {}),
                                [selected]: meaningFa,
                              },
                            }));
                            setMatchSelected((s) => ({ ...s, [q.id]: null }));
                          }}
                        >
                          {pickLocalizedText(pair.meaning, locale)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {allPaired && <p className="quran-children-hint">{labels.quizAllPaired}</p>}
              </div>
            );
          })}
          {!matchDone ? (
            <button
              type="button"
              className="quran-children-btn-primary"
              disabled={
                !matchings.every((q) => {
                  const pairs = (q.payload as ChildrenMatchingPayload).pairs ?? [];
                  const chosen = matchPairs[q.id] ?? {};
                  return pairs.every((pair) => chosen[pair.word] !== undefined);
                }) || submitting === 'matching'
              }
              onClick={() => void submitMatching()}
            >
              {labels.quizSubmit}
            </button>
          ) : (
            <QuizResult
              labels={labels}
              locale={locale}
              result={matchResult}
              onRetry={reset}
            />
          )}
        </>
      )}
    </section>
  );
}

function QuizResult({
  labels,
  locale,
  result,
  onRetry,
}: {
  labels: ChildrenLabels;
  locale: string;
  result: ChildrenQuizResult;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="quran-children-result" role="status">
      <p>
        {labels.quizResult}:{' '}
        {labels.quizCorrect
          .replace('%correct%', formatNum(result.correct_count, locale))
          .replace('%total%', formatNum(result.total, locale))}
      </p>
      {result.stars > 0 && (
        <p className="quran-children-result-stars">
          <span className="quran-children-stars" aria-hidden="true">
            {'★'.repeat(result.stars)}
            {'☆'.repeat(3 - result.stars)}
          </span>{' '}
          {labels.quizStarsEarned.replace('%n%', formatNum(result.stars, locale))}
        </p>
      )}
      <button type="button" className="quran-children-btn" onClick={onRetry}>
        {labels.quizRetry}
      </button>
    </div>
  );
}
