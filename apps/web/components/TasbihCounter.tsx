'use client';

/**
 * TasbihCounter — the digital tasbih (Design 4).
 *
 * Layout: a skyline banner with the title, tagline and today's summary;
 * below it a three-column grid — presets/target/verse rail, the center
 * stage (current-dhikr pill over a framed photograph of wooden prayer
 * beads; the whole frame is the tap button and the count sits in the
 * beads' empty center), and a voice/stats rail. On mobile the grid
 * flattens into a single column that fits one screen without scrolling.
 *
 * Voice counting (Web Speech API, progressive enhancement): interim
 * results are matched live against the current dhikr with
 * countDhikrOccurrences, so several repetitions inside one utterance
 * each count. The tap UI works with or without it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTasbihSession } from '@/lib/hooks/useTasbihSession';
import { countDhikrOccurrences } from '@/lib/tasbih';

export interface TasbihLabels {
  title: string;
  subtitle: string;
  tagline: string;
  tapHint: string;
  targetLabel: string;
  customTarget: string;
  finishSession: string;
  reset: string;
  undo: string;
  dailyTotals: string;
  sessionsCount: string;
  totalCount: string;
  timesLabel: string;
  targetReached: string;
  roundLabel: string;
  ofCount: string;
  voiceStart: string;
  voiceStop: string;
  voiceUnsupported: string;
  voiceListening: string;
  voiceHeard: string;
  signInToSync: string;
  todaySynced: string;
  verse: string;
  verseCaption: string;
  presets: { key: string; text: string }[];
}

const TARGET_CHOICES = [33, 100, 500, 1000];
/** One full circuit of the beads = one round. */
const BEADS_PER_ROUND = 33;
/** Waveform bars in the voice panel (purely decorative). */
const WAVE_BARS = 18;

