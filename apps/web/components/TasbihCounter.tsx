'use client';

/**
 * TasbihCounter — the digital tasbih.
 *
 * Big tap target (keyboard-operable native <button>), dhikr presets,
 * target count with a progress ring, session finish persisted via
 * lib/tasbih.ts, daily totals. Voice counting via the Web Speech API is a
 * progressive enhancement: the tap UI works with or without it.
 */
import { useEffect, useRef, useState } from 'react';
import { useTasbihSession } from '@/lib/hooks/useTasbihSession';

export interface TasbihLabels {
  title: string;
  subtitle: string;
  tapHint: string;
  targetLabel: string;
  customTarget: string;
  finishSession: string;
  reset: string;
  undo: string;
  dailyTotals: string;
  sessionsCount: string;
  totalCount: string;
  targetReached: string;
  voiceStart: string;
  voiceStop: string;
  voiceUnsupported: string;
  voiceListening: string;
  signInToSync: string;
  todaySynced: string;
  presets: { key: string; text: string }[];
}

const TARGET_CHOICES = [33, 100, 500, 1000];

export function TasbihCounter({ labels }: { labels: TasbihLabels }) {
  const {
    state,
    selectDhikr,
    increment,
    decrement,
    reset,
    finishSession,
    setTarget,
  } = useTasbihSession(100);

  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceSupported] = useState(
    () =>
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
  );
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const lastTranscriptRef = useRef('');

  // Announce target completion to screen readers (once per session).
  const reached = state.reached;

  // Voice counting: each finalized utterance containing the dhikr counts +1.
  // Guarded: only constructed when the API exists; never breaks the tap UI.
  useEffect(() => {
    if (!voiceOn || !voiceSupported) return;
    const w = window as unknown as Record<string, unknown>;
    type RecogCtor = new () => SpeechRecognitionLike;
    const Ctor = (
      (w.SpeechRecognition as RecogCtor | undefined) ??
      (w.webkitSpeechRecognition as RecogCtor | undefined)
    );
    if (!Ctor) return;
    const recog: SpeechRecognitionLike = new Ctor();
    recog.lang = document.documentElement.lang === 'en' ? 'en-US' : 'ar-SA';
    recog.continuous = true;
    recog.interimResults = false;
    recog.onresult = (ev: SpeechResultEventLike) => {
      const last = ev.results[ev.results.length - 1];
      if (last?.isFinal) {
        const text = last[0]?.transcript?.trim() ?? '';
        if (text && text !== lastTranscriptRef.current) {
          lastTranscriptRef.current = text;
          increment();
        }
      }
    };
    recog.onend = () => {
      // Auto-restart while the toggle is on (recognition stops on silence).
      if (recogRef.current) {
        try {
          recog.start();
        } catch {
          /* already started */
        }
      }
    };
    try {
      recog.start();
      recogRef.current = recog;
    } catch {
      setVoiceOn(false);
    }
    return () => {
      recogRef.current = null;
      try {
        recog.stop();
      } catch {
        /* ignore */
      }
    };
  }, [voiceOn, voiceSupported, increment]);

  const ringPct = Math.round(state.progress * 100);
  const radius = 88;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="tasbih">
      <h1 className="page-title">{labels.title}</h1>
      <p className="page-sub">{labels.subtitle}</p>

      <div className="tasbih-presets" role="group" aria-label={labels.title}>
        {labels.presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`tasbih-preset${state.dhikrKey === p.key ? ' tasbih-preset-active' : ''}`}
            aria-pressed={state.dhikrKey === p.key}
            onClick={() => selectDhikr(p.key, p.text)}
            lang="ar"
            dir="rtl"
          >
            {p.text}
          </button>
        ))}
      </div>

      <p className="tasbih-current-dhikr" lang="ar" dir="rtl" aria-live="polite">
        {state.dhikrText || labels.presets[0]?.text}
      </p>

      <div className="tasbih-stage">
        <svg className="tasbih-ring" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r={radius} className="tasbih-ring-bg" />
          <circle
            cx="100"
            cy="100"
            r={radius}
            className="tasbih-ring-fg"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - state.progress)}
            transform="rotate(-90 100 100)"
          />
        </svg>
        <button
          type="button"
          className="tasbih-tap"
          onClick={increment}
          aria-label={`${labels.tapHint} — ${state.count}`}
        >
          <span className="tasbih-count" aria-live="polite">
            {state.count}
          </span>
          <span className="tasbih-tap-hint">{labels.tapHint}</span>
        </button>
      </div>

      {reached ? (
        <p className="tasbih-reached" role="status">
          {labels.targetReached}
        </p>
      ) : null}

      <div
        className="tasbih-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={state.target ?? 0}
        aria-valuenow={state.count}
        aria-label={labels.targetLabel}
      >
        <span>{ringPct}%</span>
      </div>

      <div className="tasbih-controls">
        <label className="tasbih-target">
          <span>{labels.targetLabel}</span>
          <span className="tasbih-target-choices" role="group">
            {TARGET_CHOICES.map((t) => (
              <button
                key={t}
                type="button"
                className={state.target === t ? 'tasbih-preset-active' : ''}
                aria-pressed={state.target === t}
                onClick={() => setTarget(t)}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              className={state.target === null ? 'tasbih-preset-active' : ''}
              aria-pressed={state.target === null}
              onClick={() => setTarget(null)}
              title={labels.customTarget}
            >
              ∞
            </button>
          </span>
        </label>

        <div className="tasbih-actions">
          <button type="button" onClick={() => void finishSession()} disabled={state.count === 0}>
            {labels.finishSession}
          </button>
          <button type="button" onClick={decrement} disabled={state.count === 0}>
            {labels.undo}
          </button>
          <button type="button" onClick={reset} disabled={state.count === 0}>
            {labels.reset}
          </button>
        </div>

        {voiceSupported ? (
          <button
            type="button"
            className={`tasbih-voice${voiceOn ? ' tasbih-voice-on' : ''}`}
            aria-pressed={voiceOn}
            onClick={() => setVoiceOn((v) => !v)}
          >
            {voiceOn ? labels.voiceStop : labels.voiceStart}
          </button>
        ) : (
          <p className="tasbih-voice-note">{labels.voiceUnsupported}</p>
        )}
        {voiceOn ? <p className="tasbih-voice-note" role="status">{labels.voiceListening}</p> : null}
      </div>

      <section className="tasbih-totals" aria-label={labels.dailyTotals}>
        <h2>{labels.dailyTotals}</h2>
        {state.todayRemote.length > 0 ? (
          <>
            <h3 className="tasbih-totals-sub">{labels.todaySynced}</h3>
            <ul>
              {state.todayRemote.map((d) => (
                <li key={d.dhikrText}>
                  <span lang="ar" dir="rtl">{d.dhikrText}</span>
                  <span>{d.total}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {state.totalsLoading ? (
          <p>…</p>
        ) : state.totals.length === 0 && state.todayRemote.length === 0 ? (
          <p className="empty-state">{labels.signInToSync}</p>
        ) : (
          <ul>
            {state.totals.map((d) => (
              <li key={d.date}>
                <span>{d.date}</span>
                <span>
                  {labels.totalCount}: {d.total} · {labels.sessionsCount}: {d.sessions}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Minimal structural types for the Web Speech API (progressive enhancement). */
interface SpeechResultEventLike {
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
