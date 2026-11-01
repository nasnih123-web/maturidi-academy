'use client';

/**
 * QuranWaveform — live sound wave INSIDE the player progress bar.
 *
 * The canvas fills the progress bar itself (replacing the old yellow
 * fill line): the real wave draws dim across the bar with the played
 * portion in bright gold; the fallback draws gold/dim bars by progress.
 *
 * SOUND-BUG HARD GATE (user phone report 2026-11-01: wave visible, no
 * sound): the analyser graph is built ONLY when the shared AudioContext
 * is actually running (ctxState === 'running', primed synchronously in
 * the play-click gesture by the playback hook). A suspended context
 * must NEVER capture the element — capturing reroutes the element's
 * audio through the graph, so suspension means total silence while
 * progress still advances. When the gate refuses, the element plays
 * natively (sound guaranteed) and this canvas shows the decorative
 * indicator, honestly marked data-mode="indicator".
 *
 * The context is owned by the playback hook and is NEVER closed here:
 * closing a shared context would permanently end the visualizer.
 * prefers-reduced-motion renders one static frame instead of looping.
 */
import { useEffect, useRef, useState } from 'react';
import { parseWaveformStyle, type WaveformStyleId } from '@/lib/quran-waveform-styles';

const TAINTED_FRAMES = 30;
const SILENCE_VALUE = 128;
const BARS = 48;

