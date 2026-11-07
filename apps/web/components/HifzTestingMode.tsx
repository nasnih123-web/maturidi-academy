/**
 * HifzTestingMode — Tarteel-style Testing Mode (flashcards).
 *
 * The card shows only the first words of the passage; the user recites
 * the rest from memory. After answering, the card turns green (correct)
 * or red (mistake); Peek counts toward the test score; a false-positive
 * mistake can be removed — the raw event stays, the score is recomputed.
 * A test is a Temporary Session: it is labelled as such and never
 * joins the practice history.
 */
import { useEffect, useRef, useState } from 'react';
import { authFetch, authJson } from '@/lib/auth-client';
import { HifzNumericInput } from './HifzNumericInput';
import { HifzMicDeniedError, startWavRecording } from '@/lib/hifz-record-wav';

const HIFZ_API = '/api/v1/quran/hifz';

export interface TestQuestion {
  id: string;
  position: number;
  surah: number;
  ayah_start: number;
  ayah_end: number;
  prompt: string | null;
  status: string;
  score: number | null;
  counts: Record<string, number>;
  peek_count: number;
  raw_events: { status: string; expected: string; heard: string | null; mistake_type: string | null; removed: boolean; word_index: number; ayah: number }[];
  answered_at: string | null;
}

export interface HifzTest {
  id: string;
  surah_start: number;
  surah_end: number;
  question_count: number;
  time_limit_minutes: number | null;
  question_length: string;
  stop_rule: string;
  status: string;
  started_at: string;
  ends_at: string | null;
  temporary_session: boolean;
  questions: TestQuestion[];
  total_score: { score: number; answered: number; total: number } | null;
}

export interface HifzTestingLabels {
  title: string;
  temporaryNote: string;
  surahStart: string;
  surahEnd: string;
  questionCount: string;
  timeLimit: string;
  timeUnlimited: string;
  length: string;
  lengthShort: string;
  lengthMedium: string;
  lengthLong: string;
  stopRule: string;
  stopAyahEnd: string;
  stopLineEnd: string;
  start: string;
  loading: string;
  error: string;
  micDenied: string;
  questionOf: string;
  prompt: string;
  recordAnswer: string;
  stopRecord: string;
  grading: string;
  skip: string;
  peek: string;
  peekCount: string;
  score: string;
  removeFalsePositive: string;
  removed: string;
  complete: string;
  totalScore: string;
  next: string;
  answered: string;
  skipped: string;
}

const SURAHS = Array.from({ length: 114 }, (_, i) => i + 1);