export function TasbihCounter({ labels }: { labels: TasbihLabels }) {
  const {
    state,
    selectDhikr,
    increment,
    incrementBy,
    decrement,
    reset,
    finishSession,
    setTarget,
  } = useTasbihSession(100);

  // Locale-aware digits (fa-IR → Persian digits, en stays Latin). The
  // locale is read after mount so SSR and first paint agree.
  const [numLocale, setNumLocale] = useState<string | undefined>(undefined);
  useEffect(() => {
    setNumLocale(document.documentElement.lang || undefined);
  }, []);
  const fmt = useCallback(
    (n: number): string => {
      try {
        return new Intl.NumberFormat(numLocale).format(n);
      } catch {
        return String(n);
      }
    },
    [numLocale],
  );
  const fmtPct = useCallback(
    (fraction: number): string => {
      try {
        return new Intl.NumberFormat(numLocale, {
          style: 'percent',
          maximumFractionDigits: 0,
        }).format(fraction);
      } catch {
        return `${Math.round(fraction * 100)}%`;
      }
    },
    [numLocale],
  );

  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceSupported] = useState(
    () =>
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
  );
  const [lastHeard, setLastHeard] = useState<{ text: string; added: number } | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  /** Occurrences already counted per recognition result index. */
  const countedRef = useRef<Map<number, number>>(new Map());

  // Announce target completion to screen readers (once per session).
  const reached = state.reached;

  // Voice counting: every result (interim and final) is matched against
  // the current dhikr; only the newly heard occurrences are added, so a
  // growing interim transcript never double-counts. Guarded: only
  // constructed when the API exists; never breaks the tap UI.
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
    recog.interimResults = true;
    countedRef.current = new Map();
    const dhikrText = state.dhikrText || labels.presets[0]?.text || '';
    let dead = false;
    recog.onresult = (ev: SpeechResultEventLike) => {
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        const occ = countDhikrOccurrences(transcript, dhikrText);
        const prev = countedRef.current.get(i) ?? 0;
        const delta = occ - prev;
        if (delta > 0) {
          countedRef.current.set(i, occ);
          incrementBy(delta);
          setLastHeard({ text: transcript, added: delta });
        } else if (result.isFinal && delta === 0 && occ === 0) {
          // Nothing matched — still show what was heard.
          setLastHeard({ text: transcript, added: 0 });
        }
      }
    };
    recog.onerror = (ev: SpeechErrorEventLike) => {
      // Permission failures are terminal; anything else restarts via onend.
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        dead = true;
        setVoiceOn(false);
      }
    };
    recog.onend = () => {
      // Auto-restart while the toggle is on (recognition stops on silence).
      if (!dead && recogRef.current === recog) {
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
      dead = true;
      recogRef.current = null;
      try {
        recog.stop();
      } catch {
        /* ignore */
      }
    };
    // Restarting on dhikr change gives counting a fresh result map.
  }, [voiceOn, voiceSupported, incrementBy, state.dhikrKey, state.dhikrText, labels.presets]);

  const round = Math.floor(state.count / BEADS_PER_ROUND) + 1;

  // Today chip: server totals win when present; the session count only
  // exists in the local daily totals (finished sessions are always
  // recorded locally too).
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const localToday = state.totals.find((d) => d.date === todayKey);
  const todayTotal =
    state.todayRemote.length > 0
      ? state.todayRemote.reduce((sum, t) => sum + t.total, 0)
      : (localToday?.total ?? 0);
  const todaySessions = localToday?.sessions ?? 0;

  return (
    <div className="tasbih">
      <div className="tasbih-banner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="tasbih-banner-img"
          src="/tasbih-skyline.webp"
          alt=""
          width={2736}
          height={912}
        />
        <div className="tasbih-banner-txt">
          <h1 className="tasbih-banner-title">{labels.title}</h1>
          <p className="tasbih-banner-sub">
            {labels.tagline}
            {todayTotal > 0 ? (
              <>
                {' · '}
                <b>{fmt(todayTotal)}</b> {labels.totalCount} · <b>{fmt(todaySessions)}</b>{' '}
                {labels.sessionsCount}
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="tasbih-grid">
        <div className="tasbih-rail tasbih-rail-start">
          <section className="tasbih-panel tasbih-panel-presets">
            <div className="tasbih-presets" role="group" aria-label={labels.title}>
              {labels.presets.map((p) => {
                const today = state.todayRemote.find((t) => t.dhikrText === p.text);
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`tasbih-preset${state.dhikrKey === p.key ? ' tasbih-preset-active' : ''}`}
                    aria-pressed={state.dhikrKey === p.key}
                    onClick={() => selectDhikr(p.key, p.text)}
                  >
                    <span lang="ar" dir="rtl">
                      {p.text}
                    </span>
                    {today ? <span className="tasbih-preset-cnt">{fmt(today.total)}</span> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="tasbih-panel tasbih-panel-target">
            <h2>{labels.targetLabel}</h2>
            <div className="tasbih-target-choices" role="group" aria-label={labels.targetLabel}>
              {TARGET_CHOICES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tasbih-tchip${state.target === t ? ' tasbih-tchip-active' : ''}`}
                  aria-pressed={state.target === t}
                  onClick={() => setTarget(t)}
                >
                  {fmt(t)}
                </button>
              ))}
              <button
                type="button"
                className={`tasbih-tchip${state.target === null ? ' tasbih-tchip-active' : ''}`}
                aria-pressed={state.target === null}
                onClick={() => setTarget(null)}
                title={labels.customTarget}
              >
                ∞
              </button>
            </div>
          </section>

          <section className="tasbih-panel tasbih-verse">
            <p className="tasbih-verse-text" lang="ar" dir="rtl">
              «{labels.verse}»
            </p>
            <p className="tasbih-verse-caption">{labels.verseCaption}</p>
          </section>
        </div>

        <div className="tasbih-center">
          <p className="tasbih-dhikr-banner" lang="ar" dir="rtl" aria-live="polite">
            {state.dhikrText || labels.presets[0]?.text}
          </p>

          <div className="tasbih-stage">
            <button
              type="button"
              className="tasbih-frame tasbih-tap"
              onClick={increment}
              aria-label={`${labels.tapHint} — ${fmt(state.count)}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="tasbih-beads-img"
                src="/tasbih-beads.webp"
                alt=""
                width={1600}
                height={1600}
              />
              <span className="tasbih-count-core">
                <span className="tasbih-count" aria-live="polite">
                  {fmt(state.count)}
                </span>
                <span className="tasbih-times">{labels.timesLabel}</span>
                <span className="tasbih-round-line">
                  {labels.roundLabel} {fmt(round)}
                  {state.target ? (
                    <>
                      {' · '}
                      {fmt(state.count)} {labels.ofCount} {fmt(state.target)}
                    </>
                  ) : null}
                </span>
              </span>
              <span className="tasbih-frame-badge">{labels.tapHint}</span>
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
            <span>{fmtPct(state.progress)}</span>
          </div>

          <div className="tasbih-actions">
            <button
              type="button"
              className="tasbih-btn-primary"
              onClick={() => void finishSession()}
              disabled={state.count === 0}
            >
              {labels.finishSession}
            </button>
            <button type="button" onClick={decrement} disabled={state.count === 0}>
              {labels.undo}
            </button>
            <button type="button" onClick={reset} disabled={state.count === 0}>
              {labels.reset}
            </button>
          </div>
        </div>

        <div className="tasbih-rail tasbih-rail-end">
          <section className="tasbih-panel tasbih-voice-panel">
            {voiceSupported ? (
              <>
                <div className="tasbih-voice-row">
                  <span className={`tasbih-mic${voiceOn ? ' tasbih-mic-on' : ''}`} aria-hidden>
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <path d="M12 19v3" />
                    </svg>
                  </span>
                  <div className="tasbih-voice-text">
                    {voiceOn ? (
                      <p className="tasbih-voice-status" role="status">
                        {labels.voiceListening}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={`tasbih-voice${voiceOn ? ' tasbih-voice-on' : ''}`}
                    aria-pressed={voiceOn}
                    onClick={() => setVoiceOn((v) => !v)}
                  >
                    {voiceOn ? labels.voiceStop : labels.voiceStart}
                  </button>
                </div>
                {voiceOn ? (
                  <div className="tasbih-wave tasbih-wave-on" aria-hidden>
                    {Array.from({ length: WAVE_BARS }).map((_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                ) : null}
                {lastHeard ? (
                  <p className="tasbih-heard">
                    <span>
                      {labels.voiceHeard}: «{lastHeard.text}»
                    </span>
                    {lastHeard.added > 0 ? (
                      <b className="tasbih-heard-added">✓ +{fmt(lastHeard.added)}</b>
                    ) : (
                      <b className="tasbih-heard-none">+{fmt(0)}</b>
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="tasbih-voice-note">{labels.voiceUnsupported}</p>
            )}
          </section>

          <section className="tasbih-panel tasbih-totals" aria-label={labels.dailyTotals}>
            <h2>{labels.dailyTotals}</h2>
            {state.todayRemote.length > 0 ? (
              <>
                <h3 className="tasbih-totals-sub">{labels.todaySynced}</h3>
                <ul>
                  {state.todayRemote.map((d) => (
                    <li key={d.dhikrText}>
                      <span lang="ar" dir="rtl">
                        {d.dhikrText}
                      </span>
                      <span>{fmt(d.total)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : state.totalsLoading ? (
              <p>…</p>
            ) : state.totals.length === 0 ? (
              <p className="empty-state">{labels.signInToSync}</p>
            ) : (
              <ul>
                {state.totals.map((d) => (
                  <li key={d.date}>
                    <span>{d.date}</span>
                    <span>
                      {labels.totalCount}: {fmt(d.total)} · {labels.sessionsCount}:{' '}
                      {fmt(d.sessions)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="tasbih-total-card">
            <span className="tasbih-total-key">{labels.dailyTotals}</span>
            <b className="tasbih-total-value">{fmt(todayTotal)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minimal structural types for the Web Speech API (progressive enhancement). */
interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
}
interface SpeechErrorEventLike {
  error?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: SpeechErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
}
