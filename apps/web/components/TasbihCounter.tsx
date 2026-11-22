'use client';

/**
 * TasbihCounter — the digital tasbih (Design 5).
 *
 * Layout: a centered header (title, tagline, today's chip) over an
 * emerald canvas; below it a three-column grid — presets/custom rail,
 * the center stage (dhikr name over an SVG ring of 33 beads that light
 * up gold as the count advances through each cycle; the whole ring is
 * the tap button and the count sits in its middle), and a voice/stats
 * rail. On mobile the grid flattens into a single column that fits one
 * screen without scrolling.
 *
 * Custom dhikrs: the user can add their own dhikr text (validated by
 * addCustomDhikr in lib/tasbih.ts); customs persist in localStorage,
 * join the selectable list, and count by tap and voice exactly like
 * the presets.
 *
 * Voice counting (Web Speech API, progressive enhancement): interim
 * results are matched live against the current dhikr with
 * countDhikrOccurrences, so several repetitions inside one utterance
 * each count. The tap UI works with or without it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTasbihSession } from '@/lib/hooks/useTasbihSession';
import { addCustomDhikr, countDhikrOccurrences } from '@/lib/tasbih';

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
  customTitle: string;
  customPlaceholder: string;
  customAdd: string;
  customRemove: string;
  beadsWord: string;
  presets: { key: string; text: string }[];
}

const TARGET_CHOICES = [33, 100, 500, 1000];
/** One full circuit of the beads = one round. */
const BEADS_PER_ROUND = 33;
/** Waveform bars in the voice panel (purely decorative). */
const WAVE_BARS = 18;
/** localStorage key for the user's own dhikr texts (JSON string array). */
const CUSTOM_DHIKRS_KEY = 'tasbih:custom-dhikrs';
const CUSTOM_KEY_PREFIX = 'custom:';

