/**
 * HifzTasmiPanel — Tasmi practice methods (tasmi.cloud).
 *
 * Three methods, all self-assessed (the user's tap means "I did it",
 * never an ASR success): the 6446 method (6 read + 4 recite + 4 read
 * + 6 recite per ayah), the 3x3 method (groups of three ayahs, then
 * chained), and the eight-stage Tasmi Method. Every tap is saved
 * immediately, so an interrupted session resumes where it stopped.
 * No effectiveness claim is made about any method.
 */
import { useState } from 'react';
import { authJson } from '@/lib/auth-client';
import { surahAyahCount } from '@/lib/hifz-phase4';
import { HifzNumericInput } from './HifzNumericInput';

const HIFZ_API = '/api/v1/quran/hifz';

export interface TasmiSession {
  id: string;
  method: string;
  variant: string;
  start_surah: number;
  start_ayah: number;
  end_surah: number;
  end_ayah: number;
  state: Record<string, unknown>;
  current: Record<string, unknown>;
  self_assessed: boolean;
  reflection: string | null;
  status: string;
}

export interface HifzTasmiLabels {
  title: string;
  selfAssessedNote: string;
  method: string;
  methodTasmi8: string;
  method6446: string;
  method3x3: string;
  variant: string;
  variantStandard: string;
  variantGentle: string;
  variantRevision: string;
  surahStart: string;
  ayahStart: string;
  surahEnd: string;
  ayahEnd: string;
  start: string;
  loading: string;
  error: string;
  tap: string;
  nextStage: string;
  pause: string;
  resume: string;
  complete: string;
  rate: string;
  rateForgot: string;
  rateHard: string;
  rateGood: string;
  rateEasy: string;
  reflection: string;
  reflectionPlaceholder: string;
  saveReflection: string;
  currentStage: string;
  currentSet: string;
  done: string;
  noSession: string;
}

const SURAHS = Array.from({ length: 114 }, (_, i) => i + 1);

export function HifzTasmiPanel({ labels }: { labels: HifzTasmiLabels }) {
  const [session, setSession] = useState<TasmiSession | null>(null);
  const [method, setMethod] = useState('method_6446');
  const [variant, setVariant] = useState('standard');
  const [startSurah, setStartSurah] = useState(112);
  const [startAyah, setStartAyah] = useState(1);
  const [endSurah, setEndSurah] = useState(112);
  const [endAyah, setEndAyah] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflection, setReflection] = useState('');

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const s = await authJson<TasmiSession>(`${HIFZ_API}/tasmi/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          variant,
          start_surah: startSurah,
          start_ayah: startAyah,
          end_surah: endSurah,
          end_ayah: endAyah,
        }),
      });
      setSession(s);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!session) return;
    setBusy(true);
    try {
      const s = await authJson<TasmiSession>(
        `${HIFZ_API}/tasmi/sessions/${session.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        },
      );
      setSession(s);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  };

  const current = session?.current ?? {};
  const stageTitle = (current.stage_title as string | undefined) ?? '';
  const setKind = current.set_kind as string | undefined;
  const stepKind = current.step_kind as string | undefined;

  return (
    <section className="hifz-tasmi" aria-label={labels.title}>
      <h3>{labels.title}</h3>
      <p className="hifz-hint">{labels.selfAssessedNote}</p>
      {!session && (
        <div>
          <label>
            {labels.method}
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="tasmi8">{labels.methodTasmi8}</option>
              <option value="method_6446">{labels.method6446}</option>
              <option value="method_3x3">{labels.method3x3}</option>
            </select>
          </label>
          {method === 'tasmi8' && (
            <label>
              {labels.variant}
              <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                <option value="standard">{labels.variantStandard}</option>
                <option value="gentle">{labels.variantGentle}</option>
                <option value="revision">{labels.variantRevision}</option>
              </select>
            </label>
          )}
          <label>
            {labels.surahStart}
            <select value={startSurah} onChange={(e) => setStartSurah(Number(e.target.value))}>
              {SURAHS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.ayahStart}
            <HifzNumericInput
              value={startAyah}
              onChange={(v) => setStartAyah(v ?? 1)}
              ariaLabel={labels.ayahStart}
              min={1}
              max={surahAyahCount(startSurah) ?? undefined}
            />
          </label>
          <label>
            {labels.surahEnd}
            <select value={endSurah} onChange={(e) => setEndSurah(Number(e.target.value))}>
              {SURAHS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.ayahEnd}
            <HifzNumericInput
              value={endAyah}
              onChange={(v) => setEndAyah(v ?? 1)}
              ariaLabel={labels.ayahEnd}
              min={1}
              max={surahAyahCount(endSurah) ?? undefined}
            />
          </label>
          <button type="button" onClick={create} disabled={busy}>
            {busy ? labels.loading : labels.start}
          </button>
        </div>
      )}
      {session && (
        <div>
          <p>
            {session.method} — {session.start_surah}:{session.start_ayah} →{' '}
            {session.end_surah}:{session.end_ayah}
          </p>
          {current.done ? (
            <p>{labels.done}</p>
          ) : (
            <p>
              {session.method === 'tasmi8'
                ? `${labels.currentStage}: ${stageTitle} (${Number(current.stage_pos ?? 0) + 1}/${current.stage_total})`
                : `${labels.currentSet}: ${setKind ?? stepKind ?? ''} — ${current.count_in_set ?? current.count_in_step ?? 0}/${current.set_target ?? current.step_target ?? ''}`}
            </p>
          )}
          <div>
            {session.method !== 'tasmi8' && (
              <button type="button" onClick={() => act('tap')} disabled={busy || session.status !== 'active'}>
                {labels.tap}
              </button>
            )}
            {session.method === 'tasmi8' && (
              <button type="button" onClick={() => act('next_stage')} disabled={busy || session.status !== 'active'}>
                {labels.nextStage}
              </button>
            )}
            {session.status === 'active' && (
              <button type="button" onClick={() => act('pause')} disabled={busy}>
                {labels.pause}
              </button>
            )}
            {session.status === 'paused' && (
              <button type="button" onClick={() => act('resume')} disabled={busy}>
                {labels.resume}
              </button>
            )}
            <button type="button" onClick={() => act('complete')} disabled={busy}>
              {labels.complete}
            </button>
          </div>
          <div>
            <span>{labels.rate}: </span>
            {(['forgot', 'hard', 'good', 'easy'] as const).map((r) => (
              <button key={r} type="button" onClick={() => act('rate', { rating: r })} disabled={busy}>
                {r === 'forgot'
                  ? labels.rateForgot
                  : r === 'hard'
                    ? labels.rateHard
                    : r === 'good'
                      ? labels.rateGood
                      : labels.rateEasy}
              </button>
            ))}
          </div>
          <label>
            {labels.reflection}
            <textarea
              value={reflection}
              placeholder={labels.reflectionPlaceholder}
              onChange={(e) => setReflection(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => act('reflect', { reflection })}
            disabled={busy || reflection.trim() === ''}
          >
            {labels.saveReflection}
          </button>
          {session.reflection && <p>{session.reflection}</p>}
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
