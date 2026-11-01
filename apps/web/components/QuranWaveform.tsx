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

const TAINTED_FRAMES = 30;
const SILENCE_VALUE = 128;

export function QuranWaveform({
  getAudioElement,
  getAudioContext,
  ctxState,
  playing,
  progressPct,
  label,
}: {
  getAudioElement: () => HTMLAudioElement | null;
  getAudioContext: () => AudioContext | null;
  /** 'running' only when the hook primed the context in a gesture. */
  ctxState: 'running' | 'suspended' | null;
  playing: boolean;
  /** 0..100 progress, used for the played/unplayed split. */
  progressPct: number;
  label: string;
}) {
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

    const drawFallback = (t: number) => {
      g.clearRect(0, 0, W, H);
      const bars = 48;
      const bw = W / bars;
      const p = progressRef.current / 100;
      for (let i = 0; i < bars; i++) {
        const phase = t / 500 + i * 0.55;
        const h = 4 + (Math.sin(phase) * 0.5 + 0.5) * (H - 10);
        // Strict < so 0% progress lights nothing (no stray first bar).
        const fromOrigin = rtl ? (bars - 1 - i) / bars : i / bars;
        const lit = fromOrigin < p;
        g.fillStyle = lit ? '#e5c07b' : 'rgba(212, 175, 55, 0.25)';
        const x = i * bw + 1;
        const bh = Math.max(2, h * (lit ? 1 : 0.45));
        g.fillRect(x, (H - bh) / 2, Math.max(1, bw - 2), bh);
      }
    };

    const drawWave = () => {
      const analyser = graphRef.current?.analyser;
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      const step = Math.floor(data.length / W);
      const trace = (stroke: string, width: number) => {
        g.strokeStyle = stroke;
        g.lineWidth = width;
        g.lineJoin = 'round';
        g.beginPath();
        for (let x = 0; x < W; x++) {
          const v = data[x * step] / 255;
          const y = v * H;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      };
      g.clearRect(0, 0, W, H);
      // Unplayed portion: dim wave across the whole bar.
      trace('rgba(212, 175, 55, 0.28)', 2);
      // Played portion: bright gold, clipped to the progress width —
      // right-anchored in RTL so it matches the seek direction.
      const p = progressRef.current / 100;
      g.save();
      g.beginPath();
      g.rect(rtl ? W * (1 - p) : 0, 0, W * p, H);
      g.clip();
      trace('#e5c07b', 2);
      g.restore();
    };

    let raf = 0;
    const tick = (t: number) => {
      if (fallbackRef.current) {
        drawFallback(t);
      } else if (graphRef.current) {
        const analyser = graphRef.current.analyser;
        analyser.getByteTimeDomainData(data);
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
            drawFallback(t);
          } else {
            drawWave();
          }
        } else {
          zeroFramesRef.current = 0;
          drawWave();
        }
      } else {
        drawFallback(t);
      }
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    if (reduced) {
      tick(0);
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, [playing, fallback, graphBuilt]);

  const liveWave = graphBuilt && !fallback;
  return (
    <canvas
      ref={canvasRef}
      className="quran-waveform"
      width={720}
      height={40}
      role="img"
      aria-label={label}
      data-mode={liveWave ? 'waveform' : 'indicator'}
    />
  );
}