/** Bead centers on the ring (viewBox 360×360, radius 148), top first. */
const BEAD_POSITIONS = Array.from({ length: BEADS_PER_ROUND }, (_, i) => {
  const angle = ((-90 + (i * 360) / BEADS_PER_ROUND) * Math.PI) / 180;
  return { x: 180 + 148 * Math.cos(angle), y: 180 + 148 * Math.sin(angle) };
});

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

  // Custom dhikrs: loaded from localStorage after mount (SSR renders
  // presets only), persisted on every add/remove.
  const [customDhikrs, setCustomDhikrs] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_DHIKRS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setCustomDhikrs(
          parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== ''),
        );
      }
    } catch {
      /* corrupted storage — start clean */
    }
  }, []);
  const saveCustomDhikrs = useCallback((list: string[]) => {
    setCustomDhikrs(list);
    try {
      window.localStorage.setItem(CUSTOM_DHIKRS_KEY, JSON.stringify(list));
    } catch {
      /* non-fatal */
    }
  }, []);
  const submitCustomDhikr = useCallback(() => {
    // Duplicates are checked against presets and existing customs alike.
    const next = addCustomDhikr(
      [...labels.presets.map((p) => p.text), ...customDhikrs],
      customInput,
    );
    if (!next) return;
    const added = next[next.length - 1];
    saveCustomDhikrs([...customDhikrs, added]);
    setCustomInput('');
    selectDhikr(`${CUSTOM_KEY_PREFIX}${added}`, added);
  }, [customDhikrs, customInput, labels.presets, saveCustomDhikrs, selectDhikr]);
  const removeCustomDhikr = useCallback(
    (text: string) => {
      saveCustomDhikrs(customDhikrs.filter((d) => d !== text));
      if (state.dhikrKey === `${CUSTOM_KEY_PREFIX}${text}`) {
        const first = labels.presets[0];
        if (first) selectDhikr(first.key, first.text);
      }
    },
    [customDhikrs, labels.presets, saveCustomDhikrs, selectDhikr, state.dhikrKey],
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
      // Only the results that changed in this event — earlier indices
      // were already processed when they arrived; rescanning them on
      // every event grows with the session and delays the count.
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
        // A restarted recognition reports results from index 0 again —
        // drop the previous session's per-index counts, otherwise the
        // first occurrences after every restart are swallowed by the
        // stale map and the count feels delayed.
        countedRef.current = new Map();
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
    // Restarting on dhikr change gives counting a fresh result map —
    // this also covers switching to or from a custom dhikr.
  }, [voiceOn, voiceSupported, incrementBy, state.dhikrKey, state.dhikrText, labels.presets]);

  // Bead ring: progress inside the current 33-bead cycle. A completed
  // cycle (count a positive multiple of 33) shows the full ring lit.
  const count = state.count;
  const litBeads =
    count > 0 && count % BEADS_PER_ROUND === 0 ? BEADS_PER_ROUND : count % BEADS_PER_ROUND;
  const cycle = count > 0 ? Math.floor((count - 1) / BEADS_PER_ROUND) + 1 : 1;
  const inCycle = count > 0 ? ((count - 1) % BEADS_PER_ROUND) + 1 : 0;

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
      <header className="tasbih-head">
        <h1 className="tasbih-head-title">{labels.title}</h1>
        <p className="tasbih-head-tag">{labels.tagline}</p>
        {todayTotal > 0 ? (
          <span className="tasbih-today-chip">
            <b>{fmt(todayTotal)}</b> {labels.totalCount} · <b>{fmt(todaySessions)}</b>{' '}
            {labels.sessionsCount}
          </span>
        ) : null}
      </header>

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
              {customDhikrs.map((text) => {
                const key = `${CUSTOM_KEY_PREFIX}${text}`;
                const today = state.todayRemote.find((t) => t.dhikrText === text);
                return (
                  <div
                    key={key}
                    className={`tasbih-preset tasbih-preset-custom${state.dhikrKey === key ? ' tasbih-preset-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="tasbih-preset-main"
                      aria-pressed={state.dhikrKey === key}
                      onClick={() => selectDhikr(key, text)}
                    >
                      <span lang="ar" dir="rtl">
                        {text}
                      </span>
                      {today ? (
                        <span className="tasbih-preset-cnt">{fmt(today.total)}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="tasbih-preset-remove"
                      aria-label={`${labels.customRemove}: ${text}`}
                      title={labels.customRemove}
                      onClick={() => removeCustomDhikr(text)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="tasbih-panel tasbih-custom-card">
            <h2>{labels.customTitle}</h2>
            <div className="tasbih-custom-row">
              <input
                type="text"
                className="tasbih-custom-input"
                lang="ar"
                dir="rtl"
                value={customInput}
                placeholder={labels.customPlaceholder}
                maxLength={200}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitCustomDhikr();
                  }
                }}
              />
              <button type="button" className="tasbih-custom-add" onClick={submitCustomDhikr}>
                {labels.customAdd}
              </button>
            </div>
          </section>
        </div>

        <div className="tasbih-center">
          <div className="tasbih-dhikr-block">
            <p className="tasbih-dhikr-name" lang="ar" dir="rtl" aria-live="polite">
              {state.dhikrText || labels.presets[0]?.text}
            </p>
            <div className="tasbih-flourish" aria-hidden />
          </div>

          <div className="tasbih-stage">
            <button
              type="button"
              className="tasbih-ringwrap tasbih-tap"
              onClick={increment}
              aria-label={`${labels.tapHint} — ${fmt(state.count)}`}
            >
              <svg className="tasbih-ring-svg" viewBox="0 0 360 360" aria-hidden>
                <defs>
                  <radialGradient id="tasbih-gold" cx="35%" cy="30%" r="80%">
                    <stop offset="0%" stopColor="#f7e3a1" />
                    <stop offset="55%" stopColor="#d9b45c" />
                    <stop offset="100%" stopColor="#a87f24" />
                  </radialGradient>
                  <radialGradient id="tasbih-dark" cx="35%" cy="30%" r="80%">
                    <stop offset="0%" stopColor="#17573d" />
                    <stop offset="100%" stopColor="#0a2e21" />
                  </radialGradient>
                </defs>
                <circle
                  cx={180}
                  cy={180}
                  r={168}
                  fill="none"
                  stroke="#d4af37"
                  strokeOpacity={0.16}
                />
                <circle
                  cx={180}
                  cy={180}
                  r={128}
                  fill="none"
                  stroke="#d4af37"
                  strokeOpacity={0.28}
                />
                {BEAD_POSITIONS.map((pos, i) =>
                  i < litBeads ? (
                    <circle key={i} cx={pos.x} cy={pos.y} r={i === 0 ? 15 : 11.5} fill="url(#tasbih-gold)" />
                  ) : (
                    <circle
                      key={i}
                      cx={pos.x}
                      cy={pos.y}
                      r={i === 0 ? 15 : 11.5}
                      fill="url(#tasbih-dark)"
                      stroke="#d4af37"
                      strokeOpacity={0.45}
                    />
                  ),
                )}
              </svg>
              <span className="tasbih-count-core">
                <span className="tasbih-count" aria-live="polite">
                  {fmt(state.count)}
                </span>
                <span className="tasbih-times">{labels.timesLabel}</span>
                <span className="tasbih-round-line">
                  {labels.roundLabel} {fmt(cycle)} · {fmt(inCycle)} {labels.ofCount}{' '}
                  {fmt(BEADS_PER_ROUND)} {labels.beadsWord}
                </span>
                <span className="tasbih-tap-badge">{labels.tapHint}</span>
              </span>
            </button>
          </div>

          {reached ? (
            <p className="tasbih-reached" role="status">
              {labels.targetReached}
            </p>
          ) : null}

          <div className="tasbih-under">
            <div className="tasbih-progress-wrap">
              <div
                className="tasbih-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={state.target ?? 0}
                aria-valuenow={state.count}
                aria-label={labels.targetLabel}
              >
                <i style={{ width: `${Math.round(state.progress * 100)}%` }} />
              </div>
              <div className="tasbih-progress-lbl">
                <span>
                  {state.target
                    ? `${labels.targetLabel}: ${fmt(state.target)}`
                    : labels.customTarget}
                </span>
                <span>{fmtPct(state.progress)}</span>
              </div>
            </div>

            <div className="tasbih-targets">
              <span className="tasbih-targets-lbl">{labels.targetLabel}</span>
              <div
                className="tasbih-target-choices"
                role="group"
                aria-label={labels.targetLabel}
              >
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

          <section className="tasbih-panel tasbih-verse">
            <p className="tasbih-verse-text" lang="ar" dir="rtl">
              «{labels.verse}»
            </p>
            <p className="tasbih-verse-caption">{labels.verseCaption}</p>
          </section>
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