export function QuranWaveform({
  getAudioElement,
  getAudioContext,
  ctxState,
  playing,
  progressPct,
  label,
  style,
}: {
  getAudioElement: () => HTMLAudioElement | null;
  getAudioContext: () => AudioContext | null;
  /** 'running' only when the hook primed the context in a gesture. */
  ctxState: 'running' | 'suspended' | null;
  playing: boolean;
  /** 0..100 progress, used for the played/unplayed split. */
  progressPct: number;
  label: string;
  /** Equalizer style id (CRM `quran.waveform_style`); unknown → 'bars'. */
  style?: string;
}) {
  const styleId: WaveformStyleId = parseWaveformStyle(style);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode;
  } | null>(null);
  const [fallback, setFallback] = useState(false);
  const [graphBuilt, setGraphBuilt] = useState(false);
  const fallbackRef = useRef(false);
  const zeroFramesRef = useRef(0);
  const progressRef = useRef(progressPct);
  progressRef.current = progressPct;

  // Build the analyser graph ONLY under the hard gate: playing AND the
  // shared context running. Anything else leaves the element untouched.
  useEffect(() => {
    if (!playing || graphRef.current || fallbackRef.current) return;
    if (ctxState !== 'running') return;
    const el = getAudioElement();
    const ctx = getAudioContext();
    if (!el || !ctx || ctx.state !== 'running') return;
    try {
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      graphRef.current = { ctx, analyser };
      setGraphBuilt(true);
    } catch {
      // Already captured (or any graph failure): never retry capture,
      // fall back to the decorative indicator and keep native sound.
      fallbackRef.current = true;
      setFallback(true);
    }
  }, [playing, ctxState, getAudioElement, getAudioContext]);

  useEffect(
    () => () => {
      // Shared context: do NOT close it, do NOT disconnect nodes (that
      // would silence an element that keeps playing). Just drop the ref;
      // the hook's own cleanup pauses the element on unmount.
      graphRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const W = canvas.width;
    const H = canvas.height;
    const data = new Uint8Array(2048);
    // Progress grows from the inline-start edge: left in LTR, right in
    // RTL. The seek handler uses the same rule, so the gold region and
    // the click position always agree.
    const rtl = document.documentElement.dir === 'rtl';

    // Per-x signal 0..1, filled by fillVals before every draw: live =
    // the analyser's time-domain signal, indicator = a sine field.
    const vals = new Float32Array(W);
    const fillVals = (t: number, live: boolean) => {
      if (live) {
        const analyser = graphRef.current?.analyser;
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        const step = Math.floor(data.length / W);
        for (let x = 0; x < W; x++) vals[x] = data[x * step] / 255;
      } else {
        for (let x = 0; x < W; x++) vals[x] = 0.5 + 0.45 * Math.sin(t / 500 + x * 0.06);
      }
    };

    // Bar i is played when its position from the inline-start edge is
    // below progress. Strict < so 0% progress lights nothing.
    const isPlayed = (i: number, p: number): boolean => {
      const fromOrigin = rtl ? (BARS - 1 - i) / BARS : i / BARS;
      return fromOrigin < p;
    };

    // Max deviation from the center line over bar i's slice — the
    // equalizer height for live data.
    const sliceAmp = (i: number): number => {
      const per = W / BARS;
      let m = 0;
      for (let x = Math.floor(i * per); x < Math.floor((i + 1) * per); x++) {
        const d = Math.abs(vals[x] - 0.5) * 2;
        if (d > m) m = d;
      }
      return m;
    };

    // Classic full-height sine bars for the indicator (the original
    // look of the bars style).
    const indicatorBarH = (i: number, t: number): number => {
      const phase = t / 500 + i * 0.55;
      return Math.sin(phase) * 0.5 + 0.5;
    };

    const drawBars = (live: boolean, t: number, p: number) => {
      g.clearRect(0, 0, W, H);
      const bw = W / BARS;
      for (let i = 0; i < BARS; i++) {
        const lit = isPlayed(i, p);
        const h = 4 + (live ? sliceAmp(i) : indicatorBarH(i, t)) * (H - 10);
        g.fillStyle = lit ? '#e5c07b' : 'rgba(212, 175, 55, 0.25)';
        const x = i * bw + 1;
        const bh = Math.max(2, h * (lit ? 1 : 0.45));
        g.fillRect(x, (H - bh) / 2, Math.max(1, bw - 2), bh);
      }
    };

    const drawDotted = (live: boolean, t: number, p: number) => {
      g.clearRect(0, 0, W, H);
      const bw = W / BARS;
      const dot = Math.max(2, Math.floor(bw) - 1);
      const gap = 2;
      const rows = Math.max(1, Math.floor(H / (dot + gap)));
      for (let i = 0; i < BARS; i++) {
        const lit = isPlayed(i, p);
        const count = Math.max(
          1,
          Math.round((live ? sliceAmp(i) : indicatorBarH(i, t)) * rows),
        );
        const x = i * bw + 1;
        g.fillStyle = lit ? '#e5c07b' : 'rgba(212, 175, 55, 0.25)';
        // Bottom-anchored dots, like the classic dotted equalizers.
        for (let r = 0; r < count; r++) {
          const y = H - (r + 1) * (dot + gap) + gap;
          g.fillRect(x, y, Math.max(1, bw - 2), dot);
        }
      }
    };

    // Line-family styles (line / mirrored / neon): a smooth stroked
    // wave, dim everywhere, gold (or gradient glow) clipped to the
    // played portion — right-anchored in RTL so it matches the seek
    // direction.
    const tracePath = (flip: boolean) => {
      g.beginPath();
      for (let x = 0; x < W; x++) {
        const y = (flip ? 1 - vals[x] : vals[x]) * H;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };
    const strokeTrace = (
      stroke: string | CanvasGradient,
      width: number,
      mirror: boolean,
      clipP: number | null,
      glow: boolean,
    ) => {
      g.strokeStyle = stroke;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.shadowBlur = glow ? 8 : 0;
      g.shadowColor = glow ? '#e5c07b' : 'transparent';
      if (clipP !== null) {
        g.save();
        g.beginPath();
        g.rect(rtl ? W * (1 - clipP) : 0, 0, W * clipP, H);
        g.clip();
      }
      tracePath(false);
      g.stroke();
      if (mirror) {
        tracePath(true);
        g.stroke();
      }
      if (clipP !== null) g.restore();
      g.shadowBlur = 0;
    };
    const drawLineFamily = (mirror: boolean, neon: boolean, p: number) => {
      g.clearRect(0, 0, W, H);
      strokeTrace('rgba(212, 175, 55, 0.28)', 2, mirror, null, false);
      if (neon) {
        const grad = g.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, '#e5c07b');
        grad.addColorStop(0.5, '#f0a35e');
        grad.addColorStop(1, '#c084fc');
        strokeTrace(grad, 2.5, mirror, p, true);
      } else {
        strokeTrace('#e5c07b', 2, mirror, p, false);
      }
    };

    // Dispatch: every style renders played distinct from unplayed.
    // The indicator paths are NOT a real wave — the canvas keeps
    // data-mode="indicator" in that case (see the return JSX).
    const drawStyle = (styleNow: WaveformStyleId, live: boolean, t: number) => {
      const p = progressRef.current / 100;
      fillVals(t, live);
      if (styleNow === 'bars') drawBars(live, t, p);
      else if (styleNow === 'dotted') drawDotted(live, t, p);
      else if (styleNow === 'mirrored') drawLineFamily(true, false, p);
      else if (styleNow === 'neon') drawLineFamily(false, true, p);
      else drawLineFamily(false, false, p);
    };

    let raf = 0;
    const tick = (t: number) => {
      if (fallbackRef.current) {
        drawStyle(styleId, false, t);
      } else if (graphRef.current) {
        const analyser = graphRef.current.analyser;
        analyser.getByteTimeDomainData(data);
        // Taint detection: a constant 128 stream means the analyser is
        // fed nothing (e.g. CORS-tainted element) — the line would be
        // dead flat, so switch to the labelled indicator instead.
        let constant = true;
        for (let i = 0; i < data.length; i += 16) {
          if (data[i] !== SILENCE_VALUE) {
            constant = false;
            break;
          }
        }
        if (playing && constant) {
          zeroFramesRef.current += 1;
          if (zeroFramesRef.current >= TAINTED_FRAMES) {
            fallbackRef.current = true;
            setFallback(true);
            drawStyle(styleId, false, t);
          } else {
            drawStyle(styleId, true, t);
          }
        } else {
          zeroFramesRef.current = 0;
          drawStyle(styleId, true, t);
        }
      } else {
        drawStyle(styleId, false, t);
      }
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    if (reduced) {
      tick(0);
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, [playing, fallback, graphBuilt, styleId]);

  const liveWave = graphBuilt && !fallback;
  return (
    <canvas
      ref={canvasRef}
      className="quran-waveform"
      width={720}
      height={96}
      role="img"
      aria-label={label}
      data-mode={liveWave ? 'waveform' : 'indicator'}
      data-style={styleId}
    />
  );
}