export function HifzTestingMode({ labels }: { labels: HifzTestingLabels }) {
  const [test, setTest] = useState<HifzTest | null>(null);
  const [surahStart, setSurahStart] = useState(112);
  const [surahEnd, setSurahEnd] = useState(114);
  const [count, setCount] = useState(10);
  const [timeLimit, setTimeLimit] = useState('');
  const [length, setLength] = useState('medium');
  const [stopRule, setStopRule] = useState('ayah_end');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);

  const load = async (id: string) => {
    const t = await authJson<HifzTest>(`${HIFZ_API}/tests/${id}`);
    setTest(t);
    return t;
  };

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const t = await authJson<HifzTest>(`${HIFZ_API}/tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surah_start: surahStart,
          surah_end: surahEnd,
          question_count: count,
          time_limit_minutes: timeLimit === '' ? null : Number(timeLimit),
          question_length: length,
          stop_rule: stopRule,
        }),
      });
      const full = await load(t.id);
      setPos(0);
      void full;
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  };

  const current: TestQuestion | undefined = test?.questions[pos];

  useEffect(() => {
    // Keep the position on a pending question when the test reloads.
    if (test) {
      const firstPending = test.questions.findIndex((q) => q.status === 'pending');
      if (firstPending >= 0) setPos(firstPending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test?.id]);

  const answer = async () => {
    if (!test || !current) return;
    setError(null);
    try {
      const rec = await startWavRecording(120);
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      setError(e instanceof HifzMicDeniedError ? labels.micDenied : labels.error);
    }
  };

  const stopAnswer = async () => {
    if (!test || !current || !recorderRef.current) return;
    setRecording(false);
    setBusy(true);
    try {
      const wav = await recorderRef.current.stop();
      recorderRef.current = null;
      const form = new FormData();
      form.append('audio', wav, 'rec.wav');
      await authFetch(
        `${HIFZ_API}/tests/${test.id}/questions/${current.id}/answer`,
        { method: 'POST', body: form },
      );
      await load(test.id);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!test || !current) return;
    await authFetch(`${HIFZ_API}/tests/${test.id}/questions/${current.id}/skip`, {
      method: 'POST',
    });
    const t = await load(test.id);
    setPos(Math.min(pos + 1, t.questions.length - 1));
  };

  const peek = async () => {
    if (!test || !current) return;
    await authJson(`${HIFZ_API}/tests/${test.id}/questions/${current.id}/peek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surah: current.surah,
        ayah: current.ayah_start,
        word_index: 0,
      }),
    });
    await load(test.id);
  };

  const removeEvent = async (index: number) => {
    if (!test || !current) return;
    await authJson(
      `${HIFZ_API}/tests/${test.id}/questions/${current.id}/events/${index}/remove`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removed: true }),
      },
    );
    await load(test.id);
  };

  const complete = async () => {
    if (!test) return;
    await authJson(`${HIFZ_API}/tests/${test.id}/complete`, { method: 'POST' });
    await load(test.id);
  };

  if (!test) {
    return (
      <section className="hifz-testing" aria-label={labels.title}>
        <h3>{labels.title}</h3>
        <p className="hifz-hint">{labels.temporaryNote}</p>
        <div>
          <label>
            {labels.surahStart}
            <select value={surahStart} onChange={(e) => setSurahStart(Number(e.target.value))}>
              {SURAHS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.surahEnd}
            <select value={surahEnd} onChange={(e) => setSurahEnd(Number(e.target.value))}>
              {SURAHS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.questionCount}
            <HifzNumericInput
              value={count}
              onChange={(v) => setCount(v ?? 1)}
              ariaLabel={labels.questionCount}
              min={1}
              max={99}
            />
          </label>
          <label>
            {labels.timeLimit}
            <select value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)}>
              <option value="">{labels.timeUnlimited}</option>
              {[5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={String(m)}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.length}
            <select value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="short">{labels.lengthShort}</option>
              <option value="medium">{labels.lengthMedium}</option>
              <option value="long">{labels.lengthLong}</option>
            </select>
          </label>
          <label>
            {labels.stopRule}
            <select value={stopRule} onChange={(e) => setStopRule(e.target.value)}>
              <option value="ayah_end">{labels.stopAyahEnd}</option>
              <option value="line_end">{labels.stopLineEnd}</option>
            </select>
          </label>
        </div>
        <button type="button" onClick={create} disabled={busy}>
          {busy ? labels.loading : labels.start}
        </button>
        {error && (
          <p className="hifz-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="hifz-testing" aria-label={labels.title}>
      <h3>{labels.title}</h3>
      <p className="hifz-hint">{labels.temporaryNote}</p>
      {test.total_score && (
        <p>
          {labels.totalScore}: {Math.round(test.total_score.score * 100)}% (
          {test.total_score.answered}/{test.total_score.total})
        </p>
      )}
      {current && (
        <div
          className={`hifz-test-card${current.status === 'answered' ? (current.score !== null && current.score >= 0.8 ? ' is-correct' : ' is-wrong') : ''}`}
        >
          <p>
            {labels.questionOf} {pos + 1} / {test.questions.length} — {current.surah}:
            {current.ayah_start}
            {current.ayah_end !== current.ayah_start ? `–${current.ayah_end}` : ''} —{' '}
            {current.status === 'answered'
              ? labels.answered
              : current.status === 'skipped'
                ? labels.skipped
                : ''}
          </p>
          <p className="hifz-test-prompt" dir="rtl" lang="ar">
            {labels.prompt}: {current.prompt ?? '…'}
          </p>
          {current.status === 'answered' && (
            <div>
              <p>
                {labels.score}:{' '}
                {current.score === null ? '—' : `${Math.round(current.score * 100)}%`} ·{' '}
                {labels.peekCount}: {current.peek_count}
              </p>
              <ul>
                {current.raw_events.map((e, i) => (
                  <li key={i}>
                    <span dir="rtl" lang="ar">
                      {e.expected}
                    </span>{' '}
                    — {e.status}
                    {e.removed ? ` (${labels.removed})` : ''}
                    {!e.removed && e.status === 'wrong' && (
                      <button type="button" onClick={() => removeEvent(i)}>
                        {labels.removeFalsePositive}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {current.status === 'pending' && (
            <div>
              {!recording && (
                <button type="button" onClick={answer} disabled={busy}>
                  {labels.recordAnswer}
                </button>
              )}
              {recording && (
                <>
                  <p className="hifz-hint">{labels.grading}</p>
                  <button type="button" onClick={stopAnswer}>
                    {labels.stopRecord}
                  </button>
                </>
              )}
              <button type="button" onClick={peek} disabled={busy}>
                {labels.peek}
              </button>
              <button type="button" onClick={skip} disabled={busy}>
                {labels.skip}
              </button>
            </div>
          )}
          <div>
            <button type="button" onClick={() => setPos(Math.max(0, pos - 1))} disabled={pos === 0}>
              ←
            </button>
            <button
              type="button"
              onClick={() => setPos(Math.min(test.questions.length - 1, pos + 1))}
              disabled={pos >= test.questions.length - 1}
            >
              {labels.next} →
            </button>
            {test.status === 'in_progress' && (
              <button type="button" onClick={complete} disabled={busy}>
                {labels.complete}
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="hifz-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
