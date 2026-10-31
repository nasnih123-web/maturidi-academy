'use client';

/**
 * QuranWaveform — live sound wave on the player bar.
 *
 * Tries a Web Audio AnalyserNode fed by the playback element. The
 * element is never given a crossOrigin attribute on purpose: forcing
 * CORS mode could BREAK playback outright when the CDN does not send
 * the header. Instead the analyser runs on the plain element — when
 * the source is cross-origin without CORS approval the analyser data
 * is tainted (constant silence) and playback itself is unaffected.
 *
 * Taint detection: while playing, 30 consecutive frames of constant
 * time-domain data (all 128) mean tainted data, not real silence, so
 * the canvas switches permanently (for this mount) to a decorative
 * progress-driven indicator. That indicator is NOT presented as a
 * waveform: it is visibly a different, simpler animation, and this
 * comment + the delivery report document the limitation honestly.
 * prefers-reduced-motion renders one static frame instead of looping.
 */
import { useEffect, useRef, useState } from 'react';

const TAINTED_FRAMES = 30;
const SILENCE_VALUE = 128;

export function QuranWaveform({
  getAudioElement,
  playing,
  progressPct,
  label,
}: {
  getAudioElement: () => HTMLAudioElement | null;
  playing: boolean;
  /** 0..100 progress, used only by the decorative fallback animation. */
  progressPct: number;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode;
  } | null>(null);
  const [fallback, setFallback] = useState(false);
  const fallbackRef = useRef(false);
  const zeroFramesRef = useRef(0);
  const progressRef = useRef(progressPct);
  progressRef.current = progressPct;

  // Build the analyser graph once, when playback first starts (the
  // user has clicked play, so sticky activation lets the context run).
  // One MediaElementSource per element — creating a second throws.
  useEffect(() => {
    if (!playing || graphRef.current || fallbackRef.current) return;
    const el = getAudioElement();
    if (!el) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        fallbackRef.current = true;
        setFallback(true);
        return;
      }
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      graphRef.current = { ctx, analyser };
      void ctx.resume().catch(() => {
        /* suspended context: analyser reads zeros → fallback path */
      });
    } catch {
      fallbackRef.current = true;
      setFallback(true);
    }
  }, [playing, getAudioElement]);

  useEffect(
    () => () => {
      void graphRef.current?.ctx.close().catch(() => {
        /* already closed */
      });
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

    const drawFallback = (t: number) => {
      g.clearRect(0, 0, W, H);
      const bars = 48;
      const bw = W / bars;
      const p = progressRef.current / 100;
      for (let i = 0; i < bars; i++) {
        const phase = t / 500 + i * 0.55;
        const h = 4 + (Math.sin(phase) * 0.5 + 0.5) * (H - 10);
        const lit = i / bars <= p;
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
      g.clearRect(0, 0, W, H);
      g.strokeStyle = '#e5c07b';
      g.lineWidth = 1.5;
      g.beginPath();
      const step = Math.floor(data.length / W);
      for (let x = 0; x < W; x++) {
        const v = data[x * step] / 255;
        const y = v * H;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
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
  }, [playing, fallback]);

  return (
    <canvas
      ref={canvasRef}
      className="quran-waveform"
      width={720}
      height={40}
      role="img"
      aria-label={label}
      data-mode={fallback ? 'indicator' : 'waveform'}
    />
  );
}
